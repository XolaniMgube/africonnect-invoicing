/**
 * Supabase Edge Function: emails an issued invoice of a super business, with
 * its saved PDF attached, through Resend, and records the attempt in
 * public.email_log.
 *
 * Deploy:  npx supabase functions deploy send-invoice
 * Secret:  npx supabase secrets set RESEND_API_KEY=re_...
 *
 * The caller's own session decides what they may see (row-level security),
 * so an employee can only send invoices of businesses they can see. Only the
 * PDF download and the log entry use the service role.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  emailBody,
  pdfName,
  validateSendRequest,
  type SendRequest,
} from "../_shared/invoice-email.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const env = (name: string) => Deno.env.get(name) ?? "";

/** Base64 of a binary file, in chunks (large PDFs overflow spread calls). */
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const url = env("SUPABASE_URL");
  const publicKey = env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey =
    env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
  const resendKey = env("RESEND_API_KEY");
  if (!url || !publicKey || !serviceKey)
    return json({ error: "The email service is not configured." }, 500);
  if (!resendKey)
    return json(
      {
        error:
          "Email sending isn’t set up yet: an administrator needs to add the Resend API key to Supabase.",
      },
      503,
    );

  const authorization = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: auth } = await asCaller.auth.getUser(
    authorization.replace(/^Bearer\s+/i, ""),
  );
  if (!auth?.user) return json({ error: "Sign in again to send email." }, 401);

  let request: SendRequest;
  try {
    request = await req.json();
  } catch {
    return json({ error: "The request could not be read." }, 400);
  }
  const problems = validateSendRequest(request);
  if (problems.length) return json({ error: problems.join(" ") }, 400);

  // Everything below is read as the caller: missing means "not yours to see".
  const { data: doc } = await asCaller
    .from("documents")
    .select("*")
    .eq("id", request.documentId)
    .maybeSingle();
  if (!doc) return json({ error: "This invoice isn’t available to you." }, 404);
  const { data: business } = await asCaller
    .from("businesses")
    .select("*")
    .eq("id", doc.business_id)
    .single();
  if (
    !business ||
    doc.kind !== "invoice" ||
    doc.status !== "issued" ||
    !business.is_super
  )
    return json(
      {
        error:
          "Only issued invoices of super businesses can be sent from the app.",
      },
      400,
    );
  if (!business.email_from)
    return json(
      {
        error: `Set “Send invoices from” in ${business.name}’s business settings first.`,
      },
      400,
    );
  const [{ data: revisions }, { data: tracking }, { data: payments }] =
    await Promise.all([
      asCaller
        .from("documents")
        .select("id")
        .eq("revision_of_id", doc.id)
        .eq("status", "issued"),
      asCaller
        .from("invoice_tracking")
        .select("*")
        .eq("document_id", doc.id)
        .maybeSingle(),
      asCaller.from("payments").select("amount").eq("document_id", doc.id),
    ]);
  if (revisions?.length)
    return json({ error: "This invoice was replaced by a revision." }, 400);
  if (tracking?.cancelled_at)
    return json({ error: "This invoice is cancelled." }, 400);

  const pdf = await admin.storage
    .from("invoice-pdfs")
    .download(`${doc.business_id}/${doc.id}.pdf`);
  if (pdf.error || !pdf.data)
    return json(
      { error: "The invoice PDF hasn’t been saved yet. Try sending again." },
      409,
    );

  const paidCents = (payments ?? []).reduce(
    (sum: number, p: { amount: number | string }) =>
      sum + Math.round(Number(p.amount) * 100),
    0,
  );
  const balance =
    Math.max(Math.round(Number(doc.total) * 100) - paidCents, 0) / 100;
  const { html, text } = emailBody({
    message: request.message,
    number: doc.number,
    businessName: business.name,
    balance,
    dueDate: tracking?.due_date ?? doc.end_date,
  });

  const sent = await fetch(
    env("RESEND_API_URL") || "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${business.name} <${business.email_from}>`,
        to: request.to,
        cc: request.cc.length ? request.cc : undefined,
        reply_to: business.email || undefined,
        subject: request.subject.trim(),
        html,
        text,
        attachments: [
          {
            filename: pdfName(doc.number),
            content: base64(new Uint8Array(await pdf.data.arrayBuffer())),
          },
        ],
      }),
    },
  ).catch((e: unknown) => e as Error);

  let providerId: string | null = null;
  let error = "";
  if (sent instanceof Error) error = `Couldn’t reach Resend: ${sent.message}`;
  else {
    const result = await sent.json().catch(() => ({}));
    if (sent.ok) providerId = result.id ?? null;
    else
      error =
        result.message ||
        `Resend refused the email (HTTP ${sent.status}).`;
  }

  const { data: log, error: logError } = await admin
    .from("email_log")
    .insert({
      document_id: doc.id,
      business_id: doc.business_id,
      kind: "invoice",
      recipients: request.to,
      cc: request.cc,
      subject: request.subject.trim(),
      status: error ? "failed" : "sent",
      provider_id: providerId,
      error,
      sent_by: auth.user.id,
    })
    .select()
    .single();
  if (logError) console.error("email_log insert failed", logError);

  return error
    ? json({ error, log }, 502)
    : json({ log });
});

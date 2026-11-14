/**
 * Supabase Edge Function: emails an issued invoice of a super business, with
 * its saved PDF attached, through the business's own mailbox (e.g. Afrihost
 * cPanel, mail settings saved in the app), and records the attempt in
 * public.email_log. No third-party email service.
 *
 * `{ action: "test", businessId, to }` (Admins): sends a test email through
 * the mailbox, to prove it works.
 *
 * Deploy:  npx supabase functions deploy send-invoice --use-api
 *
 * The caller's own session decides what they may see (row-level security),
 * so an employee can only send invoices of businesses they can see. Only the
 * mailbox password, the PDF download and the log entry use the service role.
 */
import {
  isEmail,
  validateSendRequest,
  type SendRequest,
} from "../_shared/invoice-email.ts";
import { sendMail } from "../_shared/smtp.ts";
import {
  callerOf,
  clients,
  cors,
  deliverInvoiceEmail,
  json,
  mailboxOf,
  openTransport,
} from "../_shared/deno/runtime.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const c = clients(req);
  if (!c) return json({ error: "The email service is not configured." }, 500);
  const { asCaller, admin, authorization } = c;
  const user = await callerOf(asCaller, authorization);
  if (!user) return json({ error: "Sign in again to send email." }, 401);

  // Invoice emails send a SendRequest; tests send { action, businessId, to }.
  let body: Omit<SendRequest, "to"> & {
    to?: unknown;
    action?: string;
    businessId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "The request could not be read." }, 400);
  }

  if (body.action === "test") {
    const { data: isAdmin } = await asCaller.rpc("is_admin");
    if (!isAdmin)
      return json({ error: "Only an admin can send a test email." }, 403);
    const { data: business } = await asCaller
      .from("businesses")
      .select("*")
      .eq("id", body.businessId ?? "")
      .maybeSingle();
    if (!business?.is_super)
      return json({ error: "Mail settings are for super businesses." }, 400);
    if (!business.email_from)
      return json(
        { error: "Set “Send invoices from” in business settings first." },
        400,
      );
    const settings = await mailboxOf(admin, business.id);
    if (!settings) return json({ error: "Save the mail settings first." }, 400);
    // Admins may send the test to any inbox they can check.
    const to =
      (typeof body.to === "string" ? body.to.trim() : "") || user.email || "";
    if (!isEmail(to))
      return json(
        { error: "Enter the address to send the test email to." },
        400,
      );
    try {
      await sendMail(openTransport, settings, {
        from: { name: business.name, address: business.email_from },
        to: [to],
        subject: `Test email from ${business.name}`,
        text: `This test email was sent from Africonnect Invoicing through ${settings.host}:${settings.port}, logged in as ${settings.username}.\n\nIf you can read it, invoice emails from ${business.name} can be sent from this mailbox.`,
      });
      return json({ ok: true, to });
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "The test email failed." },
        502,
      );
    }
  }

  const request = body as SendRequest;
  const problems = validateSendRequest(request);
  if (problems.length) return json({ error: problems.join(" ") }, 400);

  // Read as the caller: missing means "not yours to see".
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
  const [{ data: revisions }, { data: tracking }] = await Promise.all([
    asCaller
      .from("documents")
      .select("id")
      .eq("revision_of_id", doc.id)
      .eq("status", "issued"),
    asCaller
      .from("invoice_tracking")
      .select("cancelled_at")
      .eq("document_id", doc.id)
      .maybeSingle(),
  ]);
  if (revisions?.length)
    return json({ error: "This invoice was replaced by a revision." }, 400);
  if (tracking?.cancelled_at)
    return json({ error: "This invoice is cancelled." }, 400);

  const { log, error } = await deliverInvoiceEmail(admin, {
    doc,
    business,
    to: request.to,
    cc: request.cc,
    subject: request.subject,
    message: request.message,
    kind: "invoice",
    sentBy: user.id,
  });
  if (!log) return json({ error }, 400);
  return error ? json({ error, log }, 502) : json({ log });
});

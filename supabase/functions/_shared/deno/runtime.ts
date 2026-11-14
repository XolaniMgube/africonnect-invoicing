/**
 * Deno-only helpers shared by the send-invoice and send-reminders Edge
 * Functions: responses, Supabase clients, the mailbox connection, and
 * emailing an issued invoice (PDF attached) with a log entry.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { emailBody, pdfName } from "../invoice-email.ts";
import { sendMail, type SmtpSettings, type Transport } from "../smtp.ts";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-reminders-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const env = (name: string) => Deno.env.get(name) ?? "";

/** Clients for the caller (their own session) and the service role. */
export function clients(req: Request) {
  const url = env("SUPABASE_URL");
  const publicKey = env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey =
    env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
  if (!url || !publicKey || !serviceKey) return null;
  const authorization = req.headers.get("Authorization") ?? "";
  return {
    authorization,
    asCaller: createClient(url, publicKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    }),
    admin: createClient(url, serviceKey, { auth: { persistSession: false } }),
  };
}

/** The signed-in employee calling the function, if any. */
export async function callerOf(
  asCaller: SupabaseClient,
  authorization: string,
) {
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await asCaller.auth.getUser(token);
  return data?.user ?? null;
}

/** Today's date in South Africa, e.g. "2026-11-14". */
export const saToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(
    new Date(),
  );

/** A TCP/TLS connection to the mailbox's server (port 465: TLS from the start). */
export async function openTransport(
  settings: SmtpSettings,
): Promise<Transport> {
  let conn: Deno.Conn =
    settings.port === 465
      ? await Deno.connectTls({ hostname: settings.host, port: settings.port })
      : await Deno.connect({ hostname: settings.host, port: settings.port });
  const buffer = new Uint8Array(16 * 1024);
  return {
    async read() {
      const n = await conn.read(buffer);
      return n === null ? null : buffer.slice(0, n);
    },
    async write(data) {
      for (let offset = 0; offset < data.length;)
        offset += await conn.write(data.subarray(offset));
    },
    async startTls() {
      conn = await Deno.startTls(conn as Deno.TcpConn, {
        hostname: settings.host,
      });
    },
    close() {
      try {
        conn.close();
      } catch {
        // Already closed.
      }
    },
  };
}

/** The mailbox saved for a business, with its password (service role only). */
export async function mailboxOf(admin: SupabaseClient, businessId: string) {
  const { data } = await admin.rpc("mail_settings_for_send", {
    target: businessId,
  });
  return (data as SmtpSettings[] | null)?.[0] ?? null;
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Money still owed on an invoice, and its due date (changed or original). */
export async function balanceOf(admin: SupabaseClient, doc: Row) {
  const [{ data: payments }, { data: tracking }] = await Promise.all([
    admin.from("payments").select("amount").eq("document_id", doc.id),
    admin
      .from("invoice_tracking")
      .select("*")
      .eq("document_id", doc.id)
      .maybeSingle(),
  ]);
  const paid = (payments ?? []).reduce(
    (sum: number, p: { amount: number | string }) =>
      sum + Math.round(Number(p.amount) * 100),
    0,
  );
  return {
    balance: Math.max(Math.round(Number(doc.total) * 100) - paid, 0) / 100,
    dueDate: (tracking?.due_date as string | null) ?? (doc.end_date as string),
    cancelled: !!tracking?.cancelled_at,
  };
}

/**
 * Emails an issued invoice through its business's mailbox with the saved PDF
 * attached and the current balance in the text, and logs the attempt.
 * Returns `log: null` (and why) when it couldn't even try.
 */
export async function deliverInvoiceEmail(
  admin: SupabaseClient,
  d: {
    doc: Row;
    business: Row;
    to: string[];
    cc: string[];
    subject: string;
    message: string;
    kind: "invoice" | "reminder";
    sentBy: string | null;
  },
): Promise<{ log: Row | null; error: string }> {
  const mailbox = await mailboxOf(admin, d.business.id);
  if (!mailbox)
    return {
      log: null,
      error: `${d.business.name}’s email sending isn’t set up yet. Ask an admin to add the mailbox under Business settings → Email sending.`,
    };
  const pdf = await admin.storage
    .from("invoice-pdfs")
    .download(`${d.doc.business_id}/${d.doc.id}.pdf`);
  if (pdf.error || !pdf.data)
    return {
      log: null,
      error:
        "The invoice PDF hasn’t been saved yet. Open the invoice in the app and try again.",
    };
  const { balance, dueDate } = await balanceOf(admin, d.doc);
  const { html, text } = emailBody({
    message: d.message,
    number: d.doc.number,
    businessName: d.business.name,
    balance,
    dueDate,
  });

  let response: string | null = null;
  let error = "";
  try {
    response = (
      await sendMail(openTransport, mailbox, {
        from: { name: d.business.name, address: d.business.email_from },
        to: d.to,
        cc: d.cc,
        replyTo: d.business.email || undefined,
        subject: d.subject.trim(),
        html,
        text,
        attachments: [
          {
            filename: pdfName(d.doc.number),
            contentType: "application/pdf",
            content: new Uint8Array(await pdf.data.arrayBuffer()),
          },
        ],
      })
    ).response;
  } catch (e) {
    error =
      e instanceof Error ? e.message : "The mail server refused the email.";
  }

  const { data: log, error: logError } = await admin
    .from("email_log")
    .insert({
      document_id: d.doc.id,
      business_id: d.doc.business_id,
      kind: d.kind,
      recipients: d.to,
      cc: d.cc,
      subject: d.subject.trim(),
      status: error ? "failed" : "sent",
      // The mail server's acceptance, e.g. "250 OK id=1abc…".
      provider_id: response,
      error,
      sent_by: d.sentBy,
    })
    .select()
    .single();
  if (logError) console.error("email_log insert failed", logError);
  return { log: log ?? null, error };
}

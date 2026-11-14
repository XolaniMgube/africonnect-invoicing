/**
 * Supabase Edge Function: sends scheduled payment reminders through each
 * business's own mailbox, with the invoice PDF attached and the balance as it
 * is today.
 *
 *   * The daily pg_cron job (12:00 SAST, see the reminders migration) calls it
 *     with the `x-reminders-token` header: every reminder due today or earlier
 *     is sent.
 *   * An Admin's "Send now" calls it signed in, with `{ reminderId }`: that
 *     one reminder is sent straight away.
 *
 * Reminders for invoices that are paid, cancelled or replaced by a revision
 * are cancelled instead of sent.
 *
 * Deploy (no login is involved for the daily job, so JWT checks are off; the
 * function checks the token or the admin itself):
 *   npx supabase functions deploy send-reminders --use-api --no-verify-jwt
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  balanceOf,
  callerOf,
  clients,
  cors,
  deliverInvoiceEmail,
  json,
  saToday,
} from "../_shared/deno/runtime.ts";
import {
  defaultReminderMessage,
  defaultReminderSubject,
  isEmail,
} from "../_shared/invoice-email.ts";

/** A missed day (e.g. the project was paused) is still sent this many days late. */
const CATCH_UP_DAYS = 3;

const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );

/** Stops starting new emails after this long, so a run never times out. */
const TIME_BUDGET_MS = 100_000;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function finish(
  admin: SupabaseClient,
  id: string,
  change: { status: string; error?: string; email_log_id?: string | null },
) {
  const { data } = await admin
    .from("reminders")
    .update({
      ...change,
      error: change.error ?? "",
      ...(change.status === "sent" || change.status === "failed"
        ? { sent_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", id)
    .select()
    .single();
  return data as Row | null;
}

/** Sends one claimed reminder, or explains why it was skipped. */
async function process(
  admin: SupabaseClient,
  reminder: Row,
  sentBy: string | null,
) {
  const { data: doc } = await admin
    .from("documents")
    .select("*")
    .eq("id", reminder.document_id)
    .single();
  const { data: business } = await admin
    .from("businesses")
    .select("*")
    .eq("id", reminder.business_id)
    .single();
  const skip = (error: string) =>
    finish(admin, reminder.id, { status: "cancelled", error });
  if (!doc || !business) return skip("Not sent: the invoice no longer exists.");
  if (business.archived) return skip("Not sent: the business is archived.");
  if (!business.is_super)
    return skip("Not sent: the business is no longer a super business.");
  const { data: revisions } = await admin
    .from("documents")
    .select("id")
    .eq("revision_of_id", doc.id)
    .eq("status", "issued");
  if (revisions?.length)
    return skip("Not sent: the invoice was replaced by a revision.");
  const { balance, cancelled } = await balanceOf(admin, doc);
  if (cancelled) return skip("Not sent: the invoice was cancelled.");
  if (balance <= 0) return skip("Not sent: the invoice was paid.");
  if (!business.email_from)
    return finish(admin, reminder.id, {
      status: "failed",
      error: `Set “Send invoices from” in ${business.name}’s business settings.`,
    });

  const { log, error } = await deliverInvoiceEmail(admin, {
    doc,
    business,
    to: reminder.recipients,
    cc: reminder.cc ?? [],
    subject: reminder.subject,
    message: reminder.message,
    kind: "reminder",
    sentBy: sentBy ?? reminder.created_by ?? null,
  });
  return finish(admin, reminder.id, {
    status: error ? "failed" : "sent",
    error,
    email_log_id: log?.id ?? null,
  });
}

/**
 * Automatic reminders: for every unpaid issued invoice of a super business
 * with automatic reminders on, creates and sends the reminder of the rule
 * whose day has arrived — at most one per rule and invoice. Stops starting
 * new ones when time runs short; the next run (within the catch-up window)
 * continues.
 */
async function sendAutomatic(
  admin: SupabaseClient,
  today: string,
  started: number,
) {
  const results: Row[] = [];
  const { data: businesses } = await admin
    .from("businesses")
    .select("*")
    .eq("is_super", true)
    .eq("auto_reminders", true)
    .eq("archived", false);
  for (const business of businesses ?? []) {
    if (!business.email_from) continue;
    const { data: docs } = await admin
      .from("documents")
      .select("*")
      .eq("business_id", business.id)
      .eq("kind", "invoice")
      .eq("status", "issued");
    const ids = (docs ?? []).map((d: Row) => d.id);
    if (!ids.length) continue;
    const [tracking, payments, revisions, done, customers] = await Promise.all([
      admin.from("invoice_tracking").select("*").in("document_id", ids),
      admin
        .from("payments")
        .select("document_id, amount")
        .in("document_id", ids),
      admin
        .from("documents")
        .select("revision_of_id")
        .in("revision_of_id", ids)
        .eq("status", "issued"),
      admin
        .from("reminders")
        .select("document_id, rule_offset")
        .in("document_id", ids)
        .not("rule_offset", "is", null),
      admin
        .from("customers")
        .select("id, email")
        .eq("business_id", business.id),
    ]);
    for (const doc of docs ?? []) {
      const t = (tracking.data ?? []).find(
        (x: Row) => x.document_id === doc.id,
      );
      if (t?.cancelled_at || t?.auto_reminders_paused) continue;
      if ((revisions.data ?? []).some((r: Row) => r.revision_of_id === doc.id))
        continue;
      const paid = (payments.data ?? [])
        .filter((p: Row) => p.document_id === doc.id)
        .reduce(
          (sum: number, p: Row) => sum + Math.round(Number(p.amount) * 100),
          0,
        );
      if (paid >= Math.round(Number(doc.total) * 100)) continue;
      const late = daysBetween(t?.due_date ?? doc.end_date, today);
      const sent = new Set(
        (done.data ?? [])
          .filter((r: Row) => r.document_id === doc.id)
          .map((r: Row) => r.rule_offset),
      );
      // The latest rule whose day has arrived (within the catch-up window).
      const offset = [...(business.reminder_offsets as number[])]
        .sort((a, b) => b - a)
        .find((o) => o <= late && late <= o + CATCH_UP_DAYS && !sent.has(o));
      if (offset === undefined) continue;
      if (Date.now() - started > TIME_BUDGET_MS) return results;
      const snapshot = doc.snapshot?.customer ?? {};
      const email =
        (customers.data ?? []).find((c: Row) => c.id === doc.customer_id)
          ?.email ||
        snapshot.email ||
        "";
      if (!isEmail(email)) continue; // Shown on the invoice in the app.
      const { data: row } = await admin
        .from("reminders")
        .insert({
          document_id: doc.id,
          business_id: doc.business_id,
          send_on: today,
          recipients: [email.trim()],
          cc: [],
          subject: defaultReminderSubject(doc.number, business.name),
          message: defaultReminderMessage({
            number: doc.number,
            customerName: snapshot.name ?? "",
            contact: snapshot.contact ?? "",
            businessName: business.name,
          }),
          status: "sending",
          rule_offset: offset,
          created_by: null,
        })
        .select()
        .maybeSingle();
      // No row: another run already created this rule's reminder.
      if (!row) continue;
      try {
        const done = await process(admin, row, null);
        if (done) results.push(done);
      } catch (e) {
        const done = await finish(admin, row.id, {
          status: "failed",
          error: e instanceof Error ? e.message : "The reminder failed.",
        });
        if (done) results.push(done);
      }
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const c = clients(req);
  if (!c) return json({ error: "The email service is not configured." }, 500);
  const { asCaller, admin, authorization } = c;
  const body = (await req.json().catch(() => ({}))) as { reminderId?: string };

  // Who is asking: the daily job (its key) or a signed-in admin.
  let sentBy: string | null = null;
  let only: string | undefined;
  const token = req.headers.get("x-reminders-token");
  if (token) {
    const { data: ok } = await admin.rpc("reminder_token_ok", { token });
    if (!ok) return json({ error: "Not allowed." }, 401);
  } else {
    const user = await callerOf(asCaller, authorization);
    if (!user) return json({ error: "Sign in again." }, 401);
    const { data: isAdmin } = await asCaller.rpc("is_admin");
    if (!isAdmin)
      return json({ error: "Only an admin can send reminders." }, 403);
    if (!body.reminderId)
      return json({ error: "Choose the reminder to send." }, 400);
    sentBy = user.id;
    only = body.reminderId;
  }

  let query = admin
    .from("reminders")
    .select("*")
    .eq("status", "scheduled")
    .order("send_on")
    .limit(100);
  query = only ? query.eq("id", only) : query.lte("send_on", saToday());
  const { data: due, error: dueError } = await query;
  if (dueError) return json({ error: dueError.message }, 500);
  if (only && !due?.length)
    return json({ error: "This reminder is no longer scheduled." }, 409);

  const started = Date.now();
  const results: Row[] = [];
  for (const reminder of due ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break; // The next run continues.
    // Claim it, so two runs never send the same reminder.
    const { data: claimed } = await admin
      .from("reminders")
      .update({ status: "sending" })
      .eq("id", reminder.id)
      .eq("status", "scheduled")
      .select()
      .maybeSingle();
    if (!claimed) continue;
    try {
      const done = await process(admin, claimed, sentBy);
      if (done) results.push(done);
    } catch (e) {
      const done = await finish(admin, reminder.id, {
        status: "failed",
        error: e instanceof Error ? e.message : "The reminder failed.",
      });
      if (done) results.push(done);
    }
  }

  // The daily run also sends automatic reminders.
  if (!only) results.push(...(await sendAutomatic(admin, saToday(), started)));

  const count = (status: string) =>
    results.filter((r) => r.status === status).length;
  const summary = {
    sent: count("sent"),
    failed: count("failed"),
    cancelled: count("cancelled"),
  };
  console.log("reminders run", { ...summary, only: only ?? null });
  if (only) {
    const reminder = results[0] ?? null;
    let log = null;
    if (reminder?.email_log_id) {
      const { data } = await admin
        .from("email_log")
        .select("*")
        .eq("id", reminder.email_log_id)
        .single();
      log = data;
    }
    return json({ reminder, log });
  }
  return json(summary);
});

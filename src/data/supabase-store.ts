/**
 * Supabase backend: Auth for sign-in, Postgres for records, Storage for
 * logos. The browser talks to Supabase directly with the publishable key;
 * row-level security and triggers in `supabase/migrations` are what protect
 * the data, so every rule that matters is also enforced there.
 */
import { createBrowserClient } from "@supabase/ssr";
import type {
  PostgrestError,
  SupabaseClient,
  User,
} from "@supabase/supabase-js";
import type { BusinessDocument, Database } from "../domain/types";
import { convertQuotation, saveDocument } from "../domain/documents";
import {
  setReminderRules,
  setAutoRemindersPaused,
  cancelReminder,
  checkReminder,
  checkMailSettings,
  checkSend,
  tracksPayments,
  cancelInvoice,
  deletePayment,
  recordPayment,
  restoreInvoice,
  setDueDate,
} from "../domain/receivables";
import type { InvoiceTracking } from "../domain/types";
import {
  customerInUse,
  parseDatabase,
  removeRecord,
  setAccess,
  setRole,
  setSuper,
  upsertBusiness,
  upsertRecord,
} from "./repository";
import {
  businessToRow,
  customerToRow,
  documentToRow,
  itemToRow,
  rowToBusiness,
  rowToCustomer,
  rowToDocument,
  rowToItem,
  rowsToDatabase,
  rowToEmployee,
  rowToEmail,
  rowToMailSettings,
  rowToReminder,
  type ReminderRow,
  type EmailRow,
  type MailSettingsRow,
  paymentToRow,
  rowToPayment,
  rowToTracking,
  trackingToRow,
  type PaymentRow,
  type TrackingRow,
  type AccessRow,
  type EmployeeRow,
  type BusinessRow,
  type CustomerRow,
  type DocumentRow,
  type ItemRow,
} from "./rows";
import {
  databaseMessage,
  OFFLINE,
  signInMessage,
  storageMessage,
} from "./errors";
import {
  configError,
  supabaseConfig,
  type Employee,
  type Store,
} from "./store";

export const LOGO_BUCKET = "business-logos";

let client: SupabaseClient | null = null;
function supabase() {
  if (!supabaseConfig) throw new Error(configError);
  client ??= createBrowserClient(supabaseConfig.url, supabaseConfig.key);
  return client;
}

type Result<T> = { data: T | null; error: PostgrestError | null };

/** Awaits a query and turns failures into messages an employee can act on. */
async function maybe<T>(query: PromiseLike<Result<T>>): Promise<T | null> {
  let result: Result<T>;
  try {
    result = await query;
  } catch {
    throw new Error(OFFLINE);
  }
  if (result.error) throw new Error(databaseMessage(result.error));
  return result.data;
}

/** Like `maybe`, for queries that must return data. */
async function must<T>(query: PromiseLike<Result<T>>): Promise<T> {
  const data = await maybe(query);
  if (data === null) throw new Error(databaseMessage({ code: "PGRST116" }));
  return data;
}

function omit<T extends object, K extends keyof T>(
  record: T,
  ...keys: K[]
): Omit<T, K> {
  const copy = { ...record };
  for (const key of keys) delete copy[key];
  return copy;
}

/** Columns the database assigns itself on insert. */
/** An empty number asks the database for the next one (see the migrations). */
const forInsert = (doc: BusinessDocument) =>
  omit(documentToRow(doc), "updated_at", "source_quotation_number");

const PAGE = 1000;
/** Supabase returns at most 1,000 rows per request, so read in pages. */
async function selectAll<T>(table: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await must<T[]>(
      supabase()
        .from(table)
        .select("*")
        .order("created_at")
        .order("id")
        .range(from, from + PAGE - 1),
    );
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** Deletes one row; `inUse` explains a refusal by a document's foreign key. */
async function deleteRow(table: string, id: string, inUse?: string) {
  let result: Result<{ id: string }[]>;
  try {
    result = await supabase().from(table).delete().eq("id", id).select("id");
  } catch {
    throw new Error(OFFLINE);
  }
  const { error, data } = result;
  if (error?.code === "23503" && inUse) throw new Error(inUse);
  // Without the delete privilege (the migration has not been applied).
  if (error?.code === "42501")
    throw new Error(
      "Deleting customers and items is not enabled in the database yet. Ask an administrator to apply the delete-customers-and-items update. Nothing was deleted.",
    );
  if (error) throw new Error(databaseMessage(error));
  // Row-level security hides rows silently, as does an earlier delete.
  if (!data?.length) throw new Error(databaseMessage({ code: "PGRST116" }));
}

/**
 * Rows from a table added by a later migration: an empty list (instead of a
 * broken workspace) while that migration hasn't been applied yet.
 */
async function optionalRows<T>(query: PromiseLike<Result<T[]>>): Promise<T[]> {
  try {
    return (await maybe(query)) ?? [];
  } catch (e) {
    if (e instanceof Error && e.message === OFFLINE) throw e;
    return [];
  }
}

/** Writes an invoice's due date / cancellation as the domain rules left it. */
async function saveTracking(
  next: Database,
  documentId: string,
): Promise<InvoiceTracking> {
  const tracking = next.tracking.find((t) => t.documentId === documentId)!;
  const doc = next.documents.find((d) => d.id === documentId)!;
  return rowToTracking(
    await must(
      supabase()
        .from("invoice_tracking")
        .upsert(
          { ...trackingToRow(tracking), business_id: doc.businessId },
          { onConflict: "document_id" },
        )
        .select()
        .single(),
    ),
  );
}

/**
 * Calls the send-invoice Edge Function. `failure` carries the function's own
 * explanation (and, for refused invoice emails, the logged attempt).
 */
async function callSendFunction<T>(
  body: object,
  name = "send-invoice",
): Promise<{
  data: T | null;
  failure: { error?: string; log?: unknown } | null;
}> {
  let result;
  try {
    result = await supabase().functions.invoke<T>(name, { body });
  } catch {
    throw new Error(OFFLINE);
  }
  if (!result.error) return { data: result.data, failure: null };
  const context = (result.error as { context?: Response }).context;
  const failure = await context
    ?.clone()
    .json()
    .catch(() => null);
  if (failure) return { data: null, failure };
  if (/Failed to send a request|fetch/i.test(result.error.message))
    throw new Error(
      `Couldn’t reach the email service. Check your connection, or ask an administrator to deploy the ${name} function.`,
    );
  throw new Error(result.error.message || "The email service failed.");
}

/**
 * Saves an issued invoice's PDF once (later emails and reminders attach this
 * exact file). An existing file is kept: issued invoices never change.
 */
async function saveInvoicePdf(doc: BusinessDocument) {
  const path = `${doc.businessId}/${doc.id}.pdf`;
  const bucket = supabase().storage.from("invoice-pdfs");
  const { data: existing } = await bucket.list(doc.businessId, {
    search: `${doc.id}.pdf`,
  });
  if (existing?.some((f) => f.name === `${doc.id}.pdf`)) return;
  const { renderPDF } = await import("../pdf/document-pdf");
  const { error } = await bucket.upload(path, await renderPDF(doc), {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error && !/exists|duplicate/i.test(error.message))
    throw new Error(
      `The invoice PDF could not be saved for emailing. ${error.message}`,
    );
}

const found = <T extends { id: string }>(records: T[], id: string) => {
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error("This record no longer exists.");
  return record;
};

async function employeeFor(user: User): Promise<Employee | null> {
  const { data, error } = await supabase()
    .from("employees")
    // "*" so sign-in still works before the roles update adds `role`.
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(databaseMessage(error));
  if (!data) return null;
  const metadata = user.user_metadata as { full_name?: string } | undefined;
  return {
    id: user.id,
    email: user.email ?? "",
    role: data.role === "admin" ? "admin" : "staff",
    name:
      (data.full_name as string) ||
      metadata?.full_name ||
      (user.email ?? "Employee"),
  };
}

const signOutHere = () =>
  // "local" ends this browser's session only. The shared demo account may be
  // signed in elsewhere, and "global" would sign those people out too.
  supabase()
    .auth.signOut({ scope: "local" })
    .catch(() => undefined);

/** Explains why an update to a draft or issued invoice matched no row. */
async function draftConflict(
  id: string,
  opened: BusinessDocument["status"],
): Promise<never> {
  const { data } = await supabase()
    .from("documents")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  throw new Error(
    opened === "issued"
      ? "Another employee changed this document after you opened it. Refresh the page to see their version, then make your changes again."
      : data?.status === "issued"
        ? "Another employee has issued this document, so it can no longer be edited as a draft. Refresh the page to see the issued version."
        : "Another employee saved changes to this draft after you opened it. Refresh the page to see their version, then make your changes again.",
  );
}

export function createSupabaseStore(): Store {
  return {
    backend: "supabase",

    async currentEmployee() {
      const {
        data: { session },
      } = await supabase().auth.getSession();
      if (!session) return null;
      const employee = await employeeFor(session.user);
      if (!employee) await signOutHere();
      return employee;
    },

    onAuthChange(listener) {
      if (!supabaseConfig) return () => {};
      const {
        data: { subscription },
      } = supabase().auth.onAuthStateChange((event) => {
        // Defer: Supabase must not be called from inside this callback.
        if (["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event))
          setTimeout(listener, 0);
      });
      return () => subscription.unsubscribe();
    },

    async signIn(email, password) {
      let response;
      try {
        response = await supabase().auth.signInWithPassword({
          email: email.trim(),
          password,
        });
      } catch (e) {
        throw new Error(signInMessage(e as Error));
      }
      if (response.error) throw new Error(signInMessage(response.error));
      const employee = await employeeFor(response.data.user);
      if (!employee) {
        await signOutHere();
        throw new Error(
          "This account isn’t set up for Africonnect Invoicing yet. Ask an administrator to add you as an employee.",
        );
      }
      return employee;
    },

    async signOut() {
      await signOutHere();
    },

    async load() {
      // Documents first, then what they point to: records are never deleted,
      // so everything a loaded document references is guaranteed to load.
      const documents = await selectAll<DocumentRow>("documents");
      const [customers, items] = await Promise.all([
        selectAll<CustomerRow>("customers"),
        selectAll<ItemRow>("items"),
      ]);
      const businesses = await selectAll<BusinessRow>("businesses");
      // Admins get every employee and access row; Staff only their own.
      const [
        employees,
        access,
        payments,
        tracking,
        emails,
        reminders,
        mailSettings,
      ] = await Promise.all([
        optionalRows<EmployeeRow>(
          supabase().from("employees").select("*").order("full_name"),
        ),
        optionalRows<AccessRow>(
          supabase().from("business_access").select("business_id, user_id"),
        ),
        optionalRows<PaymentRow>(
          supabase().from("payments").select("*").order("paid_on"),
        ),
        optionalRows<TrackingRow>(
          supabase().from("invoice_tracking").select("*"),
        ),
        optionalRows<EmailRow>(
          supabase()
            .from("email_log")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(1000),
        ),
        optionalRows<ReminderRow>(
          supabase()
            .from("reminders")
            .select("*")
            .order("send_on", { ascending: false })
            .limit(2000),
        ),
        // Admins only (row-level security); Staff get none.
        optionalRows<MailSettingsRow>(
          supabase()
            .from("mail_settings")
            .select("business_id, host, port, username, updated_at"),
        ),
      ]);
      const db = rowsToDatabase({
        businesses,
        customers,
        items,
        documents,
        employees,
        access,
        payments,
        tracking,
        emails,
        mailSettings,
        reminders,
      });
      try {
        return parseDatabase(JSON.stringify(db));
      } catch {
        throw new Error(
          "Some records in the database are not in the expected format, so the workspace could not open safely. Ask an administrator to check the latest database changes.",
        );
      }
    },

    async saveBusiness(db, business) {
      // Same validation as the browser-only demo.
      const row = businessToRow(
        found(upsertBusiness(db, business).businesses, business.id),
      );
      if (!db.businesses.some((b) => b.id === business.id))
        return rowToBusiness(
          await must(
            supabase()
              .from("businesses")
              .insert(
                omit(row, "is_super", "auto_reminders", "reminder_offsets"),
              )
              .select()
              .single(),
          ),
        );
      // Archive and super-business status are changed separately, so a
      // profile edit never undoes another employee's change to them.
      return rowToBusiness(
        await must(
          supabase()
            .from("businesses")
            // Automatic reminders are changed by Admins on their own card.
            .update(
              omit(
                row,
                "id",
                "archived",
                "is_super",
                "auto_reminders",
                "reminder_offsets",
              ),
            )
            .eq("id", row.id)
            .select()
            .single(),
        ),
      );
    },

    async setBusinessArchived(db, id, archived) {
      found(db.businesses, id);
      return rowToBusiness(
        await must(
          supabase()
            .from("businesses")
            .update({ archived })
            .eq("id", id)
            .select()
            .single(),
        ),
      );
    },

    async setBusinessSuper(db, id, isSuper) {
      setSuper(db, id, isSuper);
      return rowToBusiness(
        await must(
          supabase()
            .from("businesses")
            .update({ is_super: isSuper })
            .eq("id", id)
            .select()
            .single(),
        ),
      );
    },

    async setEmployeeRole(db, userId, role) {
      setRole(db, userId, role);
      const row = await maybe<EmployeeRow>(
        supabase()
          .from("employees")
          .update({ role })
          .eq("user_id", userId)
          .select("*")
          .maybeSingle(),
      );
      // Row-level security hides the change from anyone but an Admin.
      if (!row) throw new Error("Only an admin can change roles.");
      return rowToEmployee(row);
    },

    async setBusinessAccess(db, businessId, userId, granted) {
      setAccess(db, businessId, userId, granted);
      if (granted)
        await maybe(
          supabase()
            .from("business_access")
            .upsert(
              { business_id: businessId, user_id: userId },
              { ignoreDuplicates: true },
            ),
        );
      else
        await maybe(
          supabase()
            .from("business_access")
            .delete()
            .eq("business_id", businessId)
            .eq("user_id", userId),
        );
    },

    async recordPayment(db, payment) {
      const next = recordPayment(db, payment);
      const row = paymentToRow(found(next.payments, payment.id));
      return rowToPayment(
        await must(supabase().from("payments").insert(row).select().single()),
      );
    },

    async deletePayment(db, id) {
      deletePayment(db, id);
      const rows = await maybe<{ id: string }[]>(
        supabase().from("payments").delete().eq("id", id).select("id"),
      );
      if (!rows?.length) throw new Error(databaseMessage({ code: "PGRST116" }));
    },

    async setDueDate(db, documentId, dueDate) {
      return saveTracking(setDueDate(db, documentId, dueDate), documentId);
    },

    async setInvoiceCancelled(db, documentId, cancelled, reason) {
      return saveTracking(
        cancelled
          ? cancelInvoice(db, documentId, reason)
          : restoreInvoice(db, documentId),
        documentId,
      );
    },

    async sendInvoice(db, request) {
      const doc = checkSend(db, request);
      await saveInvoicePdf(doc);
      const { data, failure } = await callSendFunction<{ log?: EmailRow }>(
        request,
      );
      // Refused by the mail server: the attempt is logged, show it as failed.
      const log = data?.log ?? failure?.log;
      if (log) return rowToEmail(log as EmailRow);
      throw new Error(failure?.error || "The invoice could not be sent.");
    },

    async saveReminderRules(db, businessId, enabled, offsets) {
      const next = setReminderRules(db, businessId, enabled, offsets);
      const business = found(next.businesses, businessId);
      return rowToBusiness(
        await must(
          supabase()
            .from("businesses")
            .update({
              auto_reminders: business.autoReminders,
              reminder_offsets: business.reminderOffsets,
            })
            .eq("id", businessId)
            .select()
            .single(),
        ),
      );
    },

    async setAutoRemindersPaused(db, documentId, paused) {
      return saveTracking(
        setAutoRemindersPaused(db, documentId, paused),
        documentId,
      );
    },

    async scheduleReminder(db, input) {
      const doc = checkReminder(db, input);
      // The daily run attaches the saved PDF, so make sure it exists now.
      await saveInvoicePdf(doc);
      return rowToReminder(
        await must(
          supabase()
            .from("reminders")
            .insert({
              id: input.id,
              document_id: doc.id,
              business_id: doc.businessId,
              send_on: input.sendOn,
              recipients: input.recipients,
              cc: input.cc,
              subject: input.subject.trim(),
              message: input.message,
            })
            .select()
            .single(),
        ),
      );
    },

    async cancelReminder(db, id) {
      cancelReminder(db, id);
      return rowToReminder(
        await must(
          supabase()
            .from("reminders")
            .update({ status: "cancelled" })
            .eq("id", id)
            .eq("status", "scheduled")
            .select()
            .single(),
        ),
      );
    },

    async sendReminderNow(db, id) {
      const reminder = found(db.reminders, id);
      if (reminder.status !== "scheduled")
        throw new Error("This reminder is no longer scheduled.");
      await saveInvoicePdf(found(db.documents, reminder.documentId));
      const { data, failure } = await callSendFunction<{
        reminder?: ReminderRow;
        log?: EmailRow | null;
      }>({ reminderId: id }, "send-reminders");
      if (!data?.reminder)
        throw new Error(failure?.error || "The reminder could not be sent.");
      return {
        reminder: rowToReminder(data.reminder),
        log: data.log ? rowToEmail(data.log) : null,
      };
    },

    async saveMailSettings(db, settings) {
      checkMailSettings(db, settings);
      await maybe(
        supabase().rpc("set_mail_settings", {
          target: settings.businessId,
          mail_host: settings.host.trim(),
          mail_port: settings.port,
          mail_username: settings.username.trim(),
          mail_password: settings.password,
        }),
      );
      return rowToMailSettings(
        await must(
          supabase()
            .from("mail_settings")
            .select("business_id, host, port, username, updated_at")
            .eq("business_id", settings.businessId)
            .single(),
        ),
      );
    },

    async sendTestEmail(db, businessId, to) {
      if (!db.mailSettings.some((m) => m.businessId === businessId))
        throw new Error("Save the mail settings first.");
      const { data, failure } = await callSendFunction<{ to?: string }>({
        action: "test",
        businessId,
        to,
      });
      if (data?.to) return { to: data.to };
      throw new Error(failure?.error || "The test email failed.");
    },

    async saveCustomer(db, customer) {
      const row = customerToRow(
        found(upsertRecord(db, "customers", customer).customers, customer.id),
      );
      if (!db.customers.some((c) => c.id === customer.id))
        return rowToCustomer(
          await must(
            supabase().from("customers").insert(row).select().single(),
          ),
        );
      return rowToCustomer(
        await must(
          supabase()
            .from("customers")
            .update(omit(row, "id", "business_id"))
            .eq("id", row.id)
            .select()
            .single(),
        ),
      );
    },

    async saveItem(db, item) {
      const row = itemToRow(
        found(upsertRecord(db, "items", item).items, item.id),
      );
      if (!db.items.some((i) => i.id === item.id))
        return rowToItem(
          await must(supabase().from("items").insert(row).select().single()),
        );
      return rowToItem(
        await must(
          supabase()
            .from("items")
            .update(omit(row, "id", "business_id"))
            .eq("id", row.id)
            .select()
            .single(),
        ),
      );
    },

    async deleteCustomer(db, id) {
      const name = found(db.customers, id).name;
      removeRecord(db, "customers", id);
      // Another employee may have used the customer since the page loaded.
      await deleteRow("customers", id, customerInUse(name));
    },

    async deleteItem(db, id) {
      removeRecord(db, "items", id);
      await deleteRow("items", id);
    },

    async saveDocument(db, input, issue) {
      // Validates, refreshes the issuer/customer snapshot and totals.
      const doc = found(saveDocument(db, input, issue).documents, input.id);
      const existing = db.documents.find((d) => d.id === input.id);
      if (!existing)
        return afterSave(
          rowToDocument(
            await must(
              supabase()
                .from("documents")
                // The database assigns numbers only on issue, including
                // concurrent issues by different employees.
                .insert(forInsert({ ...doc, number: "" }))
                .select()
                .single(),
            ),
          ),
        );
      // Only update the version this employee opened (not a newer one that
      // arrived in the background), in the status they opened it in.
      const row = await maybe<DocumentRow>(
        supabase()
          .from("documents")
          .update(
            omit(
              forInsert({ ...doc, number: "" }),
              "id",
              "business_id",
              "kind",
              "source_quotation_id",
            ),
          )
          .eq("id", doc.id)
          .eq("status", existing.status)
          .eq("updated_at", input.updatedAt)
          .select()
          .maybeSingle(),
      );
      return row
        ? afterSave(rowToDocument(row))
        : draftConflict(doc.id, existing.status);

      /** Saves the PDF of a super business's newly issued invoice for emailing. */
      async function afterSave(saved: BusinessDocument) {
        if (issue && tracksPayments(db, saved))
          // Best effort: sending saves it later if this fails.
          await saveInvoicePdf(saved).catch(() => undefined);
        return saved;
      }
    },

    async convertQuotation(db, quotationId) {
      const linked = db.documents.find(
        (d) => d.sourceQuotationId === quotationId,
      );
      if (linked) return linked;
      const result = convertQuotation(db, quotationId);
      const invoice = found(result.db.documents, result.invoiceId);
      let inserted: Result<DocumentRow>;
      try {
        inserted = await supabase()
          .from("documents")
          .insert(forInsert(invoice))
          .select()
          .single();
      } catch {
        throw new Error(OFFLINE);
      }
      // Another employee converted it first: open their invoice instead.
      if (inserted.error?.code === "23505")
        return rowToDocument(
          await must<DocumentRow>(
            supabase()
              .from("documents")
              .select()
              .eq("source_quotation_id", quotationId)
              .single(),
          ),
        );
      if (inserted.error) throw new Error(databaseMessage(inserted.error));
      return rowToDocument(inserted.data!);
    },

    async uploadLogo(businessId, file) {
      // A new file name every time: issued documents keep pointing at the
      // logo they were issued with, even after the business changes it.
      const path = `${businessId}/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
      const bucket = supabase().storage.from(LOGO_BUCKET);
      let failure: Parameters<typeof storageMessage>[0] | null = null;
      try {
        const { error } = await bucket.upload(path, file, {
          contentType: file.type,
          cacheControl: "31536000",
          upsert: false,
        });
        failure = error;
      } catch (e) {
        failure = e as Error;
      }
      if (failure) throw new Error(storageMessage(failure, file.size));
      return bucket.getPublicUrl(path).data.publicUrl;
    },
  };
}

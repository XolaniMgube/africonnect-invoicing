/**
 * The data backend behind the workspace. Two implementations exist:
 *
 * - `local-store.ts`: the original browser-only demo (localStorage and a
 *   demo sign-in). Used when Supabase is not configured, and by the e2e suite.
 * - `supabase-store.ts`: Supabase Auth, Postgres and Storage.
 *
 * Every write receives the records currently on screen, runs the shared
 * domain rules on them first (validation, snapshots, totals), and resolves
 * with the record exactly as saved. The provider merges that record back in.
 */
import type {
  Business,
  BusinessDocument,
  Customer,
  Database,
  ReferenceItem,
  EmailLog,
  MailSettings,
  Reminder,
  EmployeeRecord,
  InvoiceTracking,
  Payment,
  Role,
} from "../domain/types";
import { linkConversions } from "./rows";
import type { SendRequest } from "../../supabase/functions/_shared/invoice-email";
import type { ReminderInput } from "../domain/receivables";

export type Employee = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type Backend = "local" | "supabase";

export interface Store {
  readonly backend: Backend;

  /** The signed-in employee, or null. Rejects only when it cannot tell. */
  currentEmployee(): Promise<Employee | null>;
  /** Calls `listener` after another tab signs in or out. Returns unsubscribe. */
  onAuthChange(listener: () => void): () => void;
  signIn(email: string, password: string): Promise<Employee>;
  signOut(): Promise<void>;

  load(): Promise<Database>;
  saveBusiness(db: Database, business: Business): Promise<Business>;
  setBusinessArchived(
    db: Database,
    id: string,
    archived: boolean,
  ): Promise<Business>;
  /** Admin only. */
  setBusinessSuper(
    db: Database,
    id: string,
    isSuper: boolean,
  ): Promise<Business>;
  /** Admin only. Refuses to remove the last Admin. */
  setEmployeeRole(
    db: Database,
    userId: string,
    role: Role,
  ): Promise<EmployeeRecord>;
  /** Admin only: lets a Staff member see a super business, or not. */
  setBusinessAccess(
    db: Database,
    businessId: string,
    userId: string,
    granted: boolean,
  ): Promise<void>;
  /** Super businesses' issued invoices only (see domain/receivables.ts). */
  recordPayment(
    db: Database,
    payment: Omit<Payment, "businessId">,
  ): Promise<Payment>;
  deletePayment(db: Database, id: string): Promise<void>;
  setDueDate(
    db: Database,
    documentId: string,
    dueDate: string,
  ): Promise<InvoiceTracking>;
  setInvoiceCancelled(
    db: Database,
    documentId: string,
    cancelled: boolean,
    reason: string,
  ): Promise<InvoiceTracking>;
  /** Admin only. An empty password keeps the saved one. */
  saveMailSettings(
    db: Database,
    settings: Omit<MailSettings, "updatedAt"> & { password: string },
  ): Promise<MailSettings>;
  /** Admin only: emails the signed-in admin through the saved mailbox. */
  sendTestEmail(
    db: Database,
    businessId: string,
    to: string,
  ): Promise<{ to: string }>;
  /** Admin only: automatic reminders on/off and their days. */
  saveReminderRules(
    db: Database,
    businessId: string,
    enabled: boolean,
    offsets: number[],
  ): Promise<Business>;
  /** Admin only: pause or resume one invoice's automatic reminders. */
  setAutoRemindersPaused(
    db: Database,
    documentId: string,
    paused: boolean,
  ): Promise<InvoiceTracking>;
  /** Admin only: a payment reminder for an issued invoice with a balance. */
  scheduleReminder(db: Database, input: ReminderInput): Promise<Reminder>;
  /** Admin only. */
  cancelReminder(db: Database, id: string): Promise<Reminder>;
  /** Admin only: sends a scheduled reminder now instead of on its date. */
  sendReminderNow(
    db: Database,
    id: string,
  ): Promise<{ reminder: Reminder; log: EmailLog | null }>;
  /** Emails an issued invoice of a super business, with its PDF. */
  sendInvoice(db: Database, request: SendRequest): Promise<EmailLog>;
  saveCustomer(db: Database, customer: Customer): Promise<Customer>;
  saveItem(db: Database, item: ReferenceItem): Promise<ReferenceItem>;
  /** Refuses a customer that any invoice or quotation uses. */
  deleteCustomer(db: Database, id: string): Promise<void>;
  deleteItem(db: Database, id: string): Promise<void>;
  saveDocument(
    db: Database,
    doc: BusinessDocument,
    issue: boolean,
  ): Promise<BusinessDocument>;
  /** Resolves with the linked invoice (an existing one if already converted). */
  convertQuotation(
    db: Database,
    quotationId: string,
  ): Promise<BusinessDocument>;
  /** Stores a validated PNG/JPEG logo and resolves with the URL to save. */
  uploadLogo(businessId: string, file: File): Promise<string>;
}

const env = {
  backend: process.env.NEXT_PUBLIC_DATA_BACKEND,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

export const supabaseConfig =
  env.url && env.key ? { url: env.url, key: env.key } : null;

/** Set automatically on Vercel builds ("production", "preview", "development"). */
const vercel = process.env.NEXT_PUBLIC_VERCEL_ENV;

/**
 * `NEXT_PUBLIC_DATA_BACKEND` chooses explicitly. Without it, Supabase is used
 * whenever its URL and key are set, and always on Vercel, so a deployment
 * built without the keys shows an error instead of quietly becoming the
 * browser-only demo.
 */
export const backend: Backend =
  env.backend === "local"
    ? "local"
    : env.backend === "supabase" || supabaseConfig || vercel
      ? "supabase"
      : "local";

const missing = [
  !env.url && "NEXT_PUBLIC_SUPABASE_URL",
  !env.key && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
].filter(Boolean);

export const configError =
  backend === "supabase" && !supabaseConfig
    ? vercel
      ? `This deployment was built without ${missing.join(" and ")}. In Vercel → Settings → Environment Variables, add ${missing.length > 1 ? "them" : "it"} for the ${vercel} environment, then redeploy (build cache off).`
      : `Supabase is selected but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing. Add ${missing.length > 1 ? "both" : "it"} to .env.local and restart the app.`
    : "";

/** Applies a saved record to the records on screen. */
export function merge(
  db: Database,
  collection: "businesses",
  record: Business,
): Database;
export function merge(
  db: Database,
  collection: "customers",
  record: Customer,
): Database;
export function merge(
  db: Database,
  collection: "items",
  record: ReferenceItem,
): Database;
export function merge(
  db: Database,
  collection: "documents",
  record: BusinessDocument,
): Database;
export function merge(
  db: Database,
  collection: "businesses" | "customers" | "items" | "documents",
  record: Business | Customer | ReferenceItem | BusinessDocument,
): Database {
  const records = db[collection] as { id: string }[];
  const i = records.findIndex((r) => r.id === record.id);
  const next =
    i < 0
      ? collection === "documents"
        ? [record, ...records]
        : [...records, record]
      : records.map((r, j) => (j === i ? record : r));
  const merged = { ...db, [collection]: next } as Database;
  // Keep the quotation ↔ invoice link visible on both sides.
  if (collection === "documents")
    merged.documents = linkConversions(merged.documents);
  return merged;
}

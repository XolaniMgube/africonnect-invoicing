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
} from "../domain/types";
import { linkConversions } from "./rows";

export type Employee = { id: string; name: string; email: string };

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
  saveCustomer(db: Database, customer: Customer): Promise<Customer>;
  saveItem(db: Database, item: ReferenceItem): Promise<ReferenceItem>;
  setItemArchived(
    db: Database,
    id: string,
    archived: boolean,
  ): Promise<ReferenceItem>;
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

/**
 * `NEXT_PUBLIC_DATA_BACKEND` chooses explicitly. Without it, Supabase is used
 * whenever its URL and key are set. Production should set it to "supabase"
 * so a missing key shows an error instead of quietly using browser storage.
 */
export const backend: Backend =
  env.backend === "local"
    ? "local"
    : env.backend === "supabase" || supabaseConfig
      ? "supabase"
      : "local";

export const configError =
  backend === "supabase" && !supabaseConfig
    ? "Supabase is selected but NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing. Add both to .env.local and restart the app."
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

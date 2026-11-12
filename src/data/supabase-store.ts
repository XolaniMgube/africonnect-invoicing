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
import type { BusinessDocument } from "../domain/types";
import { convertQuotation, saveDocument } from "../domain/documents";
import { parseDatabase, upsertBusiness, upsertRecord } from "./repository";
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

const found = <T extends { id: string }>(records: T[], id: string) => {
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error("This record no longer exists.");
  return record;
};

async function employeeFor(user: User): Promise<Employee | null> {
  const { data, error } = await supabase()
    .from("employees")
    .select("full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(databaseMessage(error));
  if (!data) return null;
  const metadata = user.user_metadata as { full_name?: string } | undefined;
  return {
    id: user.id,
    email: user.email ?? "",
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
      const db = rowsToDatabase({ businesses, customers, items, documents });
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
            supabase().from("businesses").insert(row).select().single(),
          ),
        );
      // Archive status is changed separately, so a profile edit never undoes
      // another employee's archive.
      return rowToBusiness(
        await must(
          supabase()
            .from("businesses")
            .update(omit(row, "id", "archived"))
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
            .update(omit(row, "id", "business_id", "archived"))
            .eq("id", row.id)
            .select()
            .single(),
        ),
      );
    },

    async setItemArchived(db, id, archived) {
      const current = found(db.items, id);
      upsertRecord(db, "items", { ...current, archived });
      return rowToItem(
        await must(
          supabase()
            .from("items")
            .update({ archived })
            .eq("id", id)
            .select()
            .single(),
        ),
      );
    },

    async saveDocument(db, input, issue) {
      // Validates, refreshes the issuer/customer snapshot and totals.
      const doc = found(saveDocument(db, input, issue).documents, input.id);
      const existing = db.documents.find((d) => d.id === input.id);
      if (!existing)
        return rowToDocument(
          await must(
            supabase()
              .from("documents")
              // The database assigns numbers only on issue, including
              // concurrent issues by different employees.
              .insert(forInsert({ ...doc, number: "" }))
              .select()
              .single(),
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
      return row ? rowToDocument(row) : draftConflict(doc.id, existing.status);
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

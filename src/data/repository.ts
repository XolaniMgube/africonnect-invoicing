import { z } from "zod";
import type {
  Business,
  Customer,
  Database,
  ReferenceItem,
  Role,
} from "../domain/types";
import { createFixtures, demoEmployees } from "./fixtures";
import { validateBusiness } from "../domain/businesses";
import { DESIGN_DEFAULTS } from "../domain/templates";
const str = z.string();
const num = z.number().finite();
const businessSchema = z.object({
  id: str,
  name: str.min(1),
  industry: str,
  email: str,
  phone: str,
  address: str,
  registration: str,
  vat: str,
  bank: str,
  accountName: str,
  accountNumber: str,
  branch: str,
  archived: z.boolean(),
  isSuper: z.boolean().default(false),
  emailFrom: str.default(""),
  logo: str,
  accent: str.regex(/^#[a-f\d]{6}$/i),
  // Design fields arrived later: older saved records get the defaults.
  template: z
    .enum(["classic", "executive"])
    .catch(DESIGN_DEFAULTS.template)
    .default(DESIGN_DEFAULTS.template),
  secondaryAccent: str
    .regex(/^#[a-f\d]{6}$/i)
    .catch(DESIGN_DEFAULTS.secondaryAccent)
    .default(DESIGN_DEFAULTS.secondaryAccent),
  signatoryName: str.default(""),
  signatoryTitle: str.default(""),
  closingMessage: str.default(DESIGN_DEFAULTS.closingMessage),
  invoicePrefix: str,
  quotationPrefix: str,
  paymentDays: num.int().min(0).max(365),
  validityDays: num.int().min(0).max(365),
  notes: str,
  taxRate: num.min(0).max(100),
});
const customerSchema = z.object({
  id: str,
  businessId: str,
  name: str.min(1),
  contact: str,
  email: str,
  phone: str,
  address: str,
  registration: str,
  vat: str,
});
const itemSchema = z.object({
  id: str,
  businessId: str,
  name: str.min(1),
  description: str,
  category: str,
  unit: str,
  price: num.min(0).max(1e9),
});
const lineSchema = z.object({
  id: str,
  referenceId: str.optional(),
  name: str,
  description: str,
  unit: str,
  quantity: num,
  price: num,
});
const schema = z.object({
  version: z.literal(1),
  businesses: z.array(businessSchema),
  customers: z.array(customerSchema),
  items: z.array(itemSchema),
  documents: z.array(
    z.object({
      id: str,
      businessId: str,
      customerId: str,
      kind: z.enum(["invoice", "quotation"]),
      number: str,
      status: z.enum(["draft", "issued"]),
      date: str,
      endDate: str,
      terms: str,
      notes: str,
      taxRate: num,
      discountAmount: num.min(0).default(0),
      showItemPrices: z.boolean().default(true),
      lines: z.array(lineSchema),
      snapshot: z.object({ issuer: businessSchema, customer: customerSchema }),
      totals: z.object({ subtotal: num, tax: num, total: num }),
      revisionOfId: str.optional(),
      sourceQuotationId: str.optional(),
      sourceQuotationNumber: str.optional(),
      linkedInvoiceId: str.optional(),
      updatedAt: str,
    }),
  ),
  // Added with roles; older browser data gets the demo users.
  employees: z
    .array(
      z.object({
        id: str,
        name: str,
        email: str,
        role: z.enum(["admin", "staff"]),
      }),
    )
    .default(demoEmployees),
  access: z.array(z.object({ businessId: str, userId: str })).default([]),
  // Added with payments.
  payments: z
    .array(
      z.object({
        id: str,
        documentId: str,
        businessId: str,
        amount: num.positive(),
        paidOn: str,
        method: z.enum(["eft", "cash", "card", "other"]),
        reference: str,
      }),
    )
    .default([]),
  tracking: z
    .array(
      z.object({
        documentId: str,
        dueDate: str.optional(),
        cancelledAt: str.optional(),
        cancelReason: str,
      }),
    )
    .default([]),
  // Added with email.
  emails: z
    .array(
      z.object({
        id: str,
        documentId: str,
        businessId: str,
        kind: z.enum(["invoice", "reminder"]),
        recipients: z.array(str),
        cc: z.array(str),
        subject: str,
        status: z.enum(["sent", "failed", "demo"]),
        error: str,
        createdAt: str,
      }),
    )
    .default([]),
});
export const STORAGE_KEY = "africonnect-invoicing:v1";
export type StoragePort = Pick<Storage, "getItem" | "setItem">;
export function parseDatabase(raw: string): Database {
  const data = schema.parse(JSON.parse(raw));
  for (const records of [
    data.businesses,
    data.customers,
    data.items,
    data.documents,
  ]) {
    if (new Set(records.map((r) => r.id)).size !== records.length)
      throw new Error("Duplicate record IDs.");
  }
  const businesses = new Set(data.businesses.map((b) => b.id));
  const documents = new Set(data.documents.map((d) => d.id));
  for (const r of [...data.payments, ...data.tracking, ...data.emails])
    if (!documents.has(r.documentId))
      throw new Error("Invalid payment relationship.");
  const people = new Set(data.employees.map((e) => e.id));
  for (const a of data.access)
    if (!businesses.has(a.businessId) || !people.has(a.userId))
      throw new Error("Invalid access relationship.");
  for (const r of [...data.customers, ...data.items, ...data.documents])
    if (!businesses.has(r.businessId))
      throw new Error("Missing business relationship.");
  for (const doc of data.documents) {
    if (doc.status === "draft") doc.number = "";
    if (
      doc.revisionOfId &&
      !data.documents.some(
        (d) =>
          d.id === doc.revisionOfId &&
          d.status === "issued" &&
          d.businessId === doc.businessId &&
          d.kind === doc.kind,
      )
    )
      throw new Error("Invalid revision relationship.");
    if (
      !data.customers.some(
        (c) => c.id === doc.customerId && c.businessId === doc.businessId,
      ) ||
      doc.snapshot.issuer.id !== doc.businessId ||
      doc.snapshot.customer.id !== doc.customerId
    )
      throw new Error("Invalid document relationship.");
    if (
      doc.linkedInvoiceId &&
      !data.documents.some(
        (d) =>
          d.id === doc.linkedInvoiceId &&
          d.sourceQuotationId === doc.id &&
          d.businessId === doc.businessId,
      )
    )
      throw new Error("Invalid conversion link.");
  }
  return data;
}
export function loadDatabase(storage: StoragePort): Database {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? createFixtures() : parseDatabase(raw);
  } catch {
    throw new Error(
      "Saved records could not be opened. Your existing data has not been changed. Allow browser storage or restore a valid backup, then retry.",
    );
  }
}
export function persistDatabase(storage: StoragePort, db: Database): Database {
  const checked = parseDatabase(JSON.stringify(db));
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(checked));
  } catch {
    throw new Error(
      "Changes were not saved. Browser storage may be full or unavailable. Try a smaller logo or allow storage, then save again. Your previous records are unchanged.",
    );
  }
  return checked;
}
export function upsertBusiness(db: Database, business: Business): Database {
  const errors = validateBusiness(business);
  if (errors.length) throw new Error(errors.join("\n"));
  businessSchema.parse(business);
  const next = structuredClone(db);
  const i = next.businesses.findIndex((b) => b.id === business.id);
  if (i < 0) next.businesses.push(business);
  else next.businesses[i] = business;
  return next;
}
export function upsertRecord(
  db: Database,
  collection: "customers",
  record: Customer,
): Database;
export function upsertRecord(
  db: Database,
  collection: "items",
  record: ReferenceItem,
): Database;
export function upsertRecord(
  db: Database,
  collection: "customers" | "items",
  record: Customer | ReferenceItem,
): Database {
  const b = db.businesses.find((b) => b.id === record.businessId);
  if (!b || b.archived)
    throw new Error("Restore this business before editing its records.");
  if (!record.name.trim()) throw new Error("Enter a name.");
  if (collection === "customers") customerSchema.parse(record);
  else itemSchema.parse(record);
  const next = structuredClone(db);
  const records = next[collection] as (Customer | ReferenceItem)[];
  const i = records.findIndex((r) => r.id === record.id);
  if (i >= 0 && records[i].businessId !== record.businessId)
    throw new Error("Cannot move a record between businesses.");
  if (i < 0) records.push(record);
  else records[i] = record;
  return next;
}
/** Why a customer cannot be deleted: documents still use it. */
export function customerInUse(name: string, count?: number) {
  const use =
    count === undefined
      ? "invoices or quotations use"
      : count === 1
        ? "an invoice or quotation uses"
        : `${count} invoices or quotations use`;
  return `${name} can’t be deleted because ${use} this customer. Nothing was deleted.`;
}
/**
 * Deletes a customer or reference item. A customer used by any invoice or
 * quotation (draft or issued) is kept. Document lines copy item details, so
 * deleting an item never changes a document.
 */
export function removeRecord(
  db: Database,
  collection: "customers" | "items",
  id: string,
): Database {
  const records = db[collection] as (Customer | ReferenceItem)[];
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error("This record no longer exists.");
  const b = db.businesses.find((b) => b.id === record.businessId);
  if (!b || b.archived)
    throw new Error("Restore this business before editing its records.");
  if (collection === "customers") {
    const used = db.documents.filter((d) => d.customerId === id).length;
    if (used) throw new Error(customerInUse(record.name, used));
  }
  return { ...db, [collection]: records.filter((r) => r.id !== id) };
}
/** Admin: make a business a super business, or an ordinary one again. */
export function setSuper(db: Database, id: string, isSuper: boolean): Database {
  const business = db.businesses.find((b) => b.id === id);
  if (!business) throw new Error("This business no longer exists.");
  return {
    ...db,
    businesses: db.businesses.map((b) => (b.id === id ? { ...b, isSuper } : b)),
  };
}
/** Admin: change an employee's role, keeping at least one Admin. */
export function setRole(db: Database, userId: string, role: Role): Database {
  const person = db.employees.find((e) => e.id === userId);
  if (!person) throw new Error("This employee no longer exists.");
  if (
    person.role === "admin" &&
    role !== "admin" &&
    !db.employees.some((e) => e.role === "admin" && e.id !== userId)
  )
    throw new Error("Keep at least one admin.");
  return {
    ...db,
    employees: db.employees.map((e) => (e.id === userId ? { ...e, role } : e)),
  };
}
/** Admin: let a Staff member see a super business, or remove that access. */
export function setAccess(
  db: Database,
  businessId: string,
  userId: string,
  granted: boolean,
): Database {
  if (!db.businesses.some((b) => b.id === businessId))
    throw new Error("This business no longer exists.");
  if (!db.employees.some((e) => e.id === userId))
    throw new Error("This employee no longer exists.");
  const others = db.access.filter(
    (a) => !(a.businessId === businessId && a.userId === userId),
  );
  return {
    ...db,
    access: granted ? [...others, { businessId, userId }] : others,
  };
}

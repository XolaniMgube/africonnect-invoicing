/**
 * Mapping between the app's records (camelCase, see `domain/types.ts`) and
 * Supabase table rows (snake_case, see `supabase/migrations`). Pure and
 * framework-free so it can be unit-tested and reused by the seed generator.
 */
import { withDesignDefaults } from "../domain/templates";
import type {
  Business,
  BusinessDocument,
  DocumentTemplate,
  Customer,
  Database,
  ReferenceItem,
} from "../domain/types";

export type BusinessRow = {
  id: string;
  name: string;
  industry: string;
  email: string;
  phone: string;
  address: string;
  registration: string;
  vat: string;
  bank: string;
  account_name: string;
  account_number: string;
  branch: string;
  logo: string;
  accent: string;
  invoice_prefix: string;
  quotation_prefix: string;
  payment_days: number;
  validity_days: number;
  notes: string;
  tax_rate: number;
  archived: boolean;
  template: string;
  secondary_accent: string;
  signatory_name: string;
  signatory_title: string;
  closing_message: string;
};

export type CustomerRow = {
  id: string;
  business_id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  registration: string;
  vat: string;
};

export type ItemRow = {
  id: string;
  business_id: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  price: number;
};

export type DocumentRow = {
  id: string;
  business_id: string;
  customer_id: string;
  kind: BusinessDocument["kind"];
  number: string;
  status: BusinessDocument["status"];
  document_date: string;
  end_date: string;
  terms: string;
  notes: string;
  tax_rate: number;
  discount_amount: number;
  lines: BusinessDocument["lines"];
  snapshot: BusinessDocument["snapshot"];
  subtotal: number;
  tax: number;
  total: number;
  revision_of_id: string | null;
  source_quotation_id: string | null;
  source_quotation_number: string | null;
  updated_at: string;
};

// PostgREST returns `numeric` columns as JSON numbers, but be defensive.
const n = (value: unknown) => Number(value);
const s = (value: unknown) => (value == null ? "" : String(value));

export const businessToRow = (b: Business): BusinessRow => ({
  id: b.id,
  name: b.name,
  industry: b.industry,
  email: b.email,
  phone: b.phone,
  address: b.address,
  registration: b.registration,
  vat: b.vat,
  bank: b.bank,
  account_name: b.accountName,
  account_number: b.accountNumber,
  branch: b.branch,
  logo: b.logo,
  accent: b.accent,
  invoice_prefix: b.invoicePrefix,
  quotation_prefix: b.quotationPrefix,
  payment_days: b.paymentDays,
  validity_days: b.validityDays,
  notes: b.notes,
  tax_rate: b.taxRate,
  archived: b.archived,
  template: b.template,
  secondary_accent: b.secondaryAccent,
  signatory_name: b.signatoryName,
  signatory_title: b.signatoryTitle,
  closing_message: b.closingMessage,
});

export const rowToBusiness = (r: BusinessRow): Business => ({
  id: r.id,
  name: s(r.name),
  industry: s(r.industry),
  email: s(r.email),
  phone: s(r.phone),
  address: s(r.address),
  registration: s(r.registration),
  vat: s(r.vat),
  bank: s(r.bank),
  accountName: s(r.account_name),
  accountNumber: s(r.account_number),
  branch: s(r.branch),
  logo: s(r.logo),
  accent: s(r.accent),
  invoicePrefix: s(r.invoice_prefix),
  quotationPrefix: s(r.quotation_prefix),
  paymentDays: n(r.payment_days),
  validityDays: n(r.validity_days),
  notes: s(r.notes),
  taxRate: n(r.tax_rate),
  archived: Boolean(r.archived),
  ...withDesignDefaults({
    template: r.template as DocumentTemplate,
    secondaryAccent: r.secondary_accent ?? undefined,
    signatoryName: r.signatory_name ?? undefined,
    signatoryTitle: r.signatory_title ?? undefined,
    closingMessage: r.closing_message ?? undefined,
  }),
});

export const customerToRow = (c: Customer): CustomerRow => ({
  id: c.id,
  business_id: c.businessId,
  name: c.name,
  contact: c.contact,
  email: c.email,
  phone: c.phone,
  address: c.address,
  registration: c.registration,
  vat: c.vat,
});

export const rowToCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  businessId: r.business_id,
  name: s(r.name),
  contact: s(r.contact),
  email: s(r.email),
  phone: s(r.phone),
  address: s(r.address),
  registration: s(r.registration),
  vat: s(r.vat),
});

export const itemToRow = (i: ReferenceItem): ItemRow => ({
  id: i.id,
  business_id: i.businessId,
  name: i.name,
  description: i.description,
  category: i.category,
  unit: i.unit,
  price: i.price,
});

export const rowToItem = (r: ItemRow): ReferenceItem => ({
  id: r.id,
  businessId: r.business_id,
  name: s(r.name),
  description: s(r.description),
  category: s(r.category),
  unit: s(r.unit),
  price: n(r.price),
});

export const documentToRow = (d: BusinessDocument): DocumentRow => ({
  id: d.id,
  business_id: d.businessId,
  customer_id: d.customerId,
  kind: d.kind,
  number: d.number,
  status: d.status,
  document_date: d.date,
  end_date: d.endDate,
  terms: d.terms,
  notes: d.notes,
  tax_rate: d.taxRate,
  discount_amount: d.discountAmount ?? 0,
  lines: d.lines,
  snapshot: d.snapshot,
  subtotal: d.totals.subtotal,
  tax: d.totals.tax,
  total: d.totals.total,
  revision_of_id: d.revisionOfId ?? null,
  source_quotation_id: d.sourceQuotationId ?? null,
  source_quotation_number: d.sourceQuotationNumber ?? null,
  updated_at: d.updatedAt,
});

export function rowToDocument(r: DocumentRow): BusinessDocument {
  const doc: BusinessDocument = {
    id: r.id,
    businessId: r.business_id,
    customerId: r.customer_id,
    kind: r.kind,
    number: s(r.number),
    status: r.status,
    date: s(r.document_date),
    endDate: s(r.end_date),
    terms: s(r.terms),
    notes: s(r.notes),
    taxRate: n(r.tax_rate),
    discountAmount: n(r.discount_amount ?? 0),
    lines: (r.lines ?? []).map((l) => ({
      ...l,
      quantity: n(l.quantity),
      price: n(l.price),
    })),
    // Snapshots issued before templates existed get the default design.
    snapshot: {
      ...r.snapshot,
      issuer: withDesignDefaults(r.snapshot.issuer),
    },
    totals: { subtotal: n(r.subtotal), tax: n(r.tax), total: n(r.total) },
    updatedAt: s(r.updated_at),
  };
  if (r.revision_of_id) doc.revisionOfId = r.revision_of_id;
  if (r.source_quotation_id) {
    doc.sourceQuotationId = r.source_quotation_id;
    doc.sourceQuotationNumber = s(r.source_quotation_number);
  }
  return doc;
}

/**
 * The database records the link on the invoice only (`source_quotation_id`).
 * The app also shows it on the quotation, so derive `linkedInvoiceId`.
 */
export function linkConversions(
  documents: BusinessDocument[],
): BusinessDocument[] {
  const invoiceFor = new Map(
    documents
      .filter((d) => d.sourceQuotationId)
      .map((d) => [d.sourceQuotationId!, d.id]),
  );
  return documents.map((d) => {
    const linked = d.kind === "quotation" ? invoiceFor.get(d.id) : undefined;
    if (linked === d.linkedInvoiceId) return d;
    const next = { ...d };
    if (linked) next.linkedInvoiceId = linked;
    else delete next.linkedInvoiceId;
    return next;
  });
}

/** Newest first, as the local store keeps them. */
const byUpdated = (a: BusinessDocument, b: BusinessDocument) =>
  b.updatedAt.localeCompare(a.updatedAt);

export function rowsToDatabase(rows: {
  businesses: BusinessRow[];
  customers: CustomerRow[];
  items: ItemRow[];
  documents: DocumentRow[];
}): Database {
  return {
    version: 1,
    businesses: rows.businesses.map(rowToBusiness),
    customers: rows.customers.map(rowToCustomer),
    items: rows.items.map(rowToItem),
    documents: linkConversions(rows.documents.map(rowToDocument)).sort(
      byUpdated,
    ),
  };
}

import type {
  Business,
  BusinessDocument,
  Customer,
  Database,
  LineItem,
  Totals,
} from "./types";
export const clone = <T>(value: T): T => structuredClone(value);
export const cents = (value: number) =>
  Math.round((value + Number.EPSILON) * 100);
export function calculate(
  lines: LineItem[],
  taxRate: number,
  discountAmount = 0,
): Totals {
  const subtotal = lines.reduce(
    (sum, line) => sum + cents(line.quantity * line.price),
    0,
  );
  const discountedSubtotal = subtotal - cents(discountAmount);
  const tax = Math.round((discountedSubtotal * taxRate) / 100);
  return {
    subtotal: subtotal / 100,
    tax: tax / 100,
    total: (discountedSubtotal + tax) / 100,
  };
}
export const money = (value: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    value,
  );
export const dateLabel = (value: string) =>
  value
    ? new Date(value + "T12:00:00").toLocaleDateString("en-ZA", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function addDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/**
 * The due (invoice) or expiry (quotation) date stored with a document. It is
 * no longer edited or printed (the terms text says it instead), but the
 * database requires one on or after the document date, so it follows the
 * document date by the business's payment or validity period.
 */
export function endDateFor(
  date: string,
  business: Pick<Business, "paymentDays" | "validityDays">,
  kind: BusinessDocument["kind"],
) {
  try {
    return addDays(
      date,
      kind === "invoice" ? business.paymentDays : business.validityDays,
    );
  } catch {
    return date; // Incomplete date: validation reports the date itself.
  }
}
export function blankDocument(
  business: Business,
  kind: BusinessDocument["kind"],
  customer?: Customer,
): BusinessDocument {
  return {
    id: crypto.randomUUID(),
    businessId: business.id,
    customerId: customer?.id || "",
    kind,
    number: "",
    status: "draft",
    date: today(),
    endDate: addDays(
      today(),
      kind === "invoice" ? business.paymentDays : business.validityDays,
    ),
    terms:
      kind === "invoice"
        ? `Payment within ${business.paymentDays} days.`
        : `Quotation valid for ${business.validityDays} days.`,
    notes: business.notes,
    taxRate: business.taxRate,
    discountAmount: 0,
    showItemPrices: true,
    lines: [],
    snapshot: {
      issuer: clone(business),
      customer: customer
        ? clone(customer)
        : {
            id: "",
            businessId: business.id,
            name: "",
            contact: "",
            email: "",
            phone: "",
            address: "",
            registration: "",
            vat: "",
          },
    },
    totals: { subtotal: 0, tax: 0, total: 0 },
    updatedAt: new Date().toISOString(),
  };
}
/** Longest document number accepted (the database has the same limit). */
export const NUMBER_MAX = 40;
const trailingDigits = (number: string) => number.match(/(\d+)$/)?.[1];
/** Next official number, based only on issued documents of this business/type. */
export function nextNumber(
  documents: BusinessDocument[],
  business: Pick<Business, "id" | "invoicePrefix" | "quotationPrefix">,
  kind: BusinessDocument["kind"],
) {
  let highest: string | undefined;
  for (const d of documents) {
    if (
      d.status !== "issued" ||
      d.businessId !== business.id ||
      d.kind !== kind
    )
      continue;
    const digits = trailingDigits(d.number);
    if (digits && (!highest || BigInt(digits) > BigInt(highest)))
      highest = digits;
  }
  const next = String(BigInt(highest ?? "0") + BigInt(1));
  const digits = next.padStart(highest?.length ?? 4, "0");
  const prefix = (
    kind === "invoice" ? business.invoicePrefix : business.quotationPrefix
  ).trim();
  return prefix ? `${prefix}-${digits}` : digits;
}
/** Why `doc.number` cannot be used, or "" when it can. */
export function numberTaken(
  documents: BusinessDocument[],
  doc: Pick<BusinessDocument, "id" | "businessId" | "kind" | "number">,
) {
  const number = doc.number.trim();
  const other = documents.find(
    (d) =>
      d.status === "issued" &&
      d.id !== doc.id &&
      d.businessId === doc.businessId &&
      d.kind === doc.kind &&
      d.number === number,
  );
  return other
    ? `${doc.kind === "invoice" ? "Invoice" : "Quotation"} number ${number} is already used by another ${doc.kind} of this business. Choose a different number.`
    : "";
}
export function validateDocument(doc: BusinessDocument): string[] {
  const errors: string[] = [];
  if (doc.number.trim().length > NUMBER_MAX)
    errors.push(
      `The ${doc.kind} number can have at most ${NUMBER_MAX} characters.`,
    );
  const validDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!doc.customerId || !doc.snapshot.customer.name.trim())
    errors.push("Choose a customer.");
  if (!validDate(doc.date)) errors.push(`Enter a valid ${doc.kind} date.`);
  // Not shown or edited any more; the editor keeps it in step with the date.
  else if (!validDate(doc.endDate) || doc.endDate < doc.date)
    errors.push(`Choose the ${doc.kind} date again.`);
  if (
    !doc.snapshot.issuer.name.trim() ||
    !doc.snapshot.issuer.address.trim() ||
    !doc.snapshot.issuer.email.trim()
  )
    errors.push(
      "Complete the business name, email and address in business settings.",
    );
  if (!doc.lines.length) errors.push("Add at least one line item.");
  doc.lines.forEach((line, i) => {
    if (!line.name.trim()) errors.push(`Line ${i + 1}: enter an item name.`);
    if (
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      line.quantity > 1e7
    )
      errors.push(
        `Line ${i + 1}: quantity must be positive and no more than 10,000,000.`,
      );
    if (!Number.isFinite(line.price) || line.price < 0 || line.price > 1e9)
      errors.push(`Line ${i + 1}: price must be between 0 and 1,000,000,000.`);
    if (!Number.isSafeInteger(cents(line.quantity * line.price)))
      errors.push(`Line ${i + 1}: amount is too large.`);
  });
  if (!Number.isFinite(doc.taxRate) || doc.taxRate < 0 || doc.taxRate > 100)
    errors.push("Tax rate must be between 0 and 100.");
  const discount = doc.discountAmount ?? 0;
  if (
    !Number.isFinite(discount) ||
    discount < 0 ||
    !Number.isSafeInteger(cents(discount))
  )
    errors.push("Discount amount must be a valid nonnegative amount.");
  else if (Math.abs(discount - cents(discount) / 100) > 1e-9)
    errors.push("Discount amount can have at most two decimal places.");
  else if (discount > calculate(doc.lines, 0).subtotal)
    errors.push("Discount amount cannot exceed the subtotal.");
  if (
    !Number.isSafeInteger(
      cents(calculate(doc.lines, doc.taxRate, discount).total),
    )
  )
    errors.push("Document total is too large.");
  return errors;
}
export function saveDocument(
  db: Database,
  input: BusinessDocument,
  issue = false,
): Database {
  const next = clone(db);
  const existing = next.documents.find((d) => d.id === input.id);
  if (existing?.status === "issued")
    throw new Error(
      "Issued documents are preserved. Create a draft revision to make changes.",
    );
  const business = next.businesses.find((b) => b.id === input.businessId);
  const customer = next.customers.find(
    (c) => c.id === input.customerId && c.businessId === input.businessId,
  );
  if (!business || business.archived)
    throw new Error(
      "Restore this business before creating or editing documents.",
    );
  if (!customer)
    throw new Error("Choose a customer belonging to this business.");
  if (
    existing &&
    (existing.businessId !== input.businessId || existing.kind !== input.kind)
  )
    throw new Error("The document business and type cannot change.");
  const doc = clone(input);
  // Converted drafts retain quoted identities unless the employee explicitly selects a different customer.
  doc.snapshot =
    doc.sourceQuotationId || doc.revisionOfId
      ? {
          issuer: clone(doc.snapshot.issuer),
          customer:
            doc.snapshot.customer.id === customer.id
              ? clone(doc.snapshot.customer)
              : clone(customer),
        }
      : { issuer: clone(business), customer: clone(customer) };
  const errors = validateDocument(doc);
  if (errors.length) throw new Error(errors.join("\n"));
  if (existing && existing.revisionOfId !== doc.revisionOfId)
    throw new Error("The revision origin cannot change.");
  if (
    !existing &&
    doc.revisionOfId &&
    (next.payments ?? []).some((p) => p.documentId === doc.revisionOfId)
  )
    throw new Error(
      "This invoice has payments recorded. Delete them before editing it.",
    );
  if (doc.revisionOfId) {
    const original = next.documents.find((d) => d.id === doc.revisionOfId);
    if (
      !original ||
      original.status !== "issued" ||
      original.businessId !== doc.businessId ||
      original.kind !== doc.kind
    )
      throw new Error(
        "A revision must refer to an issued document of the same business and type.",
      );
  }
  doc.number = issue ? nextNumber(next.documents, business, doc.kind) : "";
  doc.status = issue ? "issued" : "draft";
  doc.discountAmount = cents(doc.discountAmount ?? 0) / 100;
  doc.totals = calculate(doc.lines, doc.taxRate, doc.discountAmount);
  doc.updatedAt = new Date().toISOString();
  const index = next.documents.findIndex((d) => d.id === doc.id);
  if (index < 0) next.documents.unshift(doc);
  else next.documents[index] = doc;
  return next;
}
/** Start a separate draft; the issued original is never changed. */
export function reviseDocument(original: BusinessDocument): BusinessDocument {
  if (original.status !== "issued")
    throw new Error("Only issued documents can be revised.");
  return {
    ...clone(original),
    id: crypto.randomUUID(),
    number: "",
    status: "draft",
    revisionOfId: original.id,
    sourceQuotationId: undefined,
    sourceQuotationNumber: undefined,
    linkedInvoiceId: undefined,
    updatedAt: new Date().toISOString(),
  };
}
export function convertQuotation(
  db: Database,
  id: string,
): { db: Database; invoiceId: string } {
  const quote = db.documents.find((d) => d.id === id);
  if (!quote || quote.kind !== "quotation" || quote.status !== "issued")
    throw new Error("Only issued quotations can be converted.");
  if (quote.linkedInvoiceId) return { db, invoiceId: quote.linkedInvoiceId };
  const business = db.businesses.find((b) => b.id === quote.businessId);
  if (!business || business.archived)
    throw new Error("Restore this business before converting a quotation.");
  const invoice = {
    ...clone(quote),
    id: crypto.randomUUID(),
    kind: "invoice" as const,
    number: "",
    status: "draft" as const,
    date: today(),
    endDate: addDays(today(), business.paymentDays),
    terms: `Payment within ${business.paymentDays} days.`,
    notes: business.notes,
    revisionOfId: undefined,
    sourceQuotationId: quote.id,
    sourceQuotationNumber: quote.number,
    linkedInvoiceId: undefined,
  };
  const next = saveDocument(db, invoice);
  next.documents.find((d) => d.id === id)!.linkedInvoiceId = invoice.id;
  return { db: next, invoiceId: invoice.id };
}
export const scoped = <T extends { businessId: string }>(
  records: T[],
  businessId: string,
) => records.filter((record) => record.businessId === businessId);

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
export function calculate(lines: LineItem[], taxRate: number): Totals {
  const subtotal = lines.reduce(
    (sum, line) => sum + cents(line.quantity * line.price),
    0,
  );
  const tax = Math.round((subtotal * taxRate) / 100);
  return {
    subtotal: subtotal / 100,
    tax: tax / 100,
    total: (subtotal + tax) / 100,
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
export function validateDocument(doc: BusinessDocument): string[] {
  const errors: string[] = [];
  const validDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!doc.customerId || !doc.snapshot.customer.name.trim())
    errors.push("Choose a customer.");
  if (!validDate(doc.date) || !validDate(doc.endDate))
    errors.push("Enter valid document and due / expiry dates.");
  if (doc.endDate < doc.date)
    errors.push("Due / expiry date cannot be before the document date.");
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
  if (doc.taxRate > 0 && !doc.snapshot.issuer.vat.trim())
    errors.push(
      "Add the issuer VAT registration number in business settings before applying VAT.",
    );
  if (!Number.isSafeInteger(cents(calculate(doc.lines, doc.taxRate).total)))
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
    throw new Error("Issued documents are read-only.");
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
  doc.snapshot = doc.sourceQuotationId
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
  if (!existing) {
    const prefix =
      doc.kind === "invoice"
        ? business.invoicePrefix
        : business.quotationPrefix;
    const seq =
      Math.max(
        0,
        ...next.documents
          .filter((d) => d.businessId === business.id && d.kind === doc.kind)
          .map((d) => Number(d.number.match(/(\d+)$/)?.[1]) || 0),
      ) + 1;
    doc.number = `${prefix}-${String(seq).padStart(4, "0")}`;
  } else doc.number = existing.number;
  doc.status = issue ? "issued" : "draft";
  doc.totals = calculate(doc.lines, doc.taxRate);
  doc.updatedAt = new Date().toISOString();
  const index = next.documents.findIndex((d) => d.id === doc.id);
  if (index < 0) next.documents.unshift(doc);
  else next.documents[index] = doc;
  return next;
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

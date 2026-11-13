export type Role = "admin" | "staff";
export type DemoEmployee = {
  id: string;
  name: string;
  email: string;
  role: Role;
};
/** An employee as Admins see them on the Users page. */
export type EmployeeRecord = {
  id: string;
  name: string;
  email: string;
  role: Role;
};
export type PaymentMethod = "eft" | "cash" | "card" | "other";
/** Money received against an issued invoice of a super business. */
export type Payment = {
  id: string;
  documentId: string;
  businessId: string;
  amount: number;
  /** YYYY-MM-DD */
  paidOn: string;
  method: PaymentMethod;
  reference: string;
};
/**
 * Follow-up details of an issued invoice, kept apart from the (unchangeable)
 * invoice itself: a changed due date, or cancellation.
 */
export type InvoiceTracking = {
  documentId: string;
  /** Overrides the due date stored with the invoice. */
  dueDate?: string;
  cancelledAt?: string;
  cancelReason: string;
};
/** One attempt to email an invoice (sent from the send-invoice function). */
export type EmailLog = {
  id: string;
  documentId: string;
  businessId: string;
  kind: "invoice" | "reminder";
  recipients: string[];
  cc: string[];
  subject: string;
  /** "demo": the browser-only demo, nothing was delivered. */
  status: "sent" | "failed" | "demo";
  error: string;
  createdAt: string;
};
/** A Staff member allowed to see a super business (Admins see all). */
export type BusinessAccess = { businessId: string; userId: string };
/** The look of a business's invoices and quotations (see `domain/templates.ts`). */
export type DocumentTemplate = "classic" | "executive";
export type CompanyPreferences = {
  logo: string;
  accent: string;
  template: DocumentTemplate;
  /** Second colour, used by the Executive template. */
  secondaryAccent: string;
  /** Printed under the signature line (Executive). */
  signatoryName: string;
  signatoryTitle: string;
  /** Short line beside the total, e.g. “Thank you for your service!” (Executive). */
  closingMessage: string;
  invoicePrefix: string;
  quotationPrefix: string;
  paymentDays: number;
  validityDays: number;
  notes: string;
  taxRate: number;
};
export type Business = CompanyPreferences & {
  id: string;
  name: string;
  industry: string;
  email: string;
  phone: string;
  address: string;
  registration: string;
  vat: string;
  bank: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  archived: boolean;
  /** Super businesses (e.g. Africonnect itself) get the extra features and are visible only to Admins and Staff given access. */
  isSuper: boolean;
  /** Super businesses: “Send invoices from” address (verified in Resend). */
  emailFrom: string;
};
export type Customer = {
  id: string;
  businessId: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  registration: string;
  vat: string;
};
export type ReferenceItem = {
  id: string;
  businessId: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  price: number;
};
export type LineItem = {
  id: string;
  referenceId?: string;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  price: number;
};
export type Totals = { subtotal: number; tax: number; total: number };
export type DocumentSnapshot = { issuer: Business; customer: Customer };
export type BusinessDocument = {
  id: string;
  businessId: string;
  customerId: string;
  kind: "invoice" | "quotation";
  number: string;
  status: "draft" | "issued";
  date: string;
  endDate: string;
  terms: string;
  notes: string;
  taxRate: number;
  discountAmount: number;
  /** False prints only Description, Qty and Total (no unit price column). */
  showItemPrices: boolean;
  lines: LineItem[];
  snapshot: DocumentSnapshot;
  totals: Totals;
  revisionOfId?: string;
  sourceQuotationId?: string;
  sourceQuotationNumber?: string;
  linkedInvoiceId?: string;
  updatedAt: string;
};
export type Invoice = BusinessDocument & { kind: "invoice" };
export type Quotation = BusinessDocument & { kind: "quotation" };
export type Database = {
  version: 1;
  businesses: Business[];
  customers: Customer[];
  items: ReferenceItem[];
  documents: BusinessDocument[];
  /** Every employee for Admins; only yourself for Staff. */
  employees: EmployeeRecord[];
  access: BusinessAccess[];
  payments: Payment[];
  tracking: InvoiceTracking[];
  emails: EmailLog[];
};
export const units = [
  "Item",
  "Hour",
  "Day",
  "Project",
  "Visit",
  "Metre",
  "Square metre",
];

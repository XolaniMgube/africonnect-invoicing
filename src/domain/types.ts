export type DemoEmployee = { id: string; name: string; email: string };
export type CompanyPreferences = {
  logo: string;
  accent: string;
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
  archived: boolean;
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
  lines: LineItem[];
  snapshot: DocumentSnapshot;
  totals: Totals;
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

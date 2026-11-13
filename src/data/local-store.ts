/**
 * Browser-only backend: records in localStorage, demo sign-in in
 * sessionStorage. Behaves exactly like the original prototype. Not secure.
 */
import type { Store } from "./store";
import {
  loadDatabase,
  persistDatabase,
  removeRecord,
  setAccess,
  setRole,
  setSuper,
  upsertBusiness,
  upsertRecord,
} from "./repository";
import { convertQuotation, saveDocument } from "../domain/documents";
import {
  checkSend,
  cancelInvoice,
  deletePayment,
  recordPayment,
  restoreInvoice,
  setDueDate,
} from "../domain/receivables";
import { getSession, login, logout } from "./session";

const found = <T extends { id: string }>(records: T[], id: string) => {
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error("This record no longer exists.");
  return record;
};

export function createLocalStore(): Store {
  return {
    backend: "local",
    async currentEmployee() {
      return getSession();
    },
    onAuthChange() {
      return () => {};
    },
    async signIn(email, password) {
      return login(email, password);
    },
    async signOut() {
      logout();
    },
    async load() {
      return loadDatabase(localStorage);
    },
    async saveBusiness(db, business) {
      const next = persistDatabase(localStorage, upsertBusiness(db, business));
      return found(next.businesses, business.id);
    },
    async setBusinessArchived(db, id, archived) {
      const current = found(db.businesses, id);
      const next = persistDatabase(
        localStorage,
        upsertBusiness(db, { ...current, archived }),
      );
      return found(next.businesses, id);
    },
    async setBusinessSuper(db, id, isSuper) {
      const next = persistDatabase(localStorage, setSuper(db, id, isSuper));
      return found(next.businesses, id);
    },
    async setEmployeeRole(db, userId, role) {
      const next = persistDatabase(localStorage, setRole(db, userId, role));
      return found(next.employees, userId);
    },
    async setBusinessAccess(db, businessId, userId, granted) {
      persistDatabase(localStorage, setAccess(db, businessId, userId, granted));
    },
    async recordPayment(db, payment) {
      const next = persistDatabase(localStorage, recordPayment(db, payment));
      return found(next.payments, payment.id);
    },
    async deletePayment(db, id) {
      persistDatabase(localStorage, deletePayment(db, id));
    },
    async setDueDate(db, documentId, dueDate) {
      const next = persistDatabase(
        localStorage,
        setDueDate(db, documentId, dueDate),
      );
      return next.tracking.find((t) => t.documentId === documentId)!;
    },
    async setInvoiceCancelled(db, documentId, cancelled, reason) {
      const next = persistDatabase(
        localStorage,
        cancelled
          ? cancelInvoice(db, documentId, reason)
          : restoreInvoice(db, documentId),
      );
      return next.tracking.find((t) => t.documentId === documentId)!;
    },
    async sendInvoice(db, request) {
      // The browser-only demo has no email service: it records the attempt
      // as "demo" and delivers nothing.
      const doc = checkSend(db, request);
      const log = {
        id: crypto.randomUUID(),
        documentId: doc.id,
        businessId: doc.businessId,
        kind: "invoice" as const,
        recipients: request.to,
        cc: request.cc,
        subject: request.subject.trim(),
        status: "demo" as const,
        error: "",
        createdAt: new Date().toISOString(),
      };
      persistDatabase(localStorage, { ...db, emails: [...db.emails, log] });
      return log;
    },
    async saveCustomer(db, customer) {
      const next = persistDatabase(
        localStorage,
        upsertRecord(db, "customers", customer),
      );
      return found(next.customers, customer.id);
    },
    async saveItem(db, item) {
      const next = persistDatabase(
        localStorage,
        upsertRecord(db, "items", item),
      );
      return found(next.items, item.id);
    },
    async deleteCustomer(db, id) {
      persistDatabase(localStorage, removeRecord(db, "customers", id));
    },
    async deleteItem(db, id) {
      persistDatabase(localStorage, removeRecord(db, "items", id));
    },
    async saveDocument(db, doc, issue) {
      const next = persistDatabase(localStorage, saveDocument(db, doc, issue));
      return found(next.documents, doc.id);
    },
    async convertQuotation(db, quotationId) {
      const result = convertQuotation(db, quotationId);
      const next = persistDatabase(localStorage, result.db);
      return found(next.documents, result.invoiceId);
    },
    async uploadLogo(_businessId, file) {
      // Stored inline as a data URL, like the original prototype.
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("The logo could not be read."));
        reader.readAsDataURL(file);
      });
    },
  };
}

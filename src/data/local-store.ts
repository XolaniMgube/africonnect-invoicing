/**
 * Browser-only backend: records in localStorage, demo sign-in in
 * sessionStorage. Behaves exactly like the original prototype. Not secure.
 */
import type { Store } from "./store";
import {
  loadDatabase,
  persistDatabase,
  removeRecord,
  upsertBusiness,
  upsertRecord,
} from "./repository";
import { convertQuotation, saveDocument } from "../domain/documents";
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

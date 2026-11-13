"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Business,
  BusinessDocument,
  Customer,
  Database,
  ReferenceItem,
  EmailLog,
  EmployeeRecord,
  InvoiceTracking,
  Payment,
  Role,
} from "@/domain/types";
import { createStore } from "@/data/create-store";
import type { SendRequest } from "../../supabase/functions/_shared/invoice-email";
import { configError, merge, type Backend, type Employee } from "@/data/store";

/** After this long away from the tab, records are re-read on return. */
const REFRESH_AFTER_MS = 30_000;

type Actions = {
  saveBusiness(business: Business, message: string): Promise<Business | null>;
  setBusinessArchived(
    id: string,
    archived: boolean,
    message: string,
  ): Promise<Business | null>;
  setBusinessSuper(
    id: string,
    isSuper: boolean,
    message: string,
  ): Promise<Business | null>;
  setEmployeeRole(
    userId: string,
    role: Role,
    message: string,
  ): Promise<EmployeeRecord | null>;
  /** Resolves true once saved, or false after showing why not. */
  setBusinessAccess(
    businessId: string,
    userId: string,
    granted: boolean,
    message: string,
  ): Promise<boolean>;
  recordPayment(
    payment: Omit<Payment, "businessId">,
    message: string,
  ): Promise<Payment | null>;
  /** Resolves true once deleted, or false after showing why not. */
  deletePayment(id: string, message: string): Promise<boolean>;
  setDueDate(
    documentId: string,
    dueDate: string,
    message: string,
  ): Promise<InvoiceTracking | null>;
  setInvoiceCancelled(
    documentId: string,
    cancelled: boolean,
    reason: string,
    message: string,
  ): Promise<InvoiceTracking | null>;
  sendInvoice(request: SendRequest, message: string): Promise<EmailLog | null>;
  saveCustomer(customer: Customer, message: string): Promise<Customer | null>;
  saveItem(item: ReferenceItem, message: string): Promise<ReferenceItem | null>;
  /** Resolves true once deleted, or false after showing why not. */
  deleteCustomer(id: string, message: string): Promise<boolean>;
  deleteItem(id: string, message: string): Promise<boolean>;
  saveDocument(
    doc: BusinessDocument,
    issue: boolean,
    message: string,
  ): Promise<BusinessDocument | null>;
  convertQuotation(
    quotationId: string,
    message: string,
  ): Promise<BusinessDocument | null>;
  /** Resolves with the logo URL, or null after showing the error. */
  uploadLogo(businessId: string, file: File): Promise<string | null>;
};

type DataContext = Actions & {
  backend: Backend;
  configError: string;
  /** False until the saved sign-in (if any) has been checked. */
  authReady: boolean;
  employee: Employee | null;
  db: Database | null;
  error: string;
  retry: () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  notify: (message: string, error?: boolean) => void;
};

const Context = createContext<DataContext | null>(null);

/** Applies a saved due date / cancellation to the records on screen. */
const withTracking = (db: Database, saved: InvoiceTracking): Database => ({
  ...db,
  tracking: [
    ...db.tracking.filter((t) => t.documentId !== saved.documentId),
    saved,
  ],
});

type Loaded = { owner: string; db: Database };

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createStore);
  const [auth, setAuth] = useState<{
    ready: boolean;
    employee: Employee | null;
  }>({ ready: false, employee: null });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = useRef<Loaded | null>(null);
  const owner = useRef<string | null>(null);
  const writes = useRef({ started: 0, pending: 0 });
  const lastLoad = useRef(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const employeeId = auth.employee?.id ?? null;

  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );

  const checkAuth = useCallback(async () => {
    let employee: Employee | null;
    try {
      employee = await store.currentEmployee();
    } catch {
      // Could not tell (offline or misconfigured): keep the current state.
      setAuth((a) => ({ ready: true, employee: a.employee }));
      return;
    }
    setAuth((a) =>
      a.ready &&
      a.employee?.id === employee?.id &&
      a.employee?.name === employee?.name
        ? a
        : { ready: true, employee },
    );
  }, [store]);

  useEffect(() => {
    const timer = setTimeout(checkAuth, 0);
    const unsubscribe = store.onAuthChange(checkAuth);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [store, checkAuth]);

  const load = useCallback(
    async (forEmployee: string, quiet = false) => {
      const startedWrites = writes.current.started;
      try {
        const db = await store.load();
        if (owner.current !== forEmployee) return;
        // A background refresh must not overwrite a save made meanwhile.
        if (quiet && writes.current.started !== startedWrites) return;
        current.current = { owner: forEmployee, db };
        lastLoad.current = Date.now();
        setLoaded(current.current);
        setError("");
      } catch (e) {
        if (!quiet)
          setError(e instanceof Error ? e.message : "Unable to open records.");
      }
    },
    [store],
  );

  useEffect(() => {
    owner.current = employeeId;
    if (!employeeId) return;
    const timer = setTimeout(() => void load(employeeId), 0);
    return () => clearTimeout(timer);
  }, [employeeId, load]);

  // Shared records change while this tab is in the background.
  useEffect(() => {
    if (store.backend !== "supabase" || !employeeId) return;
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastLoad.current > REFRESH_AFTER_MS &&
        writes.current.pending === 0
      )
        void load(employeeId, true);
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [store, employeeId, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 12000 : 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const run = useCallback(
    async <T,>(
      op: (db: Database) => Promise<T>,
      apply: (db: Database, result: T) => Database,
      message: string,
    ): Promise<T | null> => {
      const snapshot = current.current;
      writes.current.started++;
      writes.current.pending++;
      try {
        if (!snapshot) throw new Error("Records are not available yet.");
        const result = await op(snapshot.db);
        const latest = current.current;
        if (latest?.owner === snapshot.owner) {
          current.current = { ...latest, db: apply(latest.db, result) };
          setLoaded(current.current);
        }
        if (message) notify(message);
        return result;
      } catch (e) {
        notify(
          e instanceof Error ? e.message : "Changes could not be saved.",
          true,
        );
        return null;
      } finally {
        writes.current.pending--;
      }
    },
    [notify],
  );

  const actions = useMemo<Actions>(
    () => ({
      saveBusiness: (business, message) =>
        run(
          (db) => store.saveBusiness(db, business),
          (db, saved) => merge(db, "businesses", saved),
          message,
        ),
      setBusinessArchived: (id, archived, message) =>
        run(
          (db) => store.setBusinessArchived(db, id, archived),
          (db, saved) => merge(db, "businesses", saved),
          message,
        ),
      setBusinessSuper: (id, isSuper, message) =>
        run(
          (db) => store.setBusinessSuper(db, id, isSuper),
          (db, saved) => merge(db, "businesses", saved),
          message,
        ),
      setEmployeeRole: (userId, role, message) =>
        run(
          (db) => store.setEmployeeRole(db, userId, role),
          (db, saved) => ({
            ...db,
            employees: db.employees.map((e) => (e.id === saved.id ? saved : e)),
          }),
          message,
        ),
      setBusinessAccess: async (businessId, userId, granted, message) =>
        (await run(
          (db) =>
            store
              .setBusinessAccess(db, businessId, userId, granted)
              .then(() => true),
          (db) => {
            const others = db.access.filter(
              (a) => !(a.businessId === businessId && a.userId === userId),
            );
            return {
              ...db,
              access: granted ? [...others, { businessId, userId }] : others,
            };
          },
          message,
        )) === true,
      recordPayment: (payment, message) =>
        run(
          (db) => store.recordPayment(db, payment),
          (db, saved) => ({ ...db, payments: [...db.payments, saved] }),
          message,
        ),
      deletePayment: async (id, message) =>
        (await run(
          (db) => store.deletePayment(db, id).then(() => true),
          (db) => ({
            ...db,
            payments: db.payments.filter((p) => p.id !== id),
          }),
          message,
        )) === true,
      setDueDate: (documentId, dueDate, message) =>
        run(
          (db) => store.setDueDate(db, documentId, dueDate),
          withTracking,
          message,
        ),
      setInvoiceCancelled: (documentId, cancelled, reason, message) =>
        run(
          (db) => store.setInvoiceCancelled(db, documentId, cancelled, reason),
          withTracking,
          message,
        ),
      sendInvoice: (request, message) =>
        run(
          (db) => store.sendInvoice(db, request),
          (db, log) => ({ ...db, emails: [log, ...db.emails] }),
          message,
        ),
      saveCustomer: (customer, message) =>
        run(
          (db) => store.saveCustomer(db, customer),
          (db, saved) => merge(db, "customers", saved),
          message,
        ),
      saveItem: (item, message) =>
        run(
          (db) => store.saveItem(db, item),
          (db, saved) => merge(db, "items", saved),
          message,
        ),
      deleteCustomer: async (id, message) =>
        (await run(
          (db) => store.deleteCustomer(db, id).then(() => true),
          (db) => ({
            ...db,
            customers: db.customers.filter((c) => c.id !== id),
          }),
          message,
        )) === true,
      deleteItem: async (id, message) =>
        (await run(
          (db) => store.deleteItem(db, id).then(() => true),
          (db) => ({ ...db, items: db.items.filter((i) => i.id !== id) }),
          message,
        )) === true,
      saveDocument: (doc, issue, message) =>
        run(
          (db) => store.saveDocument(db, doc, issue),
          (db, saved) => merge(db, "documents", saved),
          message,
        ),
      convertQuotation: (quotationId, message) =>
        run(
          (db) => store.convertQuotation(db, quotationId),
          (db, saved) => merge(db, "documents", saved),
          message,
        ),
      uploadLogo: async (businessId, file) => {
        try {
          return await store.uploadLogo(businessId, file);
        } catch (e) {
          notify(
            e instanceof Error ? e.message : "The logo could not be uploaded.",
            true,
          );
          return null;
        }
      },
    }),
    [run, store, notify],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const employee = await store.signIn(email, password);
      setAuth({ ready: true, employee });
    },
    [store],
  );

  const signOut = useCallback(async () => {
    await store.signOut();
    current.current = null;
    setLoaded(null);
    setAuth({ ready: true, employee: null });
  }, [store]);

  const retry = useCallback(() => {
    if (employeeId) void load(employeeId);
  }, [employeeId, load]);

  const db = loaded && loaded.owner === employeeId ? loaded.db : null;

  return (
    <Context.Provider
      value={{
        ...actions,
        backend: store.backend,
        configError,
        authReady: auth.ready,
        employee: auth.employee,
        db,
        error,
        retry,
        signIn,
        signOut,
        notify,
      }}
    >
      {children}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}

export function useData() {
  const context = useContext(Context);
  if (!context) throw new Error("useData must be used inside DataProvider.");
  return context;
}

/**
 * Money owed on issued invoices: payments, due dates, cancellation and
 * superseded invoices. Payments, due dates and cancelling are for super
 * businesses; "superseded" applies to every business. The database repeats
 * these rules (supabase/migrations/*_payments.sql).
 */
import type {
  BusinessDocument,
  Database,
  InvoiceTracking,
  Payment,
  PaymentMethod,
  Reminder,
} from "./types";
import { cents, today } from "./documents";
import {
  validateSendRequest,
  type SendRequest,
} from "../../supabase/functions/_shared/invoice-email";
import { validateMailSettings } from "../../supabase/functions/_shared/smtp";

export type InvoiceStatus =
  | "draft"
  | "issued"
  | "superseded"
  | "cancelled"
  | "unpaid"
  | "partial"
  | "paid"
  | "overdue";

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  superseded: "Superseded",
  cancelled: "Cancelled",
  unpaid: "Unpaid",
  partial: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
};

export const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: "eft", label: "EFT" },
  { id: "cash", label: "Cash" },
  { id: "card", label: "Card" },
  { id: "other", label: "Other" },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** The issued revision that replaced this document, if any. */
export const supersededBy = (db: Database, doc: BusinessDocument) =>
  doc.status === "issued"
    ? db.documents.find(
        (d) => d.revisionOfId === doc.id && d.status === "issued",
      )
    : undefined;

const trackingOf = (db: Database, id: string) =>
  db.tracking.find((t) => t.documentId === id);

export const paymentsOf = (db: Database, doc: BusinessDocument) =>
  db.payments
    .filter((p) => p.documentId === doc.id)
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn));

export const dueDateOf = (db: Database, doc: BusinessDocument) =>
  trackingOf(db, doc.id)?.dueDate || doc.endDate;

export const isCancelled = (db: Database, doc: BusinessDocument) =>
  !!trackingOf(db, doc.id)?.cancelledAt;

/** Paid so far and still owed, in rand (computed in cents). */
export function amounts(db: Database, doc: BusinessDocument) {
  const paid = paymentsOf(db, doc).reduce((sum, p) => sum + cents(p.amount), 0);
  const total = cents(doc.totals.total);
  return { paid: paid / 100, balance: Math.max(total - paid, 0) / 100 };
}

/** Whether payments, due dates and cancelling apply to this document. */
export function tracksPayments(db: Database, doc: BusinessDocument) {
  return (
    doc.kind === "invoice" &&
    doc.status === "issued" &&
    !!db.businesses.find((b) => b.id === doc.businessId)?.isSuper
  );
}

export function invoiceStatus(
  db: Database,
  doc: BusinessDocument,
  on = today(),
): InvoiceStatus {
  if (doc.status === "draft") return "draft";
  if (supersededBy(db, doc)) return "superseded";
  if (!tracksPayments(db, doc)) return "issued";
  if (isCancelled(db, doc)) return "cancelled";
  const { paid, balance } = amounts(db, doc);
  if (balance === 0) return "paid";
  if (dueDateOf(db, doc) < on) return "overdue";
  return paid > 0 ? "partial" : "unpaid";
}

/** Throws unless payments, due dates or cancelling may change. */
function requireOpen(db: Database, doc: BusinessDocument | undefined) {
  if (!doc) throw new Error("This invoice no longer exists.");
  if (!tracksPayments(db, doc))
    throw new Error(
      "Payments can be recorded only on issued invoices of super businesses.",
    );
  if (db.businesses.find((b) => b.id === doc.businessId)?.archived)
    throw new Error("Restore this business before recording changes.");
  if (supersededBy(db, doc))
    throw new Error("This invoice was replaced by a revision.");
  return doc;
}

export function recordPayment(
  db: Database,
  payment: Omit<Payment, "businessId">,
): Database {
  const doc = requireOpen(
    db,
    db.documents.find((d) => d.id === payment.documentId),
  );
  if (isCancelled(db, doc))
    throw new Error("Restore this invoice before recording a payment.");
  const amount = payment.amount;
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("Enter a payment amount greater than zero.");
  if (Math.abs(amount - cents(amount) / 100) > 1e-9)
    throw new Error("The payment amount can have at most two decimal places.");
  if (cents(amount) > cents(amounts(db, doc).balance))
    throw new Error("The payment is more than the balance due.");
  if (!validDate(payment.paidOn))
    throw new Error("Enter the date the payment was received.");
  if (payment.paidOn > today())
    throw new Error("The payment date can’t be in the future.");
  if (!PAYMENT_METHODS.some((m) => m.id === payment.method))
    throw new Error("Choose a payment method.");
  if (payment.reference.length > 200)
    throw new Error("Keep the reference to 200 characters or fewer.");
  return settleReminders(
    {
      ...db,
      payments: [
        ...db.payments,
        {
          ...payment,
          amount: cents(amount) / 100,
          reference: payment.reference.trim(),
          businessId: doc.businessId,
        },
      ],
    },
    doc.id,
  );
}

export function deletePayment(db: Database, id: string): Database {
  const payment = db.payments.find((p) => p.id === id);
  if (!payment) throw new Error("This payment no longer exists.");
  if (db.businesses.find((b) => b.id === payment.businessId)?.archived)
    throw new Error("Restore this business before recording changes.");
  return { ...db, payments: db.payments.filter((p) => p.id !== id) };
}

function track(
  db: Database,
  documentId: string,
  change: Partial<InvoiceTracking>,
): Database {
  const current = trackingOf(db, documentId) ?? {
    documentId,
    cancelReason: "",
  };
  const next = { ...current, ...change };
  return {
    ...db,
    tracking: [...db.tracking.filter((t) => t.documentId !== documentId), next],
  };
}

export function setDueDate(
  db: Database,
  documentId: string,
  dueDate: string,
): Database {
  const doc = requireOpen(
    db,
    db.documents.find((d) => d.id === documentId),
  );
  if (!validDate(dueDate)) throw new Error("Enter a valid due date.");
  if (dueDate < doc.date)
    throw new Error("The due date can’t be before the invoice date.");
  return track(db, documentId, { dueDate });
}

export function cancelInvoice(
  db: Database,
  documentId: string,
  reason: string,
  at = new Date().toISOString(),
): Database {
  const doc = requireOpen(
    db,
    db.documents.find((d) => d.id === documentId),
  );
  if (isCancelled(db, doc))
    throw new Error("This invoice is already cancelled.");
  if (paymentsOf(db, doc).length)
    throw new Error(
      "This invoice has payments recorded. Delete them before cancelling it.",
    );
  if (reason.length > 500)
    throw new Error("Keep the reason to 500 characters or fewer.");
  return settleReminders(
    track(db, documentId, { cancelledAt: at, cancelReason: reason.trim() }),
    documentId,
  );
}

export function restoreInvoice(db: Database, documentId: string): Database {
  const doc = requireOpen(
    db,
    db.documents.find((d) => d.id === documentId),
  );
  if (!isCancelled(db, doc)) throw new Error("This invoice isn’t cancelled.");
  return track(db, documentId, { cancelledAt: undefined, cancelReason: "" });
}

/** An invoice with payments can't be revised: they'd be left on the old one. */
export function revisionBlocked(db: Database, doc: BusinessDocument) {
  return paymentsOf(db, doc).length
    ? "This invoice has payments recorded. Delete them before editing it."
    : "";
}

export type AgeBucket = "current" | "1-30" | "31-60" | "60+";
export const AGE_BUCKETS: { id: AgeBucket; label: string }[] = [
  { id: "current", label: "Not yet due" },
  { id: "1-30", label: "1–30 days overdue" },
  { id: "31-60", label: "31–60 days overdue" },
  { id: "60+", label: "60+ days overdue" },
];

export type OpenInvoice = {
  doc: BusinessDocument;
  dueDate: string;
  /** 0 when not yet due. */
  daysOverdue: number;
  bucket: AgeBucket;
  balance: number;
};

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY,
  );

/**
 * Every issued invoice of a super business that still has money owing (not
 * paid, cancelled or superseded), most overdue first.
 */
export function openInvoices(db: Database, on = today()): OpenInvoice[] {
  return db.documents
    .filter((doc) =>
      ["unpaid", "partial", "overdue"].includes(invoiceStatus(db, doc, on)),
    )
    .map((doc) => {
      const dueDate = dueDateOf(db, doc);
      const daysOverdue = Math.max(daysBetween(dueDate, on), 0);
      const bucket: AgeBucket =
        daysOverdue === 0
          ? "current"
          : daysOverdue <= 30
            ? "1-30"
            : daysOverdue <= 60
              ? "31-60"
              : "60+";
      return {
        doc,
        dueDate,
        daysOverdue,
        bucket,
        balance: amounts(db, doc).balance,
      };
    })
    .sort(
      (a, b) =>
        b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate),
    );
}

/** Totals for a set of open invoices, summed in cents. */
export function summarise(rows: OpenInvoice[]) {
  const sum = (list: OpenInvoice[]) =>
    list.reduce((total, r) => total + cents(r.balance), 0) / 100;
  const byCustomer = new Map<
    string,
    { name: string; balance: number; overdue: number; count: number }
  >();
  for (const r of rows) {
    const key = `${r.doc.businessId}:${r.doc.customerId}`;
    const entry = byCustomer.get(key) ?? {
      name: r.doc.snapshot.customer.name,
      balance: 0,
      overdue: 0,
      count: 0,
    };
    entry.balance = (cents(entry.balance) + cents(r.balance)) / 100;
    if (r.daysOverdue > 0)
      entry.overdue = (cents(entry.overdue) + cents(r.balance)) / 100;
    entry.count++;
    byCustomer.set(key, entry);
  }
  return {
    outstanding: sum(rows),
    overdue: sum(rows.filter((r) => r.daysOverdue > 0)),
    overdueCount: rows.filter((r) => r.daysOverdue > 0).length,
    buckets: AGE_BUCKETS.map((b) => ({
      ...b,
      amount: sum(rows.filter((r) => r.bucket === b.id)),
      count: rows.filter((r) => r.bucket === b.id).length,
    })),
    customers: [...byCustomer.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.balance - a.balance),
  };
}

/** Throws unless this invoice may be emailed with this request. */
export function checkSend(db: Database, request: SendRequest) {
  const doc = requireOpen(
    db,
    db.documents.find((d) => d.id === request.documentId),
  );
  if (isCancelled(db, doc)) throw new Error("This invoice is cancelled.");
  const business = db.businesses.find((b) => b.id === doc.businessId)!;
  if (!business.emailFrom.trim())
    throw new Error(
      `Set “Send invoices from” in ${business.name}’s business settings first.`,
    );
  const errors = validateSendRequest(request);
  if (errors.length) throw new Error(errors.join(" "));
  return doc;
}

/** Throws unless these mail settings may be saved for this business. */
export function checkMailSettings(
  db: Database,
  settings: {
    businessId: string;
    host: string;
    port: number;
    username: string;
    password: string;
  },
) {
  const business = db.businesses.find((b) => b.id === settings.businessId);
  if (!business?.isSuper)
    throw new Error("Mail settings are for super businesses.");
  const saved = db.mailSettings.some(
    (m) => m.businessId === settings.businessId,
  );
  const errors = validateMailSettings(settings, saved);
  if (errors.length) throw new Error(errors.join(" "));
  return business;
}

/** Today's date in South Africa (reminders are dated in local time). */
export const saToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(
    new Date(),
  );

export const REMINDER_LABELS: Record<Reminder["status"], string> = {
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * Cancels an invoice's scheduled reminders once it's paid in full or
 * cancelled (the database does the same).
 */
export function settleReminders(db: Database, documentId: string): Database {
  const doc = db.documents.find((d) => d.id === documentId);
  if (!doc) return db;
  const reason = isCancelled(db, doc)
    ? "Not sent: the invoice was cancelled."
    : amounts(db, doc).balance === 0
      ? "Not sent: the invoice was paid."
      : "";
  if (!reason) return db;
  return {
    ...db,
    reminders: db.reminders.map((r) =>
      r.documentId === documentId && r.status === "scheduled"
        ? { ...r, status: "cancelled", error: reason }
        : r,
    ),
  };
}

export type ReminderInput = Pick<
  Reminder,
  "id" | "documentId" | "sendOn" | "recipients" | "cc" | "subject" | "message"
>;

/** Throws unless this reminder may be scheduled. */
export function checkReminder(db: Database, input: ReminderInput) {
  const doc = requireOpen(
    db,
    db.documents.find((d) => d.id === input.documentId),
  );
  if (isCancelled(db, doc)) throw new Error("This invoice is cancelled.");
  if (amounts(db, doc).balance === 0)
    throw new Error("This invoice is already paid.");
  const business = db.businesses.find((b) => b.id === doc.businessId)!;
  if (!business.emailFrom.trim())
    throw new Error(
      `Set “Send invoices from” in ${business.name}’s business settings first.`,
    );
  if (!DATE.test(input.sendOn) || Number.isNaN(Date.parse(input.sendOn)))
    throw new Error("Choose the date to send the reminder.");
  if (input.sendOn < saToday())
    throw new Error("Choose today or a later date.");
  const errors = validateSendRequest({
    documentId: input.documentId,
    to: input.recipients,
    cc: input.cc,
    subject: input.subject,
    message: input.message,
  });
  if (errors.length) throw new Error(errors.join(" "));
  return doc;
}

export function scheduleReminder(db: Database, input: ReminderInput): Database {
  const doc = checkReminder(db, input);
  return {
    ...db,
    reminders: [
      ...db.reminders,
      {
        ...input,
        subject: input.subject.trim(),
        businessId: doc.businessId,
        status: "scheduled",
        error: "",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export function cancelReminder(db: Database, id: string): Database {
  const reminder = db.reminders.find((r) => r.id === id);
  if (!reminder) throw new Error("This reminder no longer exists.");
  if (reminder.status !== "scheduled")
    throw new Error("Only a scheduled reminder can be cancelled.");
  return {
    ...db,
    reminders: db.reminders.map((r) =>
      r.id === id
        ? { ...r, status: "cancelled", error: "Cancelled by an admin." }
        : r,
    ),
  };
}

// ───────────────────────────── Automatic reminders ─────────────────────────────

/** The choices offered for automatic reminders (days relative to the due date). */
export const REMINDER_OFFSETS = [-3, 0, 3, 7, 14, 30, 60];

export const offsetLabel = (offset: number) =>
  offset === 0
    ? "On the due date"
    : offset < 0
      ? `${-offset} ${offset === -1 ? "day" : "days"} before the due date`
      : `${offset} ${offset === 1 ? "day" : "days"} after the due date`;

/** A missed day (e.g. the project was paused) is still sent this many days late. */
export const CATCH_UP_DAYS = 3;

const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Admin: switch automatic reminders on/off and choose the days. */
export function setReminderRules(
  db: Database,
  businessId: string,
  enabled: boolean,
  offsets: number[],
): Database {
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business?.isSuper)
    throw new Error("Automatic reminders are for super businesses.");
  const days = [...new Set(offsets)].sort((a, b) => a - b);
  if (!days.length) throw new Error("Choose at least one day to remind on.");
  if (days.some((d) => !Number.isInteger(d) || d < -30 || d > 365))
    throw new Error("Remind between 30 days before and a year after.");
  if (enabled && !business.emailFrom.trim())
    throw new Error(
      `Set “Send invoices from” in ${business.name}’s business settings first.`,
    );
  return {
    ...db,
    businesses: db.businesses.map((b) =>
      b.id === businessId
        ? { ...b, autoReminders: enabled, reminderOffsets: days }
        : b,
    ),
  };
}

/** Admin: pause or resume automatic reminders for one invoice. */
export function setAutoRemindersPaused(
  db: Database,
  documentId: string,
  paused: boolean,
): Database {
  requireOpen(
    db,
    db.documents.find((d) => d.id === documentId),
  );
  return track(db, documentId, { autoRemindersPaused: paused });
}

export type AutoReminderStep = {
  offset: number;
  date: string;
  /** What happened, or will: a sent/failed/cancelled reminder, or none yet. */
  state: "sent" | "failed" | "cancelled" | "sending" | "upcoming" | "missed";
  reminder?: Reminder;
};

/**
 * The automatic reminders for an invoice: one per rule, on its date (the
 * daily run sends them at 12:00). Null when automatic reminders don't apply.
 */
export function autoReminderPlan(
  db: Database,
  doc: BusinessDocument,
  on = saToday(),
) {
  const business = db.businesses.find((b) => b.id === doc.businessId);
  if (!business?.autoReminders || !tracksPayments(db, doc)) return null;
  const tracking = trackingOf(db, doc.id);
  const due = dueDateOf(db, doc);
  const customer =
    db.customers.find((c) => c.id === doc.customerId) ?? doc.snapshot.customer;
  const open =
    !isCancelled(db, doc) &&
    !supersededBy(db, doc) &&
    amounts(db, doc).balance > 0;
  const blocker = !open
    ? ""
    : !business.emailFrom.trim()
      ? "Not sending: set “Send invoices from” in business settings."
      : !customer.email.trim()
        ? `Not sending: ${customer.name} has no email address.`
        : "";
  const steps: AutoReminderStep[] = [...business.reminderOffsets]
    .sort((a, b) => a - b)
    .map((offset) => {
      const date = plusDays(due, offset);
      const reminder = db.reminders.find(
        (r) => r.documentId === doc.id && r.ruleOffset === offset,
      );
      if (reminder)
        return {
          offset,
          date,
          reminder,
          state: reminder.status === "scheduled" ? "upcoming" : reminder.status,
        };
      return {
        offset,
        date,
        state: plusDays(date, CATCH_UP_DAYS) < on ? "missed" : "upcoming",
      };
    });
  return {
    open,
    paused: !!tracking?.autoRemindersPaused,
    blocker,
    recipient: customer.email,
    steps,
  };
}

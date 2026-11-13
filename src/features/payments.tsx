"use client";
import { useState } from "react";
import { Ban, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useData } from "@/components/provider";
import { Badge, Button, Field, Modal } from "@/components/ui";
import { dateLabel, money, today } from "@/domain/documents";
import {
  PAYMENT_METHODS,
  STATUS_LABELS,
  amounts,
  dueDateOf,
  invoiceStatus,
  isCancelled,
  paymentsOf,
  supersededBy,
  tracksPayments,
} from "@/domain/receivables";
import type { BusinessDocument, Database, PaymentMethod } from "@/domain/types";

/** Draft / Issued / Paid / Overdue … for any document. */
export function StatusBadge({
  db,
  doc,
}: {
  db: Database;
  doc: BusinessDocument;
}) {
  const status = invoiceStatus(db, doc);
  return <Badge status={status} label={STATUS_LABELS[status]} />;
}

const methodLabel = (id: PaymentMethod) =>
  PAYMENT_METHODS.find((m) => m.id === id)?.label ?? id;

/**
 * Payments, due date and cancelling for an issued invoice of a super
 * business. Nothing here changes the invoice itself or its PDF.
 */
export function PaymentsPanel({ doc }: { doc: BusinessDocument }) {
  const { db, recordPayment, deletePayment, setDueDate, setInvoiceCancelled } =
    useData();
  const [busy, setBusy] = useState(false);
  const [due, setDue] = useState("");
  const [form, setForm] = useState<{
    amount: string;
    paidOn: string;
    method: PaymentMethod;
    reference: string;
  } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  if (!db || !tracksPayments(db, doc) || supersededBy(db, doc)) return null;
  const { paid, balance } = amounts(db, doc);
  const payments = paymentsOf(db, doc);
  const dueDate = dueDateOf(db, doc);
  const cancelled = isCancelled(db, doc);
  const tracking = db.tracking.find((t) => t.documentId === doc.id);
  const business = db.businesses.find((b) => b.id === doc.businessId);
  const locked = !!business?.archived || busy;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    return result;
  }

  return (
    <section className="card payments-card" aria-label="Payments">
      <div className="payments-head">
        <h2>Payments</h2>
        <StatusBadge db={db} doc={doc} />
      </div>
      <div className="payments-summary">
        <div>
          <span>Total</span>
          <strong>{money(doc.totals.total)}</strong>
        </div>
        <div>
          <span>Paid</span>
          <strong>{money(paid)}</strong>
        </div>
        <div>
          <span>Balance due</span>
          <strong>{money(balance)}</strong>
        </div>
      </div>

      {cancelled ? (
        <div className="info-note payments-cancelled">
          <Ban size={18} />
          <span>
            Cancelled
            {tracking?.cancelledAt &&
              ` on ${dateLabel(tracking.cancelledAt.slice(0, 10))}`}
            {tracking?.cancelReason && `: ${tracking.cancelReason}`}. It no
            longer counts as money owed.
          </span>
          <Button
            variant="secondary"
            disabled={locked}
            onClick={() =>
              void act(() =>
                setInvoiceCancelled(doc.id, false, "", "Invoice restored."),
              )
            }
          >
            <RotateCcw size={16} />
            Restore
          </Button>
        </div>
      ) : (
        <>
          <form
            className="payments-due"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!due) return;
              const saved = await act(() =>
                setDueDate(doc.id, due, "Due date updated."),
              );
              if (saved) setDue("");
            }}
          >
            <Field
              label="Due date"
              hint="Used for Overdue and reminders. Not printed on the invoice."
            >
              <input
                type="date"
                min={doc.date}
                value={due || dueDate}
                disabled={locked}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
            {due && due !== dueDate && (
              <Button type="submit" variant="secondary" disabled={locked}>
                Save due date
              </Button>
            )}
          </form>

          {payments.length > 0 && (
            <table className="payments-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th className="numeric">Amount</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{dateLabel(p.paidOn)}</td>
                    <td>{methodLabel(p.method)}</td>
                    <td>{p.reference || "—"}</td>
                    <td className="numeric">{money(p.amount)}</td>
                    <td>
                      <button
                        className="icon-btn"
                        disabled={locked}
                        aria-label={`Delete payment of ${money(p.amount)} on ${dateLabel(p.paidOn)}`}
                        onClick={() => {
                          if (
                            confirm(
                              `Delete the payment of ${money(p.amount)}? Use this only to correct a mistake.`,
                            )
                          )
                            void act(() =>
                              deletePayment(p.id, "Payment deleted."),
                            );
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {form ? (
            <form
              className="payments-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const saved = await act(() =>
                  recordPayment(
                    {
                      id: crypto.randomUUID(),
                      documentId: doc.id,
                      amount: form.amount === "" ? NaN : Number(form.amount),
                      paidOn: form.paidOn,
                      method: form.method,
                      reference: form.reference,
                    },
                    "Payment recorded.",
                  ),
                );
                if (saved) setForm(null);
              }}
            >
              <Field label="Amount (R)">
                <input
                  type="number"
                  required
                  min="0.01"
                  max={balance}
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </Field>
              <Field label="Date received">
                <input
                  type="date"
                  required
                  max={today()}
                  value={form.paidOn}
                  onChange={(e) => setForm({ ...form, paidOn: e.target.value })}
                />
              </Field>
              <Field label="Method">
                <select
                  value={form.method}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      method: e.target.value as PaymentMethod,
                    })
                  }
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reference (optional)">
                <input
                  maxLength={200}
                  value={form.reference}
                  onChange={(e) =>
                    setForm({ ...form, reference: e.target.value })
                  }
                />
              </Field>
              <div className="payments-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setForm(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={locked}>
                  {busy ? "Saving…" : "Save payment"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="payments-actions">
              {balance > 0 && (
                <Button
                  disabled={locked}
                  onClick={() =>
                    setForm({
                      amount: String(balance),
                      paidOn: today(),
                      method: "eft",
                      reference: "",
                    })
                  }
                >
                  <Plus size={16} />
                  Record payment
                </Button>
              )}
              {payments.length === 0 && (
                <Button
                  variant="secondary"
                  disabled={locked}
                  onClick={() => setCancelling(true)}
                >
                  <Ban size={16} />
                  Cancel invoice
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <Modal
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this invoice?"
        description="It stays on record with its number but no longer counts as money owed. You can restore it later."
      >
        <Field label="Reason (optional)">
          <textarea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setCancelling(false)}>
            Keep invoice
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              const saved = await act(() =>
                setInvoiceCancelled(doc.id, true, reason, "Invoice cancelled."),
              );
              if (saved) {
                setCancelling(false);
                setReason("");
              }
            }}
          >
            Cancel invoice
          </Button>
        </div>
      </Modal>
    </section>
  );
}

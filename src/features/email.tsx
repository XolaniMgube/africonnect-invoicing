"use client";
import { useState } from "react";
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { useData } from "@/components/provider";
import { Badge, Button, Field, Modal } from "@/components/ui";
import {
  amounts,
  isCancelled,
  supersededBy,
  tracksPayments,
} from "@/domain/receivables";
import type { BusinessDocument, EmailLog } from "@/domain/types";
import {
  defaultMessage,
  defaultSubject,
  parseRecipients,
  validateSendRequest,
} from "../../supabase/functions/_shared/invoice-email";

const STATUS: Record<EmailLog["status"], string> = {
  sent: "Sent",
  failed: "Failed",
  demo: "Demo",
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

/** Email an issued invoice of a super business, and its email history. */
export function EmailPanel({ doc }: { doc: BusinessDocument }) {
  const { db, sendInvoice, notify, backend } = useData();
  const [form, setForm] = useState<{
    to: string;
    cc: string;
    subject: string;
    message: string;
  } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  if (!db || !tracksPayments(db, doc) || supersededBy(db, doc)) return null;
  const business = db.businesses.find((b) => b.id === doc.businessId)!;
  const history = db.emails
    .filter((e) => e.documentId === doc.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cancelled = isCancelled(db, doc);
  const ready = !!business.emailFrom.trim();

  function open() {
    const customer = doc.snapshot.customer;
    setErrors([]);
    setForm({
      to: customer.email,
      cc: "",
      subject: defaultSubject(doc.number, business.name),
      message: defaultMessage({
        number: doc.number,
        customerName: customer.name,
        contact: customer.contact,
        businessName: business.name,
        total: doc.totals.total,
        balance: amounts(db!, doc).balance,
      }),
    });
  }

  async function send() {
    if (!form) return;
    const request = {
      documentId: doc.id,
      to: parseRecipients(form.to),
      cc: parseRecipients(form.cc),
      subject: form.subject,
      message: form.message,
    };
    const problems = validateSendRequest(request);
    setErrors(problems);
    if (problems.length) return;
    setSending(true);
    const log = await sendInvoice(request, "");
    setSending(false);
    if (!log) return;
    if (log.status === "failed")
      notify(`The invoice was not sent: ${log.error}`, true);
    else {
      notify(
        log.status === "demo"
          ? "Demo only: recorded, but nothing was emailed."
          : `Invoice sent to ${log.recipients.join(", ")}.`,
      );
      setForm(null);
    }
  }

  return (
    <section className="card email-card" aria-label="Email">
      <div className="payments-head">
        <h2>Email</h2>
        {!cancelled && (
          <Button disabled={!ready || business.archived} onClick={open}>
            <Send size={16} />
            Send invoice
          </Button>
        )}
      </div>
      {!ready && (
        <p className="email-note">
          Set <strong>Send invoices from</strong> in{" "}
          <Link href={`/businesses/${business.id}/settings`}>
            business settings
          </Link>{" "}
          to email this invoice.
        </p>
      )}
      {history.length ? (
        <ul className="email-history">
          {history.map((e) => (
            <li key={e.id}>
              <Mail size={16} />
              <span>
                <strong>{e.subject}</strong>
                <small>
                  {when(e.createdAt)} · to {e.recipients.join(", ")}
                  {e.cc.length > 0 && ` · cc ${e.cc.join(", ")}`}
                </small>
                {e.error && <small className="email-error">{e.error}</small>}
              </span>
              <Badge status={`email-${e.status}`} label={STATUS[e.status]} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted email-note">Not emailed yet.</p>
      )}
      <Modal
        open={!!form}
        onOpenChange={(v) => !v && setForm(null)}
        title={`Email invoice ${doc.number}`}
        description={`From ${business.name} <${business.emailFrom}>. Replies go to ${business.email}. The PDF is attached.`}
        wide
      >
        {form && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="form-grid">
              <Field label="To" hint="Separate several addresses with commas.">
                <input
                  value={form.to}
                  onChange={(e) => setForm({ ...form, to: e.target.value })}
                />
              </Field>
              <Field label="CC (optional)">
                <input
                  value={form.cc}
                  onChange={(e) => setForm({ ...form, cc: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Subject">
              <input
                maxLength={200}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </Field>
            <Field label="Message">
              <textarea
                rows={8}
                maxLength={5000}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>
            {backend === "local" && (
              <p className="email-note">
                Browser-only demo: sending is recorded but no email is
                delivered.
              </p>
            )}
            {errors.length > 0 && (
              <div className="form-error" role="alert">
                <ul>
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="dialog-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={sending}>
                <Send size={16} />
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}

"use client";
import { useState } from "react";
import { BellRing, Pause, Play, Send, X } from "lucide-react";
import { useData } from "@/components/provider";
import { Badge, Button, Field, Modal } from "@/components/ui";
import { dateLabel } from "@/domain/documents";
import {
  REMINDER_LABELS,
  autoReminderPlan,
  offsetLabel,
  amounts,
  dueDateOf,
  isCancelled,
  saToday,
  supersededBy,
  tracksPayments,
} from "@/domain/receivables";
import type { BusinessDocument } from "@/domain/types";
import {
  defaultReminderMessage,
  defaultReminderSubject,
  parseRecipients,
  validateSendRequest,
} from "../../supabase/functions/_shared/invoice-email";
import {
  MAX_REPEAT_EVERY,
  describeRepeat,
  type RepeatKind,
} from "../../supabase/functions/_shared/working-days";

/**
 * Payment reminders for an issued invoice of a super business. Everyone who
 * can see the invoice sees them; only Admins schedule, cancel or send now.
 */
export function RemindersPanel({ doc }: { doc: BusinessDocument }) {
  const {
    db,
    employee,
    scheduleReminder,
    cancelReminder,
    setAutoRemindersPaused,
    sendReminderNow,
    notify,
    backend,
  } = useData();
  const [form, setForm] = useState<{
    sendOn: string;
    repeat: RepeatKind;
    every: string;
    until: string;
    to: string;
    cc: string;
    subject: string;
    message: string;
  } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  if (!db || !tracksPayments(db, doc) || supersededBy(db, doc)) return null;
  const admin = employee?.role === "admin";
  const business = db.businesses.find((b) => b.id === doc.businessId)!;
  const reminders = db.reminders
    .filter((r) => r.documentId === doc.id)
    .sort((a, b) => b.sendOn.localeCompare(a.sendOn));
  const owing =
    !isCancelled(db, doc) && amounts(db, doc).balance > 0 && !business.archived;
  const today = saToday();
  const plan = autoReminderPlan(db, doc, today);
  const manual = reminders.filter((r) => r.ruleOffset === undefined);

  function open() {
    const customer = doc.snapshot.customer;
    const due = dueDateOf(db!, doc);
    setErrors([]);
    setForm({
      // On the due date if it's still ahead, otherwise today.
      sendOn: due > today ? due : today,
      repeat: "none",
      every: "7",
      until: "",
      to: customer.email,
      cc: "",
      subject: defaultReminderSubject(doc.number, business.name),
      message: defaultReminderMessage({
        number: doc.number,
        customerName: customer.name,
        contact: customer.contact,
        businessName: business.name,
      }),
    });
  }

  async function schedule() {
    if (!form) return;
    const input = {
      id: crypto.randomUUID(),
      documentId: doc.id,
      sendOn: form.sendOn,
      recipients: parseRecipients(form.to),
      cc: parseRecipients(form.cc),
      subject: form.subject,
      message: form.message,
      repeatKind: form.repeat,
      repeatEvery: form.repeat === "none" ? undefined : Number(form.every),
      repeatUntil: form.repeat === "none" ? undefined : form.until || undefined,
    };
    const problems = validateSendRequest({
      documentId: doc.id,
      to: input.recipients,
      cc: input.cc,
      subject: input.subject,
      message: input.message,
    });
    if (!form.sendOn || form.sendOn < today)
      problems.push("Choose today or a later date.");
    if (form.repeat !== "none") {
      const every = Number(form.every);
      if (!Number.isInteger(every) || every < 1 || every > MAX_REPEAT_EVERY)
        problems.push(`Repeat every 1 to ${MAX_REPEAT_EVERY} days.`);
      if (form.until && form.until < form.sendOn)
        problems.push("The repeat can’t end before the first reminder.");
    }
    setErrors(problems);
    if (problems.length) return;
    setBusy("schedule");
    const saved = await scheduleReminder(
      input,
      `Reminder scheduled for ${dateLabel(input.sendOn)} at 12:00${input.repeatKind === "none" ? "" : `, ${describeRepeat(input.repeatKind, input.repeatEvery, input.repeatUntil).toLowerCase()}`}.`,
    );
    setBusy("");
    if (saved) setForm(null);
  }

  async function sendNow(id: string) {
    if (!confirm("Send this reminder now instead of on its date?")) return;
    setBusy(id);
    const result = await sendReminderNow(id, "");
    setBusy("");
    if (!result) return;
    const { reminder, log } = result;
    if (reminder.status === "sent")
      notify(
        log?.status === "demo"
          ? "Demo only: recorded, but nothing was emailed."
          : `Reminder sent to ${reminder.recipients.join(", ")}.`,
      );
    else notify(reminder.error || "The reminder was not sent.", true);
  }

  return (
    <section className="card email-card" aria-label="Reminders">
      <div className="payments-head">
        <h2>Reminders</h2>
        {admin && owing && (
          <Button
            variant="secondary"
            disabled={!business.emailFrom || !!busy}
            onClick={open}
          >
            <BellRing size={16} />
            Schedule reminder
          </Button>
        )}
      </div>
      <p className="email-note">
        Reminders go out at 12:00 (South African time) on their date, from{" "}
        {business.emailFrom || "the business’s mailbox"}, with the invoice
        attached and the balance as it is that day. They’re cancelled
        automatically if the invoice is paid or cancelled first.
      </p>
      {plan && (
        <div className="auto-plan">
          <div className="auto-plan-head">
            <strong>
              Automatic
              {plan.paused && " · paused for this invoice"}
            </strong>
            {admin && plan.open && (
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={async () => {
                  setBusy("pause");
                  await setAutoRemindersPaused(
                    doc.id,
                    !plan.paused,
                    plan.paused
                      ? "Automatic reminders resumed for this invoice."
                      : "Automatic reminders paused for this invoice.",
                  );
                  setBusy("");
                }}
              >
                {plan.paused ? <Play size={15} /> : <Pause size={15} />}
                {plan.paused ? "Resume" : "Pause"}
              </Button>
            )}
          </div>
          {plan.blocker && <p className="email-error">{plan.blocker}</p>}
          <ul className="auto-steps">
            {plan.steps.map((step) => (
              <li key={step.offset}>
                <span>
                  {dateLabel(step.date)} · {offsetLabel(step.offset)}
                  {step.reminder?.error && (
                    <small
                      className={
                        step.state === "failed" ? "email-error" : "muted"
                      }
                    >
                      {step.reminder.error}
                    </small>
                  )}
                </span>
                <Badge
                  status={`reminder-${step.state === "upcoming" ? (plan.paused || !plan.open ? "cancelled" : "scheduled") : step.state === "missed" ? "cancelled" : step.state}`}
                  label={
                    step.state === "upcoming"
                      ? !plan.open
                        ? "Not needed"
                        : plan.paused
                          ? "Paused"
                          : "Upcoming"
                      : step.state === "missed"
                        ? "Missed"
                        : REMINDER_LABELS[step.state]
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {manual.length ? (
        <ul className="email-history">
          {manual.map((r) => (
            <li key={r.id}>
              <BellRing size={16} />
              <span>
                <strong>
                  {dateLabel(r.sendOn)} · {r.subject}
                </strong>
                <small>
                  to {r.recipients.join(", ")}
                  {r.cc.length > 0 && ` · cc ${r.cc.join(", ")}`}
                </small>
                {r.repeatKind !== "none" && r.status === "scheduled" && (
                  <small className="reminder-repeat">
                    {describeRepeat(
                      r.repeatKind,
                      r.repeatEvery,
                      r.repeatUntil ? dateLabel(r.repeatUntil) : undefined,
                    )}
                  </small>
                )}
                {r.error && (
                  <small className={r.status === "failed" ? "email-error" : ""}>
                    {r.error}
                  </small>
                )}
              </span>
              {admin && r.status === "scheduled" && (
                <span className="reminder-actions">
                  <button
                    className="icon-btn"
                    disabled={!!busy}
                    aria-label={`Send reminder of ${dateLabel(r.sendOn)} now`}
                    title="Send now"
                    onClick={() => void sendNow(r.id)}
                  >
                    <Send size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    disabled={!!busy}
                    aria-label={`Cancel reminder of ${dateLabel(r.sendOn)}`}
                    title="Cancel"
                    onClick={() => {
                      if (
                        confirm(
                          r.repeatKind === "none"
                            ? "Cancel this reminder?"
                            : "Cancel this reminder? This also stops the repeat.",
                        )
                      )
                        void cancelReminder(r.id, "Reminder cancelled.");
                    }}
                  >
                    <X size={16} />
                  </button>
                </span>
              )}
              <Badge
                status={`reminder-${r.status}`}
                label={REMINDER_LABELS[r.status]}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted email-note">
          {plan ? "No other reminders scheduled." : "No reminders scheduled."}
        </p>
      )}
      <Modal
        open={!!form}
        onOpenChange={(v) => !v && setForm(null)}
        title={`Schedule a reminder for ${doc.number}`}
        description={`Sent at 12:00 on the chosen date from ${business.name} <${business.emailFrom}>, with the invoice attached and that day’s balance.`}
        wide
      >
        {form && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void schedule();
            }}
          >
            <div className="form-grid">
              <Field label="Send on">
                <input
                  type="date"
                  min={today}
                  value={form.sendOn}
                  onChange={(e) => setForm({ ...form, sendOn: e.target.value })}
                />
              </Field>
              <Field
                label="Repeat"
                hint="Working days skip weekends and South African public holidays."
              >
                <select
                  value={form.repeat}
                  onChange={(e) => {
                    const repeat = e.target.value as RepeatKind;
                    setForm({
                      ...form,
                      repeat,
                      every:
                        repeat === "working_days"
                          ? "3"
                          : repeat === "days"
                            ? "7"
                            : form.every,
                    });
                  }}
                >
                  <option value="none">Don’t repeat</option>
                  <option value="days">Every few days</option>
                  <option value="working_days">Every few working days</option>
                </select>
              </Field>
              {form.repeat !== "none" && (
                <>
                  <Field
                    label={
                      form.repeat === "days"
                        ? "Every (days)"
                        : "Every (working days)"
                    }
                  >
                    <input
                      type="number"
                      min="1"
                      max={MAX_REPEAT_EVERY}
                      step="1"
                      value={form.every}
                      onChange={(e) =>
                        setForm({ ...form, every: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="Until (optional)"
                    hint="Otherwise it repeats until the invoice is paid or cancelled."
                  >
                    <input
                      type="date"
                      min={form.sendOn || today}
                      value={form.until}
                      onChange={(e) =>
                        setForm({ ...form, until: e.target.value })
                      }
                    />
                  </Field>
                </>
              )}
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
            <Field
              label="Message"
              hint="The balance due and due date on the sending day are added below your message."
            >
              <textarea
                rows={8}
                maxLength={5000}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>
            {backend === "local" && (
              <p className="email-note">
                Browser-only demo: reminders are recorded but never emailed.
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
              <Button type="submit" disabled={!!busy}>
                <BellRing size={16} />
                {busy === "schedule" ? "Scheduling…" : "Schedule reminder"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}

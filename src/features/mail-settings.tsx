"use client";
import { useState } from "react";
import { MailCheck, Save } from "lucide-react";
import { useData } from "@/components/provider";
import { Button, Field } from "@/components/ui";
import type { Business } from "@/domain/types";
import { isEmail } from "../../supabase/functions/_shared/invoice-email";
import {
  MAIL_PORTS,
  validateMailSettings,
} from "../../supabase/functions/_shared/smtp";

/**
 * Admin only, super businesses: the business's own mailbox (e.g. Afrihost
 * cPanel) used to send its emails, and a test email to check it works.
 */
export function MailSettingsCard({ business }: { business: Business }) {
  const { db, employee, saveMailSettings, sendTestEmail, notify } = useData();
  const saved = db?.mailSettings.find((m) => m.businessId === business.id);
  const [form, setForm] = useState({
    host:
      saved?.host ??
      (business.emailFrom.includes("@")
        ? `mail.${business.emailFrom.split("@")[1]}`
        : ""),
    port: saved?.port ?? 465,
    username: saved?.username ?? business.emailFrom,
    password: "",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const [testTo, setTestTo] = useState(employee?.email ?? "");
  if (!db || employee?.role !== "admin" || !business.isSuper) return null;
  // Why the test can't run yet, if it can't.
  const blocker = !business.emailFrom
    ? "Set “Send invoices from” above and save the business first."
    : !saved
      ? "Save the mail settings first."
      : "";

  async function save() {
    const problems = validateMailSettings(form, !!saved);
    setErrors(problems);
    if (problems.length) return;
    setBusy("save");
    const result = await saveMailSettings(
      { ...form, businessId: business.id },
      "Mail settings saved.",
    );
    setBusy("");
    if (result) setForm((f) => ({ ...f, password: "" }));
  }

  async function test() {
    if (!isEmail(testTo)) {
      setErrors(["Enter the address to send the test email to."]);
      return;
    }
    setErrors([]);
    setBusy("test");
    const result = await sendTestEmail(business.id, testTo.trim(), "");
    setBusy("");
    if (result)
      notify(
        `Test email sent to ${result.to}. Check that inbox (and its spam folder).`,
      );
  }

  return (
    <section
      className="card settings-card mail-card"
      aria-label="Email sending"
    >
      <h2>Email sending</h2>
      <p className="muted">
        Invoices are sent from this business’s own mailbox. In Afrihost cPanel
        see <strong>Email Accounts → Connect Devices</strong> for the outgoing
        server and port. The password is stored encrypted and can’t be read
        back. Admins only.
      </p>
      {!business.emailFrom && (
        <p className="email-note">
          Set <strong>Send invoices from</strong> above first; use the same
          mailbox here.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <Field label="Outgoing mail server">
            <input
              value={form.host}
              placeholder="mail.yourdomain.co.za"
              onChange={(e) => setForm({ ...form, host: e.target.value })}
            />
          </Field>
          <Field label="Port" hint="465 (SSL) is what Afrihost uses.">
            <select
              value={form.port}
              onChange={(e) =>
                setForm({ ...form, port: Number(e.target.value) })
              }
            >
              {MAIL_PORTS.map((p) => (
                <option key={p} value={p}>
                  {p === 465 ? "465 (SSL)" : `${p} (STARTTLS)`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Username (mailbox address)">
            <input
              type="email"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field
            label="Mailbox password"
            hint={
              saved
                ? "Saved. Leave empty to keep it, or type a new one."
                : "The password of this mailbox in cPanel."
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
        </div>
        <div className="form-grid mail-test">
          <Field
            label="Send test email to"
            hint="Any inbox you can check, e.g. your own Gmail."
          >
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
          </Field>
        </div>
        {errors.length > 0 && (
          <div className="form-error" role="alert">
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="form-footer">
          <span className="muted">
            {saved
              ? `Saved ${new Date(saved.updatedAt).toLocaleString("en-ZA")}`
              : "Not set up yet"}
          </span>
          <div className="mail-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={!!blocker || !!busy}
              onClick={() => void test()}
            >
              <MailCheck size={16} />
              {busy === "test" ? "Sending test…" : "Send test email"}
            </Button>
            <Button type="submit" disabled={!!busy}>
              <Save size={16} />
              {busy === "save" ? "Saving…" : "Save mail settings"}
            </Button>
          </div>
        </div>
        {blocker && <p className="email-note mail-blocker">{blocker}</p>}
        {!blocker &&
          business.emailFrom &&
          form.username.trim().toLowerCase() !==
            business.emailFrom.trim().toLowerCase() && (
            <p className="email-note mail-blocker">
              The username differs from “Send invoices from” (
              {business.emailFrom}). Most mail servers only send as the mailbox
              you log in with, so use the same address in both.
            </p>
          )}
      </form>
    </section>
  );
}

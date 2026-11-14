"use client";
import { useState } from "react";
import { BellRing, Save } from "lucide-react";
import { useData } from "@/components/provider";
import { Button } from "@/components/ui";
import { REMINDER_OFFSETS, offsetLabel } from "@/domain/receivables";
import type { Business } from "@/domain/types";

/** Admin only, super businesses: automatic reminder rules. */
export function AutoRemindersCard({ business }: { business: Business }) {
  const { employee, saveReminderRules } = useData();
  const [enabled, setEnabled] = useState(business.autoReminders);
  const [offsets, setOffsets] = useState(business.reminderOffsets);
  const [busy, setBusy] = useState(false);
  if (employee?.role !== "admin" || !business.isSuper) return null;
  const choices = [...new Set([...REMINDER_OFFSETS, ...offsets])].sort(
    (a, b) => a - b,
  );
  const changed =
    enabled !== business.autoReminders ||
    [...offsets].sort((a, b) => a - b).join() !==
      [...business.reminderOffsets].sort((a, b) => a - b).join();

  async function save() {
    setBusy(true);
    await saveReminderRules(
      business.id,
      enabled,
      offsets,
      enabled
        ? "Automatic reminders saved."
        : "Automatic reminders switched off.",
    );
    setBusy(false);
  }

  return (
    <section
      className="card settings-card mail-card"
      aria-label="Automatic reminders"
    >
      <h2>Automatic reminders</h2>
      <p className="muted">
        At 12:00 (South African time) on each chosen day, every unpaid invoice
        of {business.name} gets a reminder by email, with the invoice attached
        and its balance that day. Paid, cancelled and replaced invoices are
        skipped, and each reminder goes once. Admins can pause them per invoice.
      </p>
      <label className="checkbox-label auto-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Send reminders automatically
      </label>
      <fieldset className="auto-days" disabled={!enabled}>
        <legend>Remind</legend>
        {choices.map((offset) => (
          <label className="checkbox-label" key={offset}>
            <input
              type="checkbox"
              checked={offsets.includes(offset)}
              onChange={(e) =>
                setOffsets((list) =>
                  e.target.checked
                    ? [...list, offset]
                    : list.filter((o) => o !== offset),
                )
              }
            />
            {offsetLabel(offset)}
          </label>
        ))}
      </fieldset>
      <div className="form-footer">
        <span className="muted">
          <BellRing size={14} />{" "}
          {business.autoReminders
            ? `On: ${business.reminderOffsets.map(offsetLabel).join(", ").toLowerCase()}.`
            : "Off."}
        </span>
        <Button
          disabled={busy || !changed || (enabled && !offsets.length)}
          onClick={() => void save()}
        >
          <Save size={16} />
          {busy ? "Saving…" : "Save automatic reminders"}
        </Button>
      </div>
    </section>
  );
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  addWorkingDays,
  describeRepeat,
  easterSunday,
  isWorkingDay,
  nextReminderDate,
  publicHolidays,
} from "../supabase/functions/_shared/working-days";

test("Easter and South African public holidays", () => {
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(easterSunday(2025), "2025-04-20");
  const h2026 = publicHolidays(2026);
  assert.ok(h2026.has("2026-04-03")); // Good Friday
  assert.ok(h2026.has("2026-04-06")); // Family Day
  assert.ok(h2026.has("2026-12-16"));
  // 2027: Human Rights Day falls on a Sunday → Monday 22 March too.
  assert.ok(publicHolidays(2027).has("2027-03-22"));
  // 2026: Freedom Day (27 April) is a Monday: no extra day.
  assert.ok(!h2026.has("2026-04-28"));
});

test("working days skip weekends and public holidays", () => {
  assert.equal(isWorkingDay("2026-11-20"), true); // Friday
  assert.equal(isWorkingDay("2026-11-21"), false); // Saturday
  assert.equal(isWorkingDay("2026-12-16"), false); // Day of Reconciliation
  // Friday + 3 working days → Wednesday.
  assert.equal(addWorkingDays("2026-11-20", 3), "2026-11-25");
  // Over Christmas: 24 Dec (Thu) + 1 → 25 holiday, 26 Sat, 27 Sun → 28 Dec.
  assert.equal(addWorkingDays("2026-12-24", 1), "2026-12-28");
  // Over Easter 2026: Thursday 2 April + 1 → Good Friday, weekend, Family Day → 7 April.
  assert.equal(addWorkingDays("2026-04-02", 1), "2026-04-07");
});

test("the next reminder in a series", () => {
  assert.equal(
    nextReminderDate("2026-11-20", "2026-11-20", "days", 7),
    "2026-11-27",
  );
  assert.equal(
    nextReminderDate("2026-11-20", "2026-11-20", "working_days", 3),
    "2026-11-25",
  );
  // Sent late (missed days): continues from today, never in the past.
  assert.equal(
    nextReminderDate("2026-11-01", "2026-11-20", "days", 7),
    "2026-11-27",
  );
  // Sent early with "Send now": continues from its planned date.
  assert.equal(
    nextReminderDate("2026-12-01", "2026-11-20", "days", 7),
    "2026-12-08",
  );
  // Stops after the end date, and for one-off reminders.
  assert.equal(
    nextReminderDate("2026-11-20", "2026-11-20", "days", 7, "2026-11-26"),
    null,
  );
  assert.equal(nextReminderDate("2026-11-20", "2026-11-20", "none", 7), null);
  assert.equal(
    describeRepeat("working_days", 3),
    "Repeats every 3 working days until paid",
  );
  assert.equal(
    describeRepeat("days", 7, "2027-01-31"),
    "Repeats every 7 days until 2027-01-31",
  );
  assert.equal(describeRepeat("none"), "");
});

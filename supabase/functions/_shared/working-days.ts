/**
 * South African working days and repeat dates for recurring reminders.
 * Plain TypeScript with no imports, shared by the app, the tests and the
 * send-reminders Edge Function. Dates are "YYYY-MM-DD" strings.
 *
 * Public holidays (Public Holidays Act 36 of 1994): the fixed dates below,
 * Good Friday and Family Day (the Monday after Easter), and a holiday that
 * falls on a Sunday is also observed on the Monday.
 */

export type RepeatKind = "none" | "days" | "working_days";

const FIXED = [
  "01-01", // New Year's Day
  "03-21", // Human Rights Day
  "04-27", // Freedom Day
  "05-01", // Workers' Day
  "06-16", // Youth Day
  "08-09", // National Women's Day
  "09-24", // Heritage Day
  "12-16", // Day of Reconciliation
  "12-25", // Christmas Day
  "12-26", // Day of Goodwill
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function addDays(date: string, days: number) {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** Easter Sunday (Gregorian), by the anonymous Gregorian algorithm. */
export function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const cache = new Map<number, Set<string>>();

/** Every South African public holiday in a year, including Sunday → Monday. */
export function publicHolidays(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const days = [
    ...FIXED.map((md) => `${year}-${md}`),
    addDays(easter, -2), // Good Friday
    addDays(easter, 1), // Family Day
  ];
  const all = new Set(days);
  for (const day of days)
    if (utc(day).getUTCDay() === 0) all.add(addDays(day, 1));
  cache.set(year, all);
  return all;
}

export function isWorkingDay(date: string) {
  const weekday = utc(date).getUTCDay();
  return (
    weekday !== 0 &&
    weekday !== 6 &&
    !publicHolidays(Number(date.slice(0, 4))).has(date)
  );
}

/** The date `count` working days after `date` (not counting `date` itself). */
export function addWorkingDays(date: string, count: number) {
  let day = date;
  for (let left = count; left > 0;) {
    day = addDays(day, 1);
    if (isWorkingDay(day)) left--;
  }
  return day;
}

/** The next date in a repeat after `date`, or null if it doesn't repeat. */
export function nextRepeat(date: string, kind: RepeatKind, every: number) {
  if (kind === "days") return addDays(date, every);
  if (kind === "working_days") return addWorkingDays(date, every);
  return null;
}

/** The date of the next reminder in a series: never in the past. */
export function nextReminderDate(
  sentOn: string,
  today: string,
  kind: RepeatKind,
  every: number,
  until?: string | null,
) {
  // A reminder sent late (e.g. after a missed day) continues from today.
  let next = nextRepeat(sentOn > today ? sentOn : today, kind, every);
  if (next && until && next > until) next = null;
  return next;
}

export const MAX_REPEAT_EVERY = 30;

export function describeRepeat(
  kind: RepeatKind,
  every?: number,
  until?: string | null,
) {
  if (kind === "none" || !every) return "";
  const unit =
    kind === "days"
      ? every === 1
        ? "day"
        : "days"
      : every === 1
        ? "working day"
        : "working days";
  return `Repeats every ${every === 1 ? "" : `${every} `}${unit}${until ? ` until ${until}` : " until paid"}`;
}

// lib/utils/business-time.ts
//
// Server code (Vercel, defaults to UTC) and local dev machines run in
// different system timezones. Any "today" / "this week" / "this month" /
// "hour of day" boundary built from `new Date()` + the local getters
// (getFullYear/getMonth/getDate/getHours/setHours/setDate) silently uses
// whichever timezone the *process* happens to be running in — so the same
// database can render different dashboard numbers depending on where the
// code executes. The shop operates on Asia/Dili time (also used for
// receipts, see lib/utils/receipt-lines.ts), so every "what day/hour is it
// for the business" calculation must be pinned to that timezone explicitly,
// regardless of server locale.

export const BUSINESS_TIMEZONE = "Asia/Dili"; // UTC+9, no DST
const OFFSET_MS = 9 * 60 * 60 * 1000;

/** The same instant, shifted so its UTC getters read as Asia/Dili local time. */
function shiftToBusinessTz(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS);
}

/** Midnight (business-local) of the day containing `date`, as a real instant. */
export function startOfDayBiz(date: Date): Date {
  const s = shiftToBusinessTz(date);
  const utcMidnight = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  return new Date(utcMidnight - OFFSET_MS);
}

/** Last instant (23:59:59.999 business-local) of the day containing `date`. */
export function endOfDayBiz(date: Date): Date {
  return new Date(startOfDayBiz(date).getTime() + 86_400_000 - 1);
}

/** Midnight (business-local) of the 1st of the month containing `date`. */
export function startOfMonthBiz(date: Date): Date {
  const s = shiftToBusinessTz(date);
  const utcMidnight = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1);
  return new Date(utcMidnight - OFFSET_MS);
}

/** `n` calendar days before `date` — pure elapsed-time math (safe: no DST in Dili). */
export function subDaysBiz(date: Date, n: number): Date {
  return new Date(date.getTime() - n * 86_400_000);
}

/** Midnight (business-local) of the 1st of the month, `n` months before `date`. */
export function subMonthsBiz(date: Date, n: number): Date {
  const s = shiftToBusinessTz(date);
  const utcFirstOfMonth = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - n, 1);
  return new Date(utcFirstOfMonth - OFFSET_MS);
}

/** Hour-of-day (0-23) that `date` falls on, in business-local time. */
export function hourBiz(date: Date): number {
  return shiftToBusinessTz(date).getUTCHours();
}

/** `Intl.DateTimeFormat`, pre-pinned to the business timezone. */
export function formatBiz(date: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: BUSINESS_TIMEZONE }).format(date);
}

// ─── Calendar-day helpers (YYYY-MM-DD, business-local) ────────────────────────

/** Business-local calendar date of `date`, as YYYY-MM-DD. */
export function isoDayBiz(date: Date): string {
  return shiftToBusinessTz(date).toISOString().slice(0, 10);
}

/** First instant (00:00 business-local) of the calendar day `iso`. */
export function bizDayStart(iso: string): Date {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) - OFFSET_MS);
}

/** Last instant (23:59:59.999 business-local) of the calendar day `iso`. */
export function bizDayEnd(iso: string): Date {
  return new Date(bizDayStart(iso).getTime() + 86_400_000 - 1);
}

/** A real calendar date in YYYY-MM-DD form (rejects e.g. 2026-02-31). */
export function isISODay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/**
 * The instant on business-local day `iso` at the same clock time as `now` — for
 * back-dating a record: the day is the user's choice, the time stays natural.
 */
export function bizDayAtTimeOf(iso: string, now: Date = new Date()): Date {
  const sinceMidnight = now.getTime() - startOfDayBiz(now).getTime();
  return new Date(bizDayStart(iso).getTime() + sinceMidnight);
}

/** Pure calendar arithmetic on a YYYY-MM-DD string (no timezone involved). */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Oct 7, 2026, 3:42 PM" in Timor-Leste time. Accepts Date | string | number. */
export function formatDateTimeBiz(value: Date | string | number): string {
  return formatBiz(new Date(value), {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/** "10/7/2026" in Timor-Leste time. Accepts Date | string | number. */
export function formatDateBiz(value: Date | string | number): string {
  return formatBiz(new Date(value), { year: "numeric", month: "numeric", day: "numeric" });
}

/** "Today" / "Yesterday" / "Mon, Oct 6" for a business-local YYYY-MM-DD day, relative to `now`. */
export function formatDayLabelBiz(iso: string, now: Date = new Date()): string {
  const today = isoDayBiz(now);
  if (iso === today) return "Today";
  if (iso === addDaysISO(today, -1)) return "Yesterday";
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return formatBiz(bizDayStart(iso), sameYear
    ? { weekday: "short", month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" });
}

/** "Today, 3:42 PM" / "Yesterday, 9:05 AM" / "Oct 3, 3:42 PM" in Timor-Leste time, relative to `now`. */
export function formatDayTimeBiz(value: Date | string | number, now: Date = new Date()): string {
  const date  = new Date(value);
  const time  = formatBiz(date, { hour: "numeric", minute: "2-digit" });
  const day   = isoDayBiz(date);
  const today = isoDayBiz(now);
  if (day === today) return `Today, ${time}`;
  if (day === addDaysISO(today, -1)) return `Yesterday, ${time}`;
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const dayPart  = formatBiz(date, sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" });
  return `${dayPart}, ${time}`;
}

/** Compact elapsed time since `value`: "just now", "5m", "3h", "2d", "3w", "4mo". */
export function timeAgoShort(value: Date | string | number, now: Date = new Date()): string {
  const minutes = Math.max(0, now.getTime() - new Date(value).getTime()) / 60_000;
  if (minutes < 1)  return "just now";
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24)   return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 14)    return `${Math.floor(days)}d`;
  if (days < 60)    return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

// ─── Finance period presets ──────────────────────────────────────────────────
// Pure helper (no "use server") shared by the Buku Besar / Buku Kecil pages and
// their clients. Boundaries follow the same plain-Date convention as
// lib/actions/export.ts (`new Date(iso + "T00:00:00")`), not business-tz.

export type FinancePeriod =
  | "this_month" | "last_month" | "last_3_months" | "this_year" | "all";

export const FINANCE_PERIODS: { value: FinancePeriod; label: string }[] = [
  { value: "this_month",    label: "This Month"    },
  { value: "last_month",    label: "Last Month"    },
  { value: "last_3_months", label: "Last 3 Months" },
  { value: "this_year",     label: "This Year"     },
  { value: "all",           label: "All Time"      },
];

export function financePeriodRange(period: FinancePeriod): { from: string; to: string; label: string } {
  const iso = (d: Date) => {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  const now   = new Date();
  const today = iso(now);
  const label = FINANCE_PERIODS.find((p) => p.value === period)?.label ?? "This Month";

  switch (period) {
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(first), to: iso(last), label };
    }
    case "last_3_months":
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: today, label };
    case "this_year":
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: today, label };
    case "all":
      return { from: "2000-01-01", to: today, label };
    case "this_month":
    default:
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today, label };
  }
}

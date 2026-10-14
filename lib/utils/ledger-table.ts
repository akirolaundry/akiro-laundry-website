// lib/utils/ledger-table.ts
//
// Pure logic behind the Buku Kecil transaction table: the flat row model, the
// column set, per-column filters, multi-column sorting, summaries, group-by
// breakdowns and trend buckets. No React in here, so it is easy to reason about.

import type { LedgerEntry } from "@/lib/actions/finance";
import { addDaysISO, formatBiz, hourBiz, isoDayBiz } from "@/lib/utils/business-time";

// ─── Row model ────────────────────────────────────────────────────────────────

export interface LedgerRow {
  id:            number;
  /** Epoch ms. */
  ts:            number;
  /** Business-local calendar day, YYYY-MM-DD. */
  day:           string;
  hour:          number;
  /** Order number, or "" for entries that aren't tied to an order. */
  order:         string;
  orderId:       number | null;
  customer:      string;
  customerId:    number | null;
  phone:         string;
  description:   string;
  category:      string;
  categoryColor: string;
  /** What kind of entry this is: "Order payment", "Expense", … */
  kind:          string;
  direction:     "in" | "out";
  cashIn:        number;
  cashOut:       number;
  /** Signed effect on the drawer: + in, − out. */
  net:           number;
  balance:       number;
  tendered:      number | null;
  change:        number | null;
  orderTotal:    number | null;
  orderStatus:   string;
}

const PAYMENT_STATUS: Record<string, string> = { unpaid: "Unpaid", partial: "Partial (DP)", paid: "Paid" };

export function kindLabel(e: Pick<LedgerEntry, "type" | "paymentType">): string {
  switch (e.type) {
    case "payment_in":
      return e.paymentType === "dp" ? "Down payment"
        : e.paymentType === "balance" ? "Balance payment"
        : "Order payment";
    case "change_out":        return "Change given";
    case "manual_income":     return "Income";
    case "manual_outcome":    return "Expense";
    case "manual_adjustment": return "Adjustment";
    case "initial":           return "Opening balance";
    default:                  return "Other";
  }
}

export function toRow(e: LedgerEntry): LedgerRow {
  const date = new Date(e.createdAt);
  return {
    id:            e.id,
    ts:            date.getTime(),
    day:           isoDayBiz(date),
    hour:          hourBiz(date),
    order:         e.orderNumber ?? "",
    orderId:       e.orderId,
    customer:      e.customerName ?? "",
    customerId:    e.customerId,
    phone:         e.customerPhone ?? "",
    description:   e.description,
    category:      e.categoryLabel,
    categoryColor: e.categoryColor,
    kind:          kindLabel(e),
    direction:     e.direction === "income" ? "in" : "out",
    cashIn:        e.credit,
    cashOut:       e.debit,
    net:           e.credit - e.debit,
    balance:       e.balanceAfter,
    tendered:      e.tendered,
    change:        e.change,
    orderTotal:    e.orderTotal,
    orderStatus:   e.orderPaymentStatus ? (PAYMENT_STATUS[e.orderPaymentStatus] ?? e.orderPaymentStatus) : "",
  };
}

// ─── Columns ──────────────────────────────────────────────────────────────────

export type ColumnKey =
  | "date" | "ref" | "order" | "customer" | "phone" | "description" | "category" | "kind"
  | "cashOut" | "cashIn" | "net" | "balance" | "tendered" | "change" | "orderTotal" | "orderStatus";

export type ColumnType = "text" | "select" | "date" | "number";

export interface ColumnDef {
  key:            ColumnKey;
  label:          string;
  type:           ColumnType;
  align:          "left" | "right";
  defaultVisible: boolean;
  /** Value used for sorting and filtering (date → epoch ms, empty → ""/null). */
  value:          (r: LedgerRow) => string | number | null;
}

export const COLUMNS: ColumnDef[] = [
  { key: "date",        label: "Date",         type: "date",   align: "left",  defaultVisible: true,  value: (r) => r.ts },
  { key: "ref",         label: "Ref",          type: "text",   align: "left",  defaultVisible: false, value: (r) => `#${r.id}` },
  { key: "order",       label: "Order",        type: "text",   align: "left",  defaultVisible: true,  value: (r) => r.order },
  { key: "customer",    label: "Customer",     type: "text",   align: "left",  defaultVisible: true,  value: (r) => r.customer },
  { key: "phone",       label: "Phone",        type: "text",   align: "left",  defaultVisible: false, value: (r) => r.phone },
  { key: "description", label: "Description",  type: "text",   align: "left",  defaultVisible: true,  value: (r) => r.description },
  { key: "category",    label: "Category",     type: "select", align: "left",  defaultVisible: true,  value: (r) => r.category },
  { key: "kind",        label: "Type",         type: "select", align: "left",  defaultVisible: true,  value: (r) => r.kind },
  { key: "cashOut",     label: "Cash out",     type: "number", align: "right", defaultVisible: true,  value: (r) => r.cashOut },
  { key: "cashIn",      label: "Cash in",      type: "number", align: "right", defaultVisible: true,  value: (r) => r.cashIn },
  { key: "net",         label: "Net",          type: "number", align: "right", defaultVisible: false, value: (r) => r.net },
  { key: "balance",     label: "Balance",      type: "number", align: "right", defaultVisible: true,  value: (r) => r.balance },
  { key: "tendered",    label: "Tendered",     type: "number", align: "right", defaultVisible: false, value: (r) => r.tendered },
  { key: "change",      label: "Change",       type: "number", align: "right", defaultVisible: false, value: (r) => r.change },
  { key: "orderTotal",  label: "Order total",  type: "number", align: "right", defaultVisible: false, value: (r) => r.orderTotal },
  { key: "orderStatus", label: "Order payment", type: "select", align: "left", defaultVisible: false, value: (r) => r.orderStatus },
];

export const COLUMN_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<ColumnKey, ColumnDef>;

// ─── Filters ──────────────────────────────────────────────────────────────────

export type ColumnFilter =
  | { type: "text";   q: string }
  | { type: "select"; values: string[] }
  | { type: "date";   from: string; to: string }
  | { type: "number"; min: string; max: string };

export type FilterState = Partial<Record<ColumnKey, ColumnFilter>>;
export type Direction   = "all" | "in" | "out";

export interface ViewFilters {
  search:    string;
  direction: Direction;
  columns:   FilterState;
}

export const EMPTY_FILTERS: ViewFilters = { search: "", direction: "all", columns: {} };

export function isFilterActive(f: ColumnFilter | undefined): boolean {
  if (!f) return false;
  switch (f.type) {
    case "text":   return f.q.trim() !== "";
    case "select": return f.values.length > 0;
    case "date":   return f.from !== "" || f.to !== "";
    case "number": return f.min.trim() !== "" || f.max.trim() !== "";
  }
}

export function activeFilterKeys(columns: FilterState): ColumnKey[] {
  return (Object.keys(columns) as ColumnKey[]).filter((k) => isFilterActive(columns[k]));
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

function searchHaystack(r: LedgerRow): string {
  return [
    `#${r.id}`, r.order, r.customer, r.phone, r.description, r.category, r.kind, r.orderStatus,
    r.cashIn || "", r.cashOut || "", r.day,
  ].join(" ").toLowerCase();
}

function matchesColumn(r: LedgerRow, key: ColumnKey, f: ColumnFilter): boolean {
  const v = COLUMN_BY_KEY[key].value(r);
  switch (f.type) {
    case "text": {
      const hay = String(v ?? "").toLowerCase();
      return words(f.q).every((w) => hay.includes(w));
    }
    case "select":
      return f.values.includes(String(v ?? ""));
    case "date":
      return (f.from === "" || r.day >= f.from) && (f.to === "" || r.day <= f.to);
    case "number": {
      if (v === null || v === "") return false;
      const n = Number(v);
      const min = f.min.trim() === "" ? -Infinity : parseFloat(f.min);
      const max = f.max.trim() === "" ? Infinity  : parseFloat(f.max);
      return n >= (Number.isNaN(min) ? -Infinity : min) && n <= (Number.isNaN(max) ? Infinity : max);
    }
  }
}

export function filterRows(rows: LedgerRow[], f: ViewFilters): LedgerRow[] {
  const terms  = words(f.search);
  const active = activeFilterKeys(f.columns);
  if (terms.length === 0 && active.length === 0 && f.direction === "all") return rows;

  return rows.filter((r) => {
    if (f.direction === "in"  && r.direction !== "in")  return false;
    if (f.direction === "out" && r.direction !== "out") return false;
    if (terms.length > 0) {
      const hay = searchHaystack(r);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return active.every((k) => matchesColumn(r, k, f.columns[k]!));
  });
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

export interface SortSpec { key: ColumnKey; dir: "asc" | "desc" }

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function sortRows(rows: LedgerRow[], sorts: SortSpec[]): LedgerRow[] {
  if (sorts.length === 0) return rows;
  const specs = sorts.map((s) => ({ ...s, get: COLUMN_BY_KEY[s.key].value }));
  return [...rows].sort((a, b) => {
    for (const s of specs) {
      const va = s.get(a);
      const vb = s.get(b);
      const ea = va === null || va === "";
      const eb = vb === null || vb === "";
      if (ea || eb) {
        if (ea && eb) continue;
        return ea ? 1 : -1; // empty values always sink to the bottom
      }
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : collator.compare(String(va), String(vb));
      if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
    }
    return b.ts - a.ts || b.id - a.id; // stable tiebreak: newest first
  });
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export interface Summary {
  count:        number;
  cashIn:       number;
  cashOut:      number;
  net:          number;
  /** Order payments (incl. DP and balance), net of change. */
  orderIncome:  number;
  orders:       number;
  customers:    number;
  avgIn:        number;
  largestIn:    number;
  largestOut:   number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarize(rows: LedgerRow[]): Summary {
  let cashIn = 0, cashOut = 0, orderIncome = 0, inCount = 0, largestIn = 0, largestOut = 0;
  const orders = new Set<string>();
  const customers = new Set<string>();
  for (const r of rows) {
    cashIn  += r.cashIn;
    cashOut += r.cashOut;
    if (r.cashIn  > 0) { inCount++; largestIn  = Math.max(largestIn,  r.cashIn);  }
    if (r.cashOut > 0) {            largestOut = Math.max(largestOut, r.cashOut); }
    if (r.order) orders.add(r.order);
    if (r.customer) customers.add(r.customer);
    if (r.kind === "Order payment" || r.kind === "Down payment" || r.kind === "Balance payment") {
      orderIncome += r.cashIn;
    }
  }
  return {
    count:       rows.length,
    cashIn:      round2(cashIn),
    cashOut:     round2(cashOut),
    net:         round2(cashIn - cashOut),
    orderIncome: round2(orderIncome),
    orders:      orders.size,
    customers:   customers.size,
    avgIn:       inCount ? round2(cashIn / inCount) : 0,
    largestIn,
    largestOut,
  };
}

// ─── Group-by breakdown ───────────────────────────────────────────────────────

export type GroupBy = "category" | "kind" | "customer" | "order" | "day" | "month" | "weekday" | "hour";

export const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "category", label: "Category"    },
  { value: "kind",     label: "Type"        },
  { value: "customer", label: "Customer"    },
  { value: "order",    label: "Order"       },
  { value: "day",      label: "Day"         },
  { value: "month",    label: "Month"       },
  { value: "weekday",  label: "Weekday"     },
  { value: "hour",     label: "Hour of day" },
];

export interface GroupRow {
  key:    string;
  label:  string;
  color?: string;
  count:  number;
  cashIn: number;
  cashOut: number;
  net:    number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function monthLabel(ym: string): string {
  return formatBiz(new Date(`${ym}-15T00:00:00Z`), { month: "short", year: "numeric" });
}

export function hourLabel(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`;
}

function groupKey(r: LedgerRow, by: GroupBy): { key: string; label: string; color?: string } {
  switch (by) {
    case "category": return { key: r.category, label: r.category, color: r.categoryColor };
    case "kind":     return { key: r.kind,     label: r.kind };
    case "customer": return { key: r.customer || "—", label: r.customer || "(no customer)" };
    case "order":    return { key: r.order || "—",    label: r.order || "(no order)" };
    case "day":      return { key: r.day, label: r.day };
    case "month":    return { key: r.day.slice(0, 7), label: monthLabel(r.day.slice(0, 7)) };
    case "weekday": {
      const idx = (new Date(`${r.day}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
      return { key: String(idx), label: WEEKDAYS[idx] };
    }
    case "hour":     return { key: String(r.hour).padStart(2, "0"), label: hourLabel(r.hour) };
  }
}

export function groupRows(rows: LedgerRow[], by: GroupBy): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const r of rows) {
    const g = groupKey(r, by);
    let row = map.get(g.key);
    if (!row) { row = { ...g, count: 0, cashIn: 0, cashOut: 0, net: 0 }; map.set(g.key, row); }
    row.count++;
    row.cashIn  += r.cashIn;
    row.cashOut += r.cashOut;
  }
  const out = [...map.values()].map((g) => ({
    ...g, cashIn: round2(g.cashIn), cashOut: round2(g.cashOut), net: round2(g.cashIn - g.cashOut),
  }));
  const chronological = by === "day" || by === "month" || by === "weekday" || by === "hour";
  return chronological
    ? out.sort((a, b) => a.key.localeCompare(b.key))
    : out.sort((a, b) => (b.cashIn + b.cashOut) - (a.cashIn + a.cashOut) || a.label.localeCompare(b.label));
}

// ─── Trend ────────────────────────────────────────────────────────────────────

export interface TrendBucket { key: string; label: string; cashIn: number; cashOut: number }

/** Spans up to this many days are charted per day (quiet days included); longer ones per month. */
const TREND_DAILY_MAX = 62;

export function trendBuckets(rows: LedgerRow[]): { unit: "day" | "month"; buckets: TrendBucket[] } {
  if (rows.length === 0) return { unit: "day", buckets: [] };
  let min = rows[0].day, max = rows[0].day;
  for (const r of rows) { if (r.day < min) min = r.day; if (r.day > max) max = r.day; }
  const span = (Date.parse(`${max}T00:00:00Z`) - Date.parse(`${min}T00:00:00Z`)) / 86_400_000 + 1;
  const unit = span <= TREND_DAILY_MAX ? "day" : "month";

  const map = new Map<string, TrendBucket>();
  for (const r of rows) {
    const key = unit === "day" ? r.day : r.day.slice(0, 7);
    let b = map.get(key);
    if (!b) {
      b = {
        key,
        label: unit === "day"
          ? formatBiz(new Date(`${key}T12:00:00Z`), { month: "short", day: "numeric" })
          : monthLabel(key),
        cashIn: 0, cashOut: 0,
      };
      map.set(key, b);
    }
    b.cashIn += r.cashIn;
    b.cashOut += r.cashOut;
  }

  if (unit === "day") {
    for (let d = min; d <= max; d = addDaysISO(d, 1)) {
      if (!map.has(d)) {
        map.set(d, { key: d, label: formatBiz(new Date(`${d}T12:00:00Z`), { month: "short", day: "numeric" }), cashIn: 0, cashOut: 0 });
      }
    }
  }
  return { unit, buckets: [...map.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

// ─── Formatting / export ──────────────────────────────────────────────────────

export const dateLabel = (ts: number) =>
  formatBiz(new Date(ts), { year: "numeric", month: "short", day: "numeric" });
export const timeLabel = (ts: number) =>
  formatBiz(new Date(ts), { hour: "numeric", minute: "2-digit" });

/** Rows → plain objects (one key per visible column) for the Excel export. */
export function exportRecords(rows: LedgerRow[], keys: ColumnKey[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const rec: Record<string, unknown> = {};
    for (const k of keys) {
      const col = COLUMN_BY_KEY[k];
      const v = col.value(r);
      rec[col.label] = k === "date" ? `${r.day} ${timeLabel(r.ts)}` : (v ?? "");
    }
    return rec;
  });
}

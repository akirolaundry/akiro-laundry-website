// lib/actions/finance.ts
"use server";

import { db } from "@/lib/db";
import {
  cashRegisterTransactions, expenseCategories, financePieConfigs, orders, customers,
} from "@/lib/db/schema";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { addDaysISO, bizDayEnd, bizDayStart, isoDayBiz } from "@/lib/utils/business-time";

// ─── Category-key model ───────────────────────────────────────────────────────
// Every ledger transaction resolves to a stable string key. Keys are used by the
// recap, the customizable pie charts and the Excel export.
//
//   inc:orders    → order payments received (type = payment_in)
//   inc:adjust    → positive manual adjustments
//   inc:cat:<id>  → manual income, grouped by expense_categories.id
//   inc:none      → manual income with no category
//   exp:change    → change given to customers (type = change_out)
//   exp:adjust    → negative manual adjustments
//   exp:cat:<id>  → manual expense, grouped by expense_categories.id
//   exp:none      → manual expense with no category
//   initial       → opening balance (shown in the ledger, excluded from recap)

const AUTO_META: Record<string, { label: string; color: string }> = {
  "inc:orders": { label: "Order Payments",        color: "#16a34a" },
  "inc:adjust": { label: "Adjustment (In)",       color: "#0891b2" },
  "inc:none":   { label: "Uncategorised Income",  color: "#64748b" },
  "inc:other":  { label: "Other Income",          color: "#94a3b8" },
  "exp:change": { label: "Change Given",          color: "#f59e0b" },
  "exp:adjust": { label: "Adjustment (Out)",      color: "#a855f7" },
  "exp:none":   { label: "Uncategorised Expense", color: "#64748b" },
  "exp:other":  { label: "Other Expense",         color: "#94a3b8" },
  "initial":    { label: "Opening Balance",       color: "#cbd5e1" },
};

interface RawTx {
  id: number;
  direction: "income" | "outcome";
  type: string;
  categoryId: number | null;
  orderId: number | null;
  amount: string;
  balanceAfter: string;
  description: string;
  createdAt: Date;
  categoryName: string | null;
  categoryColor: string | null;
  orderNumber: string | null;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  orderTotal: string | null;
  orderPaymentStatus: string | null;
  /** Change subtracted from this payment_in by netChangeOut(), if any. */
  changeNetted?: number;
}

function classify(tx: RawTx): { key: string; label: string; color: string } {
  switch (tx.type) {
    case "payment_in":
      return { key: "inc:orders", ...AUTO_META["inc:orders"] };
    case "change_out":
      return { key: "exp:change", ...AUTO_META["exp:change"] };
    case "manual_adjustment":
      return tx.direction === "income"
        ? { key: "inc:adjust", ...AUTO_META["inc:adjust"] }
        : { key: "exp:adjust", ...AUTO_META["exp:adjust"] };
    case "initial":
      return { key: "initial", ...AUTO_META["initial"] };
    case "manual_income":
      return tx.categoryId
        ? {
            key: `inc:cat:${tx.categoryId}`,
            label: tx.categoryName ?? "Income",
            color: tx.categoryColor ?? "#16a34a",
          }
        : { key: "inc:none", ...AUTO_META["inc:none"] };
    case "manual_outcome":
      return tx.categoryId
        ? {
            key: `exp:cat:${tx.categoryId}`,
            label: tx.categoryName ?? "Expense",
            color: tx.categoryColor ?? "#e11d48",
          }
        : { key: "exp:none", ...AUTO_META["exp:none"] };
    default:
      return tx.direction === "income"
        ? { key: "inc:other", ...AUTO_META["inc:other"] }
        : { key: "exp:other", ...AUTO_META["exp:other"] };
  }
}

// ─── Base query ───────────────────────────────────────────────────────────────

async function fetchTransactions(fromISO: string, toISO: string): Promise<RawTx[]> {
  // Pinned to the shop's timezone (Asia/Dili, UTC+9) — a bare "T00:00:00" would
  // use the server's zone (UTC on Vercel) and shift the day boundary by 9 hours.
  const start = bizDayStart(fromISO);
  const end   = bizDayEnd(toISO);

  const rows = await db
    .select({
      id:            cashRegisterTransactions.id,
      direction:     cashRegisterTransactions.direction,
      type:          cashRegisterTransactions.type,
      categoryId:    cashRegisterTransactions.categoryId,
      orderId:       cashRegisterTransactions.orderId,
      amount:        cashRegisterTransactions.amount,
      balanceAfter:  cashRegisterTransactions.balanceAfter,
      description:   cashRegisterTransactions.description,
      createdAt:     cashRegisterTransactions.createdAt,
      categoryName:  expenseCategories.name,
      categoryColor: expenseCategories.color,
      orderNumber:   orders.orderNumber,
      customerId:    customers.id,
      customerName:  customers.name,
      customerPhone: customers.phone,
      orderTotal:    orders.totalPrice,
      orderPaymentStatus: orders.paymentStatus,
    })
    .from(cashRegisterTransactions)
    .leftJoin(expenseCategories, eq(cashRegisterTransactions.categoryId, expenseCategories.id))
    .leftJoin(orders, eq(cashRegisterTransactions.orderId, orders.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(and(
      gte(cashRegisterTransactions.createdAt, start),
      lte(cashRegisterTransactions.createdAt, end),
    ))
    .orderBy(asc(cashRegisterTransactions.createdAt), asc(cashRegisterTransactions.id));

  return rows as RawTx[];
}

// ─── Net change given back to the revenue ─────────────────────────────────────
// A cash sale books two rows: `payment_in` for the full amount tendered and
// `change_out` for the change returned. The drawer/cash-register menu shows both
// (the real cash movement), but the finance books should only ever see the
// revenue. This collapses each pair: the `change_out` row is dropped and its
// amount is subtracted from the sibling `payment_in` that precedes it, both
// from the amount and from the running balance.
//
// An order paid in instalments (DP, then the balance) has several `payment_in`
// rows but only the one that overpaid has a `change_out`. Each `change_out` is
// written right after the `payment_in` it belongs to, so it is paired with the
// closest preceding `payment_in` of the same order — NOT every payment of that
// order. (Matching by orderId alone subtracted the final payment's change from
// the DP row as well, making part of the DP vanish from the books.)
//
// Legacy rows still work: an order with a lone `payment_in` (already equal to the
// revenue, no `change_out`) is left untouched. A `change_out` whose `payment_in`
// falls outside the fetched period stays as a real "Change Given" outflow.
//
// Deleting an order detaches its ledger rows (orderId → null), so rows are paired
// by order id when present and otherwise by the order number in the description.
function orderKey(t: RawTx): string | null {
  if (t.orderId != null) return `id:${t.orderId}`;
  const no = t.description.match(/for order (\S+)/)?.[1];
  return no ? `no:${no}` : null;
}

function netChangeOut(txs: RawTx[]): RawTx[] {
  const lastPaymentByOrder = new Map<string, number>(); // order key → payment_in tx id
  const changeByPayment    = new Map<number, number>(); // payment_in tx id → change
  const absorbed           = new Set<number>();         // change_out tx ids netted away

  for (const t of txs) {
    const key = orderKey(t);
    if (key == null) continue;
    if (t.type === "payment_in") {
      lastPaymentByOrder.set(key, t.id);
    } else if (t.type === "change_out") {
      const payId = lastPaymentByOrder.get(key);
      if (payId == null) continue;
      changeByPayment.set(payId, (changeByPayment.get(payId) ?? 0) + parseFloat(t.amount));
      absorbed.add(t.id);
    }
  }
  if (absorbed.size === 0) return txs;

  return txs
    .filter((t) => !absorbed.has(t.id))
    .map((t) => {
      const chg = t.type === "payment_in" ? changeByPayment.get(t.id) : undefined;
      if (!chg) return t;
      return {
        ...t,
        amount:       (parseFloat(t.amount) - chg).toFixed(2),
        balanceAfter: (parseFloat(t.balanceAfter) - chg).toFixed(2),
        changeNetted: chg,
      };
    });
}

// ─── Payment type (full / DP / balance) ───────────────────────────────────────
// A payment that completes an order which already had an earlier payment (a DP,
// or a balance reopened by an edit) is the "final" one. Each order's first
// payment is looked up across all history — the order total can't tell, since
// paid orders can be edited. Expects the netted transactions, oldest first.

type PaymentType = "full" | "dp" | "balance";

async function resolvePaymentTypes(txs: RawTx[]): Promise<Map<number, PaymentType>> {
  const paidOrderIds = [...new Set(
    txs.filter((t) => t.type === "payment_in" && t.orderId != null).map((t) => t.orderId!),
  )];
  const firstPayments = paidOrderIds.length === 0 ? [] : await db
    .select({
      orderId: cashRegisterTransactions.orderId,
      firstId: sql<number>`min(${cashRegisterTransactions.id})`,
    })
    .from(cashRegisterTransactions)
    .where(and(
      eq(cashRegisterTransactions.type, "payment_in"),
      inArray(cashRegisterTransactions.orderId, paidOrderIds),
    ))
    .groupBy(cashRegisterTransactions.orderId);
  const firstPaymentId = new Map(firstPayments.map((r) => [r.orderId!, Number(r.firstId)]));
  // Rows detached from a deleted order can only be matched within the period.
  const seenDetached = new Set<string>();

  const result = new Map<number, PaymentType>();
  for (const t of txs) {
    if (t.type !== "payment_in") continue;
    let hadEarlierPayment: boolean;
    if (t.orderId != null) {
      hadEarlierPayment = (firstPaymentId.get(t.orderId) ?? t.id) < t.id;
    } else {
      const key = orderKey(t);
      hadEarlierPayment = key != null && seenDetached.has(key);
      if (key != null) seenDetached.add(key);
    }
    result.set(t.id, t.description.startsWith("Partial payment") ? "dp"
      : hadEarlierPayment ? "balance"
      : "full");
  }
  return result;
}

// ─── Ledger (Buku Kecil) ──────────────────────────────────────────────────────

export interface LedgerEntry {
  id: number;
  createdAt: Date;
  description: string;
  categoryKey: string;
  categoryLabel: string;
  categoryColor: string;
  direction: "income" | "outcome";
  debit: number;   // money out
  credit: number;  // money in
  balanceAfter: number;
  type: string;
  /** Order payments only: paid in one go, a DP, or the final payment after an earlier one. */
  paymentType: PaymentType | null;
  orderId: number | null;
  orderNumber: string | null;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  /** Current order total / payment status (not as of the transaction). */
  orderTotal: number | null;
  orderPaymentStatus: string | null;
  /** Cash handed over and change returned — set only when change was given back. */
  tendered: number | null;
  change: number | null;
}

export async function getLedger(fromISO: string, toISO: string): Promise<LedgerEntry[]> {
  const txs   = netChangeOut(await fetchTransactions(fromISO, toISO));
  const types = await resolvePaymentTypes(txs);
  return txs.map((tx) => {
    const meta   = classify(tx);
    const amount = parseFloat(tx.amount);
    return {
      id:            tx.id,
      createdAt:     tx.createdAt,
      description:   tx.description,
      categoryKey:   meta.key,
      categoryLabel: meta.label,
      categoryColor: meta.color,
      direction:     tx.direction,
      debit:         tx.direction === "outcome" ? amount : 0,
      credit:        tx.direction === "income"  ? amount : 0,
      balanceAfter:  parseFloat(tx.balanceAfter),
      type:          tx.type,
      paymentType:   types.get(tx.id) ?? null,
      orderId:       tx.orderId,
      // Deleting an order detaches its ledger rows — fall back to the order
      // number written into the description.
      orderNumber:   tx.orderNumber ?? tx.description.match(/for order (\S+)/)?.[1] ?? null,
      customerId:    tx.customerId,
      customerName:  tx.customerName,
      customerPhone: tx.customerPhone,
      orderTotal:    tx.orderTotal != null ? parseFloat(tx.orderTotal) : null,
      orderPaymentStatus: tx.orderPaymentStatus,
      tendered:      tx.changeNetted ? r2(amount + tx.changeNetted) : null,
      change:        tx.changeNetted ? r2(tx.changeNetted) : null,
    };
  });
}

// ─── Cash book (Daily Cash page) ──────────────────────────────────────────────
// Every movement of the cash drawer in a period, split into income and outcome,
// with order payments resolved to their order number and customer. Cash sales
// are shown net of the change handed back (tendered / change kept for display),
// the same way the finance books show them. Balances are re-derived from the
// movements — opening (last recorded balance before the period) + in − out — so
// "expected in drawer" always adds up; `drift` flags it when the recorded
// balances don't.

export type CashBookKind = "payment" | "change" | "manual" | "adjustment" | "opening";

export interface CashBookEntry {
  id:            number;
  createdAt:     Date;
  /** Business-local calendar day, YYYY-MM-DD. */
  day:           string;
  direction:     "income" | "outcome";
  kind:          CashBookKind;
  /** Order payments only: paid in one go, a DP, or the final payment after an earlier one. */
  paymentType:   "full" | "dp" | "balance" | null;
  /** Net effect on the drawer (a payment minus the change given back). */
  amount:        number;
  /** Cash the customer handed over — set only when change was given back. */
  tendered:      number | null;
  change:        number | null;
  orderId:       number | null;
  orderNumber:   string | null;
  customerName:  string | null;
  description:   string;
  categoryLabel: string;
  categoryColor: string;
}

export interface CashBookDay {
  day:      string;
  opening:  number;
  cashIn:   number;
  cashOut:  number;
  closing:  number;
  /** Order payments received that day. */
  payments: number;
  /** All movements that day. */
  entries:  number;
}

export interface CashBook {
  openingBalance: number;
  closingBalance: number;
  cashIn:         number;
  cashOut:        number;
  /** Part of `cashIn` that came from order payments. */
  orderIncome:    number;
  paymentCount:   number;
  dpCount:        number;
  outCount:       number;
  /**
   * Recorded register balance at the end of the period minus what the movements
   * add up to. Zero unless the ledger itself doesn't add up.
   */
  drift:          number;
  entries:        CashBookEntry[];
  days:           CashBookDay[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Spans up to this many days list every day, including days without movement. */
const FILL_DAYS_MAX = 62;

function cashBookKind(type: string): CashBookKind {
  switch (type) {
    case "payment_in":        return "payment";
    case "change_out":        return "change";
    case "manual_adjustment": return "adjustment";
    case "initial":           return "opening";
    default:                  return "manual";
  }
}

export async function getCashBook(fromISO: string, toISO: string): Promise<CashBook> {
  const [raw, [prev]] = await Promise.all([
    fetchTransactions(fromISO, toISO),
    db
      .select({ balanceAfter: cashRegisterTransactions.balanceAfter })
      .from(cashRegisterTransactions)
      .where(lt(cashRegisterTransactions.createdAt, bizDayStart(fromISO)))
      .orderBy(desc(cashRegisterTransactions.createdAt), desc(cashRegisterTransactions.id))
      .limit(1),
  ]);
  const openingBalance = prev ? parseFloat(prev.balanceAfter) : 0;

  const netted       = netChangeOut(raw);
  const paymentTypes = await resolvePaymentTypes(netted);

  const entries: CashBookEntry[] = netted.map((t) => {
    const meta   = classify(t);
    const amount = parseFloat(t.amount);
    const kind   = cashBookKind(t.type);

    return {
      id:            t.id,
      createdAt:     t.createdAt,
      day:           isoDayBiz(t.createdAt),
      direction:     t.direction,
      kind,
      paymentType:   kind === "payment" ? (paymentTypes.get(t.id) ?? null) : null,
      amount,
      tendered:      t.changeNetted ? r2(amount + t.changeNetted) : null,
      change:        t.changeNetted ? r2(t.changeNetted) : null,
      orderId:       t.orderId,
      // Deleting an order detaches its ledger rows — fall back to the order
      // number written into the description.
      orderNumber:   t.orderNumber ?? t.description.match(/for order (\S+)/)?.[1] ?? null,
      customerName:  t.customerName,
      description:   t.description,
      categoryLabel: meta.label,
      categoryColor: meta.color,
    };
  });

  // ── Roll up totals and per-day figures from the movements ──
  const byDay = new Map<string, CashBookDay>();
  let running = openingBalance;
  let cashIn = 0, cashOut = 0, orderIncome = 0;
  let paymentCount = 0, dpCount = 0, outCount = 0;

  for (const e of entries) {
    let d = byDay.get(e.day);
    if (!d) {
      d = { day: e.day, opening: r2(running), cashIn: 0, cashOut: 0, closing: r2(running), payments: 0, entries: 0 };
      byDay.set(e.day, d);
    }
    if (e.direction === "income") {
      d.cashIn += e.amount; cashIn += e.amount; running += e.amount;
    } else {
      d.cashOut += e.amount; cashOut += e.amount; running -= e.amount; outCount++;
    }
    d.closing = r2(running);
    d.entries++;
    if (e.kind === "payment") {
      d.payments++; paymentCount++; orderIncome += e.amount;
      if (e.paymentType === "dp") dpCount++;
    }
  }

  // List every day of the period (up to today) when the span is short enough,
  // so quiet days show up too; long custom ranges only list active days.
  const today = isoDayBiz(new Date());
  const last  = toISO < today ? toISO : today;
  const span  = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000 + 1;
  let days: CashBookDay[];
  if (span <= FILL_DAYS_MAX) {
    days = [];
    let carry = r2(openingBalance);
    for (let day = fromISO; day <= last; day = addDaysISO(day, 1)) {
      const d = byDay.get(day)
        ?? { day, opening: carry, cashIn: 0, cashOut: 0, closing: carry, payments: 0, entries: 0 };
      days.push(d);
      carry = d.closing;
    }
  } else {
    days = [...byDay.values()];
  }
  for (const d of days) { d.cashIn = r2(d.cashIn); d.cashOut = r2(d.cashOut); }

  const closingBalance = r2(running);
  const recordedEnd    = raw.length > 0 ? parseFloat(raw[raw.length - 1].balanceAfter) : openingBalance;

  return {
    openingBalance: r2(openingBalance),
    closingBalance,
    cashIn:         r2(cashIn),
    cashOut:        r2(cashOut),
    orderIncome:    r2(orderIncome),
    paymentCount,
    dpCount,
    outCount,
    drift:          r2(recordedEnd - closingBalance),
    entries,
    days,
  };
}

// ─── Recap (Buku Besar) ───────────────────────────────────────────────────────

export interface RecapRow {
  key: string;
  label: string;
  color: string;
  total: number;
  count: number;
}

export interface FinanceRecap {
  income: RecapRow[];
  expense: RecapRow[];
  totalIncome: number;
  totalExpense: number;
  operatingExpense: number;
  netProfit: number;
  netCashFlow: number;
}

export async function getFinanceRecap(fromISO: string, toISO: string): Promise<FinanceRecap> {
  const txs = netChangeOut(await fetchTransactions(fromISO, toISO));

  const acc = new Map<string, RecapRow>();
  for (const tx of txs) {
    const meta = classify(tx);
    if (meta.key === "initial") continue;
    const amount = parseFloat(tx.amount);
    const row = acc.get(meta.key) ?? { key: meta.key, label: meta.label, color: meta.color, total: 0, count: 0 };
    row.total += amount;
    row.count += 1;
    acc.set(meta.key, row);
  }

  const all = [...acc.values()];
  const income  = all.filter((r) => r.key.startsWith("inc:")).sort((a, b) => b.total - a.total);
  const expense = all.filter((r) => r.key.startsWith("exp:")).sort((a, b) => b.total - a.total);

  const totalIncome  = income.reduce((s, r) => s + r.total, 0);
  const totalExpense = expense.reduce((s, r) => s + r.total, 0);
  // Change given to customers is netted out of order income upstream
  // (netChangeOut) and never reaches the recap, so operating expense is simply
  // the full expense total. The `exp:change` lookup is kept as a belt-and-braces
  // guard in case a raw change_out row is ever surfaced here again.
  const changeTotal  = acc.get("exp:change")?.total ?? 0;
  const operatingExpense = totalExpense - changeTotal;

  return {
    income,
    expense,
    totalIncome,
    totalExpense,
    operatingExpense,
    netProfit:   totalIncome - operatingExpense,
    netCashFlow: totalIncome - totalExpense,
  };
}

// ─── Category options for the pie editor ──────────────────────────────────────

export interface FinanceCategoryOption {
  key: string;
  label: string;
  color: string;
  side: "income" | "expense";
}

export async function getFinanceCategoryOptions(): Promise<FinanceCategoryOption[]> {
  const cats = await db.select().from(expenseCategories).orderBy(expenseCategories.name);

  const options: FinanceCategoryOption[] = [
    { key: "inc:orders", label: AUTO_META["inc:orders"].label, color: AUTO_META["inc:orders"].color, side: "income" },
    { key: "inc:adjust", label: AUTO_META["inc:adjust"].label, color: AUTO_META["inc:adjust"].color, side: "income" },
    { key: "inc:none",   label: AUTO_META["inc:none"].label,   color: AUTO_META["inc:none"].color,   side: "income" },
    { key: "exp:change", label: AUTO_META["exp:change"].label, color: AUTO_META["exp:change"].color, side: "expense" },
    { key: "exp:adjust", label: AUTO_META["exp:adjust"].label, color: AUTO_META["exp:adjust"].color, side: "expense" },
    { key: "exp:none",   label: AUTO_META["exp:none"].label,   color: AUTO_META["exp:none"].color,   side: "expense" },
  ];

  for (const c of cats) {
    const color = c.color ?? "#64748b";
    if (c.kind === "income" || c.kind === "both") {
      options.push({ key: `inc:cat:${c.id}`, label: c.name, color, side: "income" });
    }
    if (c.kind === "expense" || c.kind === "both") {
      options.push({ key: `exp:cat:${c.id}`, label: c.name, color, side: "expense" });
    }
  }

  return options;
}

// ─── Pie configs ──────────────────────────────────────────────────────────────

export interface PieConfig {
  slot: number;
  title: string;
  categoryKeys: string[];
}

const DEFAULT_PIE_CONFIGS: { slot: number; title: string; categoryKeys: string }[] = [
  { slot: 1, title: "Income Mix",       categoryKeys: "inc:orders,inc:adjust,inc:none" },
  { slot: 2, title: "Expense Mix",      categoryKeys: "exp:adjust,exp:none" },
  { slot: 3, title: "Income vs Expense", categoryKeys: "inc:orders,exp:adjust,exp:none" },
];

export async function getFinancePieConfigs(): Promise<PieConfig[]> {
  const existing = await db.select().from(financePieConfigs).orderBy(asc(financePieConfigs.slot));
  const bySlot = new Map(existing.map((r) => [r.slot, r]));

  const missing = DEFAULT_PIE_CONFIGS.filter((d) => !bySlot.has(d.slot));
  if (missing.length > 0) {
    await db.insert(financePieConfigs).values(missing).onConflictDoNothing();
  }

  const merged = DEFAULT_PIE_CONFIGS.map((d) => {
    const row = bySlot.get(d.slot);
    return {
      slot: d.slot,
      title: row?.title ?? d.title,
      categoryKeys: (row?.categoryKeys ?? d.categoryKeys).split(",").map((k) => k.trim()).filter(Boolean),
    };
  });
  return merged;
}

export async function updateFinancePieConfig(
  slot: number,
  input: { title: string; categoryKeys: string[] },
): Promise<{ success: boolean; error?: string }> {
  if (![1, 2, 3].includes(slot)) return { success: false, error: "Invalid chart slot." };
  const title = input.title.trim() || `Chart ${slot}`;
  const keys  = input.categoryKeys.join(",");

  try {
    const [existing] = await db
      .select()
      .from(financePieConfigs)
      .where(eq(financePieConfigs.slot, slot))
      .limit(1);

    if (existing) {
      await db
        .update(financePieConfigs)
        .set({ title, categoryKeys: keys, updatedAt: new Date() })
        .where(eq(financePieConfigs.slot, slot));
    } else {
      await db.insert(financePieConfigs).values({ slot, title, categoryKeys: keys });
    }

    revalidatePath("/admin/buku-besar");
    return { success: true };
  } catch (err) {
    console.error("[updateFinancePieConfig]", err);
    return { success: false, error: "Failed to save chart." };
  }
}

// ─── Pie data (configs + amounts for a period) ───────────────────────────────

export interface PieSegment {
  key: string;
  label: string;
  color: string;
  value: number;
}

export interface PieChartData {
  slot: number;
  title: string;
  segments: PieSegment[];
}

export async function getFinancePieData(fromISO: string, toISO: string): Promise<PieChartData[]> {
  const [configs, options, recap] = await Promise.all([
    getFinancePieConfigs(),
    getFinanceCategoryOptions(),
    getFinanceRecap(fromISO, toISO),
  ]);

  const metaByKey = new Map<string, { label: string; color: string }>();
  for (const o of options) metaByKey.set(o.key, { label: o.label, color: o.color });
  const totalByKey = new Map<string, number>();
  for (const r of [...recap.income, ...recap.expense]) totalByKey.set(r.key, r.total);

  return configs.map((cfg) => ({
    slot: cfg.slot,
    title: cfg.title,
    segments: cfg.categoryKeys.map((key) => {
      const meta = metaByKey.get(key) ?? AUTO_META[key] ?? { label: key, color: "#94a3b8" };
      return { key, label: meta.label, color: meta.color, value: totalByKey.get(key) ?? 0 };
    }),
  }));
}

// ─── Export bundle (everything the Excel workbook needs) ──────────────────────

export interface FinanceExportBundle {
  ledger: LedgerEntry[];
  recap: FinanceRecap;
  pies: PieChartData[];
}

export async function getFinanceExportBundle(
  fromISO: string,
  toISO: string,
): Promise<FinanceExportBundle> {
  const [ledger, recap, pies] = await Promise.all([
    getLedger(fromISO, toISO),
    getFinanceRecap(fromISO, toISO),
    getFinancePieData(fromISO, toISO),
  ]);
  return { ledger, recap, pies };
}

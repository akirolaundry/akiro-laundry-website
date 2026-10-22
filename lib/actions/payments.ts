/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/actions/payments.ts  (full replacement)
"use server";

import { db } from "@/lib/db";
import {
  orders,
  customers,
  cashRegister,
  cashRegisterTransactions,
  expenseCategories,
} from "@/lib/db/schema";
import type {
  Order,
  CashRegister,
  CashRegisterTransaction,
  ExpenseCategory,
} from "@/lib/db/schema";
import { eq, desc, asc, gt, gte, lt, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  bizDayAtTimeOf, isISODay, isoDayBiz, startOfDayBiz,
} from "@/lib/utils/business-time";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProcessPaymentInput {
  orderId: number;
  paymentMethod: "cash" | "transfer" | "qris";
  amountTendered: number;
}

export interface ProcessPaymentResult {
  success: boolean;
  change?: number;
  /** Final payment status after this payment was applied. */
  paymentStatus?: "partial" | "paid";
  /** Remaining balance still owed, if the order is now "partial". */
  balanceDue?: number;
  error?: string;
}

export interface CashRegisterState {
  balance: number;
  lastUpdatedAt: Date;
  recentTransactions: (CashRegisterTransaction & {
    categoryName?: string | null;
    /** Description with the order number swapped for the customer's name (cash register pages only). */
    displayDescription: string;
  })[];
}

/**
 * The stored description references the order number (Buku Kecil keeps showing
 * that). The cash register pages show the customer name instead.
 */
function describeWithCustomer(description: string, customerName: string | null): string {
  if (!customerName) return description;
  return description
    .replace(/received for order \S+/, `received from ${customerName}`)
    .replace(/given for order \S+/, `given to ${customerName}`);
}

// ─── NEW: Manual transaction input ───────────────────────────────────────────

export interface RecordManualTransactionInput {
  direction: "income" | "outcome";
  amount: number;
  description: string;
  /** Required when direction === "outcome"; optional for income. */
  categoryId?: number | null;
  /**
   * Business-local day (YYYY-MM-DD) the money actually moved. Defaults to today;
   * a future day is rejected. A past day books the entry on that day.
   */
  date?: string;
}

export interface RecordManualTransactionResult {
  success: boolean;
  error?: string;
  newBalance?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreateRegister(): Promise<CashRegister> {
  const rows = await db.select().from(cashRegister).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await db
    .insert(cashRegister)
    .values({ balance: "0", notes: "Initial balance" })
    .returning();
  return created;
}

// ─── Get Cash Register State ──────────────────────────────────────────────────

export async function getCashRegisterState(limit = 30): Promise<CashRegisterState> {
  const register = await getOrCreateRegister();

  const recentTransactions = await db
    .select({
      tx:           cashRegisterTransactions,
      categoryName: expenseCategories.name,
      customerName: customers.name,
    })
    .from(cashRegisterTransactions)
    .leftJoin(
      expenseCategories,
      eq(cashRegisterTransactions.categoryId, expenseCategories.id),
    )
    .leftJoin(orders, eq(cashRegisterTransactions.orderId, orders.id))
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .orderBy(desc(cashRegisterTransactions.createdAt))
    .limit(Math.min(Math.max(1, limit), 200));

  return {
    balance:       parseFloat(register.balance),
    lastUpdatedAt: register.lastUpdatedAt,
    recentTransactions: recentTransactions.map((r) => ({
      ...r.tx,
      categoryName: r.categoryName ?? null,
      displayDescription: describeWithCustomer(r.tx.description, r.customerName),
    })),
  };
}

// ─── Today's drawer movement ──────────────────────────────────────────────────

export interface CashDrawerToday {
  /** Balance when the business day began, from the ledger — null when there is no history yet. */
  openingBalance: number | null;
  moneyIn:  number;
  moneyOut: number;
  count:    number;
  /** Today's total and count per transaction type (payment_in, change_out, …). */
  byType: { type: string; direction: "income" | "outcome"; amount: number; count: number }[];
  /** Drawer balance after each of today's transactions, oldest first. */
  balanceTrail: { at: Date; balance: number }[];
}

export async function getCashDrawerToday(): Promise<CashDrawerToday> {
  const todayStart = startOfDayBiz(new Date());

  const [[lastBeforeToday], todays] = await Promise.all([
    db
      .select({ balanceAfter: cashRegisterTransactions.balanceAfter })
      .from(cashRegisterTransactions)
      .where(lt(cashRegisterTransactions.createdAt, todayStart))
      .orderBy(desc(cashRegisterTransactions.createdAt), desc(cashRegisterTransactions.id))
      .limit(1),
    db
      .select({
        type:         cashRegisterTransactions.type,
        direction:    cashRegisterTransactions.direction,
        amount:       cashRegisterTransactions.amount,
        balanceAfter: cashRegisterTransactions.balanceAfter,
        createdAt:    cashRegisterTransactions.createdAt,
      })
      .from(cashRegisterTransactions)
      .where(gte(cashRegisterTransactions.createdAt, todayStart))
      .orderBy(asc(cashRegisterTransactions.createdAt), asc(cashRegisterTransactions.id)),
  ]);

  let moneyIn  = 0;
  let moneyOut = 0;
  const byType = new Map<string, CashDrawerToday["byType"][number]>();
  for (const tx of todays) {
    const amount = parseFloat(tx.amount);
    if (tx.direction === "income") moneyIn += amount;
    else moneyOut += amount;
    const key   = `${tx.type}:${tx.direction}`;
    const entry = byType.get(key) ?? { type: tx.type, direction: tx.direction, amount: 0, count: 0 };
    entry.amount += amount;
    entry.count++;
    byType.set(key, entry);
  }

  // Opening balance: the last balance before midnight, or — on the ledger's very
  // first day — the first transaction of today with its own movement undone.
  const first = todays[0];
  const openingBalance = lastBeforeToday
    ? parseFloat(lastBeforeToday.balanceAfter)
    : first
      ? parseFloat(first.balanceAfter) - (first.direction === "income" ? 1 : -1) * parseFloat(first.amount)
      : null;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    openingBalance: openingBalance === null ? null : round2(openingBalance),
    moneyIn:  round2(moneyIn),
    moneyOut: round2(moneyOut),
    count:    todays.length,
    byType:   [...byType.values()]
      .map((t) => ({ ...t, amount: round2(t.amount) }))
      .sort((a, b) => b.amount - a.amount),
    balanceTrail: todays.map((tx) => ({ at: tx.createdAt, balance: parseFloat(tx.balanceAfter) })),
  };
}

// ─── Set Initial / Adjust Cash Register Balance ───────────────────────────────

export async function setCashRegisterBalance(
  newBalance: number,
  reason: string = "Manual adjustment",
): Promise<{ success: boolean; error?: string }> {
  try {
    const register   = await getOrCreateRegister();
    const oldBalance = parseFloat(register.balance);
    const diff       = newBalance - oldBalance;

    await db
      .update(cashRegister)
      .set({ balance: newBalance.toFixed(2), lastUpdatedAt: new Date() })
      .where(eq(cashRegister.id, register.id));

    await db.insert(cashRegisterTransactions).values({
      direction:    diff >= 0 ? "income" : "outcome",
      amount:       Math.abs(diff).toFixed(2),
      type:         "manual_adjustment",
      description:  reason,
      balanceAfter: newBalance.toFixed(2),
    });

    revalidatePath("/employee/orders");
    revalidatePath("/admin/cash-register");
    revalidatePath("/admin/daily-cash");
    revalidatePath("/employee/cash-register");
    revalidatePath("/admin");
    revalidatePath("/admin/buku-kecil");
    revalidatePath("/admin/buku-besar");
    return { success: true };
  } catch (err) {
    console.error("[setCashRegisterBalance]", err);
    return { success: false, error: "Failed to update cash register." };
  }
}

// ─── NEW: Record a manual income or expense transaction ───────────────────────

function revalidateLedgerPages() {
  revalidatePath("/admin/buku-kecil");
  revalidatePath("/admin/buku-besar");

  revalidatePath("/admin/cash-register");
  revalidatePath("/admin/daily-cash");
  revalidatePath("/employee/cash-register");
  revalidatePath("/admin");
}

export async function recordManualTransaction(
  input: RecordManualTransactionInput,
): Promise<RecordManualTransactionResult> {
  const { direction, amount, description, categoryId } = input;

  try {
    if (!amount || amount <= 0) {
      return { success: false, error: "Amount must be greater than zero." };
    }
    // Expense entries must be categorised. Income categories are optional at the
    // action level (the Buku Kecil form still requires one); this keeps the
    // legacy Cash Register income form working.
    if (direction === "outcome" && !categoryId) {
      return { success: false, error: "Please select a category for expense entries." };
    }

    const now   = new Date();
    const today = isoDayBiz(now);
    const date  = input.date?.trim() || today;
    if (!isISODay(date)) return { success: false, error: "Pick a valid date." };
    if (date > today)    return { success: false, error: "The date can't be in the future." };
    if (date < today) {
      return insertBackdatedTransaction({
        direction, amount, description: description.trim(), categoryId: categoryId ?? null, date, now,
      });
    }

    const register      = await getOrCreateRegister();
    const currentBalance = parseFloat(register.balance);
    const newBalance    =
      direction === "income"
        ? currentBalance + amount
        : Math.max(0, currentBalance - amount);

    await db
      .update(cashRegister)
      .set({ balance: newBalance.toFixed(2), lastUpdatedAt: new Date() })
      .where(eq(cashRegister.id, register.id));

    await db.insert(cashRegisterTransactions).values({
      direction,
      amount:       amount.toFixed(2),
      type:         direction === "income" ? "manual_income" : "manual_outcome",
      categoryId:   categoryId ?? null,
      description:  description.trim(),
      balanceAfter: newBalance.toFixed(2),
    });

    revalidateLedgerPages();
    return { success: true, newBalance };
  } catch (err) {
    console.error("[recordManualTransaction]", err);
    return { success: false, error: "Failed to record transaction." };
  }
}

/**
 * Books a manual entry on an earlier day. `balance_after` is a running total, so
 * the entry is slotted into the ledger at that day (same clock time as now) and
 * every later row's balance moves by the same amount — Daily Cash openings and
 * the Buku Kecil balance column then stay consistent, with no drift. The three
 * writes go out as one batch so a failure can't leave the chain half-updated.
 */
async function insertBackdatedTransaction(e: {
  direction:   "income" | "outcome";
  amount:      number;
  description: string;
  categoryId:  number | null;
  date:        string;
  now:         Date;
}): Promise<RecordManualTransactionResult> {
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const register       = await getOrCreateRegister();
  const currentBalance = parseFloat(register.balance);
  const signed         = e.direction === "income" ? e.amount : -e.amount;
  if (e.direction === "outcome" && e.amount > currentBalance) {
    return {
      success: false,
      error: `Not enough cash in the drawer (${currentBalance.toFixed(2)} available).`,
    };
  }

  // Nothing before the first record: the opening balance there is unknown.
  const [first] = await db
    .select({ createdAt: cashRegisterTransactions.createdAt })
    .from(cashRegisterTransactions)
    .orderBy(asc(cashRegisterTransactions.createdAt), asc(cashRegisterTransactions.id))
    .limit(1);
  if (first && e.date < isoDayBiz(first.createdAt)) {
    return {
      success: false,
      error: `The cash register has no records before ${isoDayBiz(first.createdAt)} — pick that day or later.`,
    };
  }
  let at = bizDayAtTimeOf(e.date, e.now);
  if (first && at < first.createdAt) at = first.createdAt; // first day: sort right after it

  // The new row sorts after every row up to `at` (ties go to the lower id).
  const [prior] = await db
    .select({ balanceAfter: cashRegisterTransactions.balanceAfter })
    .from(cashRegisterTransactions)
    .where(lte(cashRegisterTransactions.createdAt, at))
    .orderBy(desc(cashRegisterTransactions.createdAt), desc(cashRegisterTransactions.id))
    .limit(1);
  const priorBalance = prior ? parseFloat(prior.balanceAfter) : 0;
  const newBalance   = r2(currentBalance + signed);

  await db.batch([
    db
      .update(cashRegisterTransactions)
      .set({ balanceAfter: sql`${cashRegisterTransactions.balanceAfter} + (${signed.toFixed(2)})::numeric` })
      .where(gt(cashRegisterTransactions.createdAt, at)),
    db
      .update(cashRegister)
      .set({ balance: newBalance.toFixed(2), lastUpdatedAt: new Date() })
      .where(eq(cashRegister.id, register.id)),
    db.insert(cashRegisterTransactions).values({
      direction:    e.direction,
      amount:       e.amount.toFixed(2),
      type:         e.direction === "income" ? "manual_income" : "manual_outcome",
      categoryId:   e.categoryId,
      description:  e.description,
      balanceAfter: r2(priorBalance + signed).toFixed(2),
      createdAt:    at,
    }),
  ]);

  revalidateLedgerPages();
  return { success: true, newBalance };
}

// ─── Employee: record an expense paid out of the drawer ──────────────────────

export interface RecordEmployeeExpenseInput {
  categoryId: number;
  amount:     number;
  /** Optional detail; the category name is used when left blank. */
  note?:      string;
  /** Business-local day (YYYY-MM-DD) the money was spent; defaults to today. */
  date?:      string;
}

/**
 * Staff-facing wrapper around recordManualTransaction: outflows only, the
 * category must be one the admin has switched on for staff, and the drawer must
 * actually hold the cash (the admin form silently floors the balance at 0).
 */
export async function recordEmployeeExpense(
  input: RecordEmployeeExpenseInput,
): Promise<RecordManualTransactionResult> {
  const session = await auth();
  const role    = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "employee" && role !== "admin") {
    return { success: false, error: "You are not allowed to record expenses." };
  }

  const amount = Math.round(input.amount * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "Amount must be greater than zero." };
  }

  const [category] = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, input.categoryId))
    .limit(1);
  if (!category || !category.employeeEnabled || (category.kind !== "expense" && category.kind !== "both")) {
    return { success: false, error: "That category is no longer available. Pick another one." };
  }

  const register = await getOrCreateRegister();
  const balance  = parseFloat(register.balance);
  if (amount > balance) {
    return { success: false, error: `Not enough cash in the drawer (${balance.toFixed(2)} available).` };
  }

  const note = input.note?.trim();
  return recordManualTransaction({
    direction:   "outcome",
    amount,
    description: note ? `${category.name} — ${note}` : category.name,
    categoryId:  category.id,
    date:        input.date,
  });
}

// ─── Process Payment (unchanged logic, adds direction field) ──────────────────

export async function processPayment(
  input: ProcessPaymentInput,
): Promise<ProcessPaymentResult> {
  const { orderId, paymentMethod, amountTendered } = input;

  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return { success: false, error: "Order not found." };
    if (order.paymentStatus === "paid")
      return { success: false, error: "Order is already paid." };

    const totalPrice     = parseFloat(order.totalPrice);
    const alreadyPaid    = order.amountPaid ? parseFloat(order.amountPaid) : 0;
    const balanceRemaining = parseFloat((totalPrice - alreadyPaid).toFixed(2));

    if (amountTendered <= 0) {
      return { success: false, error: "Amount must be greater than zero." };
    }
    // Non-cash methods (transfer/qris) have no "change" mechanism — the amount
    // received must go straight to the balance, so it can't exceed what's owed.
    if (paymentMethod !== "cash" && amountTendered > balanceRemaining) {
      return {
        success: false,
        error: `Amount (${amountTendered.toFixed(2)}) exceeds the remaining balance (${balanceRemaining.toFixed(2)}).`,
      };
    }

    // Cash can overpay (change is returned); only the portion up to the
    // remaining balance is applied to the order — the rest is handed back.
    const appliedAmount = Math.min(amountTendered, balanceRemaining);
    const change        = parseFloat((amountTendered - appliedAmount).toFixed(2));
    const newAmountPaid = parseFloat((alreadyPaid + appliedAmount).toFixed(2));
    const isFullyPaid   = newAmountPaid >= totalPrice;
    const newStatus     = isFullyPaid ? "paid" : "partial";

    await db
      .update(orders)
      .set({
        paymentStatus: newStatus,
        paymentMethod,
        amountPaid:    newAmountPaid.toFixed(2),
        changeGiven:   change.toFixed(2),
        ...(isFullyPaid && { paidAt: new Date() }),
        updatedAt:     new Date(),
      })
      .where(eq(orders.id, orderId));

    if (paymentMethod === "cash") {
      const register       = await getOrCreateRegister();
      const currentBalance = parseFloat(register.balance);

      // Book the real cash movement in two rows: the full amount the customer
      // handed over (`payment_in`), then the change returned to them
      // (`change_out`). Net drawer effect = amountTendered − change = appliedAmount.
      // The finance pages (Buku Kecil / Buku Besar) net the pair back down to the
      // revenue, so only `appliedAmount` shows up there — see lib/actions/finance.ts.
      const balanceAfterTender = currentBalance + amountTendered;
      const balanceAfterChange = parseFloat((balanceAfterTender - change).toFixed(2));

      await db
        .update(cashRegister)
        .set({ balance: balanceAfterChange.toFixed(2), lastUpdatedAt: new Date() })
        .where(eq(cashRegister.id, register.id));

      await db.insert(cashRegisterTransactions).values({
        direction:    "income",
        amount:       amountTendered.toFixed(2),
        type:         "payment_in",
        orderId,
        description:  isFullyPaid
          ? `Payment received for order ${order.orderNumber}`
          : `Partial payment (DP) received for order ${order.orderNumber}`,
        balanceAfter: balanceAfterTender.toFixed(2),
      });

      if (change > 0) {
        await db.insert(cashRegisterTransactions).values({
          direction:    "outcome",
          amount:       change.toFixed(2),
          type:         "change_out",
          orderId,
          description:  `Change given for order ${order.orderNumber}`,
          balanceAfter: balanceAfterChange.toFixed(2),
        });
      }
    }

    revalidatePath("/employee/orders");
    revalidatePath(`/employee/orders/${orderId}`);
    if (paymentMethod === "cash") {
      revalidatePath("/employee/cash-register");
      revalidatePath("/admin/cash-register");
      revalidatePath("/admin/daily-cash");
      revalidatePath("/admin");
      // A cash payment writes a payment_in ledger row — the finance pages read
      // that same table, so they must be revalidated too (recordManualTransaction
      // already does this; processPayment previously did not, which left Buku
      // Kecil / Buku Besar showing stale data after every order payment).
      revalidatePath("/admin/buku-kecil");
      revalidatePath("/admin/buku-besar");
    }
    return {
      success:       true,
      change,
      paymentStatus: newStatus,
      balanceDue:    isFullyPaid ? 0 : parseFloat((totalPrice - newAmountPaid).toFixed(2)),
    };
  } catch (err) {
    console.error("[processPayment]", err);
    return { success: false, error: "Payment processing failed. Please try again." };
  }
}

// ─── Expense Category CRUD ────────────────────────────────────────────────────

function revalidateCategoryPages() {
  revalidatePath("/admin/expense-categories");
  revalidatePath("/admin/cash-register");
  revalidatePath("/admin/buku-kecil");
  revalidatePath("/employee/cash-register");
}

export async function getExpenseCategories(
  kind?: "income" | "expense",
): Promise<ExpenseCategory[]> {
  const rows = await db.select().from(expenseCategories).orderBy(expenseCategories.name);
  if (!kind) return rows;
  return rows.filter((c) => c.kind === kind || c.kind === "both");
}

/** Categories staff may file an expense under: expense-side and switched on by an admin. */
export async function getEmployeeExpenseCategories(): Promise<ExpenseCategory[]> {
  const rows = await getExpenseCategories("expense");
  return rows.filter((c) => c.employeeEnabled);
}

export type ExpenseCategoryWithUsage = ExpenseCategory & {
  /** Ledger rows that used this category, and what they added up to. */
  txCount:  number;
  txTotal:  number;
};

/** Every category with how often it has been used — for the admin master-data page. */
export async function getExpenseCategoriesWithUsage(): Promise<ExpenseCategoryWithUsage[]> {
  const rows = await db
    .select({
      category: expenseCategories,
      txCount:  sql<number>`count(${cashRegisterTransactions.id})::int`,
      txTotal:  sql<string>`coalesce(sum(${cashRegisterTransactions.amount}), 0)`,
    })
    .from(expenseCategories)
    .leftJoin(cashRegisterTransactions, eq(cashRegisterTransactions.categoryId, expenseCategories.id))
    .groupBy(expenseCategories.id)
    .orderBy(expenseCategories.name);
  return rows.map((r) => ({ ...r.category, txCount: Number(r.txCount), txTotal: parseFloat(r.txTotal) }));
}

export async function createExpenseCategory(input: {
  name: string;
  description?: string;
  color?: string;
  kind?: "income" | "expense" | "both";
  employeeEnabled?: boolean;
}): Promise<{ success: boolean; category?: ExpenseCategory; error?: string }> {
  try {
    const [cat] = await db
      .insert(expenseCategories)
      .values({
        name:        input.name.trim(),
        description: input.description?.trim() ?? null,
        color:       input.color ?? "#64748b",
        kind:        input.kind ?? "expense",
        employeeEnabled: input.employeeEnabled ?? true,
      })
      .returning();
    revalidateCategoryPages();
    return { success: true, category: cat };
  } catch (err: any) {
    if (err?.code === "23505")
      return { success: false, error: "A category with that name already exists." };
    return { success: false, error: "Failed to create category." };
  }
}

export async function updateExpenseCategory(
  id: number,
  input: { name?: string; description?: string; color?: string; kind?: "income" | "expense" | "both"; employeeEnabled?: boolean },
): Promise<{ success: boolean; error?: string }> {
  try {
    await db
      .update(expenseCategories)
      .set({
        ...(input.name        && { name: input.name.trim() }),
        ...(input.description !== undefined && { description: input.description.trim() || null }),
        ...(input.color       && { color: input.color }),
        ...(input.kind        && { kind: input.kind }),
        ...(input.employeeEnabled !== undefined && { employeeEnabled: input.employeeEnabled }),
      })
      .where(eq(expenseCategories.id, id));
    revalidateCategoryPages();
    return { success: true };
  } catch (err: any) {
    if (err?.code === "23505")
      return { success: false, error: "A category with that name already exists." };
    return { success: false, error: "Failed to update category." };
  }
}

/** Hard delete — removes the category row entirely. Past transactions retain
 *  the categoryId FK which will resolve to null after deletion (SET NULL). */
export async function deleteExpenseCategory(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    await db.delete(expenseCategories).where(eq(expenseCategories.id, id));
    revalidateCategoryPages();
    return { success: true };
  } catch (err) {
    return { success: false, error: "Failed to delete category." };
  }
}
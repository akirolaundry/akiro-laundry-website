/* eslint-disable @typescript-eslint/no-explicit-any */
// components/admin/CashRegisterAdmin.tsx  (full replacement)
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Wallet, TrendingUp, TrendingDown, Loader2,
  ArrowUpCircle, ArrowDownCircle,
  CreditCard, BarChart3, Clock, Tags, ArrowUpRight,
} from "lucide-react";
import { recordManualTransaction } from "@/lib/actions/payments";
import { formatUSD } from "@/lib/utils/order-form";
import { formatDayLabelBiz, isoDayBiz } from "@/lib/utils/business-time";
import type { CashRegisterState } from "@/lib/actions/payments";
import type { RevenueStats } from "@/lib/actions/admin-orders";
import type { ExpenseCategory } from "@/lib/db/schema";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  initialState:      CashRegisterState;
  revenue:           RevenueStats;
  initialCategories: ExpenseCategory[];
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "2px 8px", borderRadius: "20px",
      background: color + "18", border: `1px solid ${color}40`,
      fontSize: "10px", fontWeight: 700, color, whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      padding: "10px 20px",
      background: "linear-gradient(135deg,#f8fafc,#f1f5f9)",
      borderBottom: "1.5px solid #e2e8f0",
      display: "flex", alignItems: "center", gap: "8px",
    }}>
      <p style={{ fontSize: "10px", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        {label}
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CashRegisterAdmin({ initialState, revenue, initialCategories }: Props) {
  const [state, setState] = useState(initialState);
  // Categories are managed on /admin/expense-categories; this page only reads them.
  const categories = initialCategories;

  // ── Transaction form state ────────────────────────────────────────────────
  const [txDirection, setTxDirection] = useState<"income" | "outcome">("income");
  const [txAmount,    setTxAmount]    = useState("");
  const [txDesc,      setTxDesc]      = useState("");
  const [txCategory,  setTxCategory]  = useState<number | null>(null);
  // Day the money moved — today unless the entry is being logged late.
  const [today]                       = useState(() => isoDayBiz(new Date()));
  const [txDate,      setTxDate]      = useState(today);
  const [txFeedback,  setTxFeedback]  = useState<{ ok: boolean; msg: string } | null>(null);
  const [txPending,   startTx]        = useTransition();

  // ─── Submit a manual transaction ────────────────────────────────────────

  const handleTxSubmit = () => {
    const amount = parseFloat(txAmount);
    if (isNaN(amount) || amount <= 0) {
      setTxFeedback({ ok: false, msg: "Enter a valid amount greater than zero." });
      return;
    }
    if (!txDesc.trim()) {
      setTxFeedback({ ok: false, msg: "Please add a description." });
      return;
    }
    if (txDirection === "outcome" && !txCategory) {
      setTxFeedback({ ok: false, msg: "Select an expense category." });
      return;
    }
    if (!txDate || txDate > today) {
      setTxFeedback({ ok: false, msg: txDate ? "The date can't be in the future." : "Pick the date." });
      return;
    }
    setTxFeedback(null);
    startTx(async () => {
      const result = await recordManualTransaction({
        direction:  txDirection,
        amount,
        description: txDesc.trim(),
        categoryId:  txDirection === "outcome" ? txCategory : null,
        date:        txDate,
      });
      if (result.success && result.newBalance !== undefined) {
        setState((prev) => ({
          ...prev,
          balance:       result.newBalance!,
          lastUpdatedAt: new Date(),
        }));
        setTxFeedback({
          ok: true,
          msg: `Recorded${txDate === today ? "" : ` on ${formatDayLabelBiz(txDate)}`}! New balance: ${formatUSD(result.newBalance!)}`,
        });
        setTxAmount("");
        setTxDesc("");
        setTxCategory(null);
      } else {
        setTxFeedback({ ok: false, msg: result.error ?? "Failed." });
      }
    });
  };

  // ─── Revenue cards ────────────────────────────────────────────────────────

  const revenueCards = [
    { label: "Today",        value: revenue.todayRevenue,  icon: Clock,     color: "#1a7fba", bg: "linear-gradient(135deg,#edf7fd,#c8e9f8)", border: "#b6def5" },
    { label: "This Week",    value: revenue.weekRevenue,   icon: BarChart3, color: "#7c3aed", bg: "linear-gradient(135deg,#f5f3ff,#ede9fe)", border: "#c4b5fd" },
    { label: "This Month",   value: revenue.monthRevenue,  icon: TrendingUp,color: "#16a34a", bg: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "#86efac" },
    { label: "Unpaid Orders",value: revenue.totalUnpaid,   icon: CreditCard,color: "#d97706", bg: "linear-gradient(135deg,#fffbeb,#fef3c7)", border: "#fcd34d", isCount: true },
  ];

  // ─────────────────────────────────────────────────────────────────────────

  // Expenses are filed under expense-side categories only.
  const activeCategories = categories.filter((c) => c.kind === "expense" || c.kind === "both");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div>
        <h1 style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "26px", color: "#0f172a", letterSpacing: "-0.02em", marginBottom: "4px" }}>
          Cash Register
        </h1>
        <p style={{ fontSize: "13px", color: "#94a3b8" }}>
          Last updated {new Date(state.lastUpdatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </div>

      {/* ── Balance hero + revenue cards ─────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "20px", alignItems: "stretch" }}>

        {/* Balance card */}
        <div style={{
          borderRadius: "16px",
          background: "linear-gradient(135deg,#0c1e35 0%,#0f3460 60%,#1a5276 100%)",
          boxShadow: "0 12px 40px rgba(12,30,53,0.3)",
          padding: "28px 32px",
          position: "relative", overflow: "hidden",
          minWidth: "280px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}>
          {[0, 1].map((i) => (
            <div key={i} style={{
              position: "absolute",
              top: i === 0 ? "-30px" : "auto", bottom: i === 1 ? "-20px" : "auto",
              left: i === 0 ? "-30px" : "auto", right: i === 1 ? "30px" : "auto",
              width: i === 0 ? 160 : 100, height: i === 0 ? 160 : 100,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(26,127,186,${i === 0 ? 0.35 : 0.2}) 0%, transparent 70%)`,
              pointerEvents: "none",
            }} />
          ))}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
              <Wallet size={14} style={{ color: "rgba(255,255,255,0.5)" }} />
              <p style={{ fontSize: "10px", fontWeight: 800, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                Drawer Balance
              </p>
            </div>
            <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 900, fontSize: "40px", color: "white", letterSpacing: "-0.03em", lineHeight: 1 }}>
              {formatUSD(state.balance)}
            </p>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginTop: "8px" }}>Physical cash in register</p>
          </div>
          <div style={{
            marginTop: "24px", padding: "10px 14px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
          }}>
            <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
              {revenue.totalPaidOrders} paid orders total
            </p>
          </div>
        </div>

        {/* Revenue grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "14px" }}>
          {revenueCards.map((card) => (
            <div key={card.label} style={{
              background: "white", borderRadius: "12px",
              border: "1.5px solid #e2e8f0", padding: "18px 20px",
              boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
            }}>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ width: 36, height: 36, borderRadius: "9px", background: card.bg, border: `1.5px solid ${card.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <card.icon size={16} style={{ color: card.color }} />
                </div>
              </div>
              <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "22px", color: "#0f172a", letterSpacing: "-0.02em" }}>
                {card.isCount ? card.value : formatUSD(card.value as number)}
              </p>
              <p style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", marginTop: "2px" }}>
                {card.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Lower section ─────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: "20px", alignItems: "start" }}>

        {/* Left column: transaction form + category manager */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* ─ Record Transaction ─────────────────────────────────────────── */}
          <div style={{
            background: "white", borderRadius: "12px",
            border: "1.5px solid #e2e8f0",
            boxShadow: "0 1px 6px rgba(0,0,0,0.04)", overflow: "hidden",
          }}>
            <SectionHeader label="Record Transaction" />

            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>

              {/* Direction toggle */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {([
                  { dir: "income",  label: "Income",  Icon: ArrowUpCircle,  color: "#16a34a", bg: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "#86efac" },
                  { dir: "outcome", label: "Expense",  Icon: ArrowDownCircle,color: "#e11d48", bg: "linear-gradient(135deg,#fff1f2,#ffe4e6)", border: "#fda4af" },
                ] as const).map((opt) => {
                  const active = txDirection === opt.dir;
                  return (
                    <button
                      key={opt.dir}
                      onClick={() => { setTxDirection(opt.dir); setTxCategory(null); }}
                      style={{
                        padding: "14px 10px",
                        borderRadius: "10px",
                        border: `2px solid ${active ? opt.color : "#e2e8f0"}`,
                        background: active ? opt.bg : "white",
                        cursor: "pointer",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                        transition: "all 0.12s",
                      }}
                    >
                      <opt.Icon size={20} style={{ color: active ? opt.color : "#94a3b8" }} />
                      <span style={{ fontSize: "12px", fontWeight: 800, color: active ? opt.color : "#94a3b8" }}>
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Category dropdown (outcome only) */}
              {txDirection === "outcome" && (
                <div>
                  <label style={{ display: "block", fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
                    Category <span style={{ color: "#e11d48" }}>*</span>
                  </label>
                  {activeCategories.length === 0 ? (
                    <p style={{ fontSize: "12px", color: "#f59e0b", padding: "8px 12px", background: "#fffbeb", borderRadius: "8px", border: "1px solid #fcd34d" }}>
                      No expense categories yet — add one on the Expense Categories page.
                    </p>
                  ) : (
                    <select
                      value={txCategory ?? ""}
                      onChange={(e) => setTxCategory(e.target.value ? parseInt(e.target.value) : null)}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        padding: "10px 14px", border: "1.5px solid #e2e8f0", borderRadius: "8px",
                        fontSize: "13px", color: "#1e293b", background: "white", outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      <option value="">Select a category…</option>
                      {activeCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Amount */}
              <div>
                <label style={{ display: "block", fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
                  Amount
                </label>
                <input
                  type="number" min="0" step="0.01"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  placeholder="0.00"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 14px", border: "1.5px solid #e2e8f0", borderRadius: "8px",
                    fontSize: "18px", fontWeight: 700, color: "#1e293b", outline: "none",
                  }}
                  onFocus={(e)  => { e.currentTarget.style.borderColor = "#b6def5"; }}
                  onBlur={(e)   => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
                />
              </div>

              {/* Date */}
              <div>
                <label style={{ display: "block", fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
                  {txDirection === "income" ? "Date received" : "Date spent"}
                </label>
                <input
                  type="date"
                  value={txDate}
                  max={today}
                  onChange={(e) => setTxDate(e.target.value)}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 14px", border: "1.5px solid #e2e8f0", borderRadius: "8px",
                    fontSize: "13px", color: "#1e293b", outline: "none",
                  }}
                  onFocus={(e)  => { e.currentTarget.style.borderColor = "#b6def5"; }}
                  onBlur={(e)   => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
                />
                {txDate && txDate !== today && (
                  <p style={{ fontSize: "11px", fontWeight: 600, color: "#d97706", marginTop: "6px" }}>
                    Booked on {formatDayLabelBiz(txDate)} — the balance from that day on will include it.
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <label style={{ display: "block", fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
                  Description
                </label>
                <input
                  type="text"
                  value={txDesc}
                  onChange={(e) => setTxDesc(e.target.value)}
                  placeholder={txDirection === "income" ? "e.g. Opening float, sales bonus…" : "e.g. Bought cleaning supplies…"}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 14px", border: "1.5px solid #e2e8f0", borderRadius: "8px",
                    fontSize: "13px", color: "#1e293b", outline: "none",
                  }}
                  onFocus={(e)  => { e.currentTarget.style.borderColor = "#b6def5"; }}
                  onBlur={(e)   => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
                />
              </div>

              {/* Preview */}
              {txAmount && !isNaN(parseFloat(txAmount)) && parseFloat(txAmount) > 0 && (
                <div style={{
                  padding: "10px 14px", borderRadius: "8px",
                  background: "linear-gradient(135deg,#f8fafc,#f1f5f9)",
                  border: "1.5px solid #e2e8f0",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#64748b" }}>Balance after</span>
                  <span style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "16px", color: "#0f172a" }}>
                    {formatUSD(
                      txDirection === "income"
                        ? state.balance + parseFloat(txAmount)
                        : Math.max(0, state.balance - parseFloat(txAmount)),
                    )}
                  </span>
                </div>
              )}

              {/* Feedback */}
              {txFeedback && (
                <div style={{
                  padding: "10px 14px", borderRadius: "7px",
                  background: txFeedback.ok ? "#f0fdf4" : "#fff1f2",
                  border: `1.5px solid ${txFeedback.ok ? "#86efac" : "#fda4af"}`,
                }}>
                  <p style={{ fontSize: "12px", fontWeight: 600, color: txFeedback.ok ? "#14532d" : "#be123c" }}>
                    {txFeedback.msg}
                  </p>
                </div>
              )}

              <button
                onClick={handleTxSubmit}
                disabled={txPending}
                style={{
                  height: 46, borderRadius: "9px", border: "none",
                  background: txPending ? "#94a3b8" :
                    txDirection === "income"
                      ? "linear-gradient(135deg,#15803d,#22c55e 55%,#166534)"
                      : "linear-gradient(135deg,#be123c,#f43f5e 55%,#9f1239)",
                  boxShadow: txPending ? "none" :
                    txDirection === "income"
                      ? "0 4px 14px rgba(22,163,74,0.3)"
                      : "0 4px 14px rgba(225,29,72,0.3)",
                  color: "white", fontSize: "14px", fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                  cursor: txPending ? "not-allowed" : "pointer",
                  opacity: txPending ? 0.6 : 1,
                }}
              >
                {txPending
                  ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                  : txDirection === "income"
                    ? <><ArrowUpCircle size={15} /> Record Income</>
                    : <><ArrowDownCircle size={15} /> Record Expense</>
                }
              </button>
            </div>
          </div>

          {/* ─ Expense Categories → master data page ─────────────────────── */}
          <Link
            href="/admin/expense-categories"
            style={{
              display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px",
              background: "white", borderRadius: "12px", border: "1.5px solid #e2e8f0",
              boxShadow: "0 1px 6px rgba(0,0,0,0.04)", textDecoration: "none",
            }}
          >
            <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: "9px", background: "#edf7fd", border: "1.5px solid #b6def5", display: "flex", alignItems: "center", justifyContent: "center", color: "#1a7fba" }}>
              <Tags size={16} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>Expense categories</span>
              <span style={{ display: "block", fontSize: "11px", color: "#94a3b8", marginTop: "1px" }}>
                {categories.length} categor{categories.length === 1 ? "y" : "ies"} · add, edit and choose what employees can use
              </span>
            </span>
            <ArrowUpRight size={16} style={{ color: "#94a3b8", flexShrink: 0 }} />
          </Link>
        </div>

        {/* ── Transaction ledger ─────────────────────────────────────────── */}
        <div style={{
          background: "white", borderRadius: "12px",
          border: "1.5px solid #e2e8f0",
          boxShadow: "0 1px 6px rgba(0,0,0,0.04)", overflow: "hidden",
        }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9" }}>
            <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "14px", color: "#0f172a" }}>
              Transaction Ledger
            </p>
            <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "1px" }}>
              Last {state.recentTransactions.length} transactions
            </p>
          </div>

          {state.recentTransactions.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center" }}>
              <Wallet size={28} style={{ color: "#cbd5e1", margin: "0 auto 10px", display: "block" }} />
              <p style={{ fontSize: "14px", fontWeight: 600, color: "#94a3b8" }}>No transactions yet</p>
            </div>
          ) : (
            <div>
              {state.recentTransactions.map((tx, i) => {
                const isIncome    = (tx as any).direction === "income";
                const isChangeOut = tx.type === "change_out";
                const catName     = (tx as any).categoryName as string | null;
                const catColor    = catName
                  ? (categories.find((c) => c.name === catName)?.color ?? "#64748b")
                  : "#64748b";

                // income = green · change returned to customer = amber · other outflow = red
                const tone = isIncome
                  ? { icon: "#16a34a", bg: "#f0fdf4", border: "#86efac", amount: "#16a34a" }
                  : isChangeOut
                  ? { icon: "#b45309", bg: "#fffbeb", border: "#fcd34d", amount: "#d97706" }
                  : { icon: "#e11d48", bg: "#fff1f2", border: "#fda4af", amount: "#e11d48" };

                return (
                  <div
                    key={tx.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "14px",
                      padding: "14px 20px",
                      borderBottom: "1px solid #f8fafc",
                      background: i % 2 === 0 ? "white" : "#fafafa",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f9ff"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = i % 2 === 0 ? "white" : "#fafafa"; }}
                  >
                    <div style={{
                      width: 34, height: 34, flexShrink: 0, borderRadius: "8px",
                      background: tone.bg,
                      border: `1.5px solid ${tone.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isIncome
                        ? <TrendingUp   size={14} style={{ color: tone.icon }} />
                        : <TrendingDown size={14} style={{ color: tone.icon }} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "220px" }}>
                          {tx.displayDescription}
                        </p>
                        {catName && <Badge color={catColor} label={catName} />}
                      </div>
                      <div style={{ display: "flex", gap: "10px", marginTop: "2px" }}>
                        <span style={{ fontSize: "10px", color: "#94a3b8" }}>
                          {new Date(tx.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span style={{ fontSize: "10px", color: "#cbd5e1" }}>
                          Bal after: {formatUSD(parseFloat(tx.balanceAfter))}
                        </span>
                      </div>
                    </div>

                    <span style={{
                      fontSize: "14px", fontWeight: 800, whiteSpace: "nowrap",
                      color: tone.amount,
                    }}>
                      {isIncome ? "+" : "−"}{formatUSD(parseFloat(tx.amount))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
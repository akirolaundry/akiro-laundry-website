// components/admin/DailyCashClient.tsx
"use client";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DateRange } from "react-day-picker";
import {
  Banknote, ChevronLeft, ChevronRight, ArrowDownLeft, ArrowUpRight, Wallet,
  Loader2, AlertTriangle, CheckCircle2, Calculator, Inbox, Info, CalendarCheck,
  ShoppingBag, HandCoins, Hourglass,
} from "lucide-react";
import { formatUSD } from "@/lib/utils/order-form";
import { addDaysISO, formatBiz } from "@/lib/utils/business-time";
import { SegmentedControl } from "@/components/admin/SegmentedControl";
import { DateRangePicker } from "@/components/admin/DateRangePicker";
import type {
  CashBook, CashBookDay, CashBookEntry, OrderBook, OrderBookDay, OrderBookOrder,
} from "@/lib/actions/finance";
import { cashBookHref, type CashBookBasis, type CashBookPeriod } from "@/lib/utils/cash-book-period";

interface Props {
  period:    CashBookPeriod;
  /** Set when revenue is counted as cash in (`period.basis === "cash"`). */
  book:      CashBook | null;
  /** Set when revenue is counted by order date (`period.basis === "orders"`). */
  orderBook: OrderBook | null;
}

/** What the two bodies share with the page frame. */
interface ViewProps {
  period:    CashBookPeriod;
  /** "today" / "this week" / "on this day" … for sentences. */
  phrase:    string;
  multiDay:  boolean;
  pending:   boolean;
  onOpenDay: (day: string) => void;
}

// ─── Styles & helpers ─────────────────────────────────────────────────────────

const num: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFamily: "'Sora',ui-monospace,monospace",
};

const card: React.CSSProperties = {
  background: "white", borderRadius: "14px", border: "1.5px solid #e2e8f0",
  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
};

const th: React.CSSProperties = {
  padding: "9px 14px", textAlign: "left", background: "#f8fafc",
  fontSize: "10px", fontWeight: 800, color: "#94a3b8",
  textTransform: "uppercase", letterSpacing: "0.08em",
  borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "11px 14px", borderBottom: "1px solid #f1f5f9",
  fontSize: "12px", color: "#1e293b", verticalAlign: "middle",
};

const GREEN = { color: "#16a34a", bg: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "#86efac" };
const ROSE  = { color: "#e11d48", bg: "linear-gradient(135deg,#fff1f2,#ffe4e6)", border: "#fda4af" };
const SLATE = { color: "#475569", bg: "linear-gradient(135deg,#f8fafc,#f1f5f9)", border: "#e2e8f0" };

/** "14:32" in Timor-Leste time. */
const timeOf = (d: Date | string) =>
  formatBiz(new Date(d), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "Tue, Oct 7" for a YYYY-MM-DD calendar day. */
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${iso}T00:00:00Z`));

const toLocalISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromLocalISO = (s: string) => new Date(`${s}T00:00:00`);

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${formatUSD(Math.abs(n))}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

const ellipsis: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** Sum of entry amounts matching `pred`, plus how many matched. */
function tally(entries: CashBookEntry[], pred: (e: CashBookEntry) => boolean) {
  const hits = entries.filter(pred);
  return { total: r2(hits.reduce((s, e) => s + e.amount, 0)), count: hits.length };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function DailyCashClient({ period, book, orderBook }: Props) {
  const router = useRouter();
  const [pending, startNav] = useTransition();
  const go = (href: string) => startNav(() => router.push(href, { scroll: false }));
  // Every link keeps the revenue basis that is switched on.
  const link = (p: Omit<Parameters<typeof cashBookHref>[0], "basis">) =>
    cashBookHref({ ...p, basis: period.basis });

  const multiDay = period.from !== period.to;
  const orderView = period.basis === "orders";

  const phrase =
    period.view === "daily"   ? (period.isCurrent ? "today"      : "on this day")
    : period.view === "weekly"  ? (period.isCurrent ? "this week"  : "that week")
    : period.view === "monthly" ? (period.isCurrent ? "this month" : "that month")
    : "in this range";

  const spanDays = Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86_400_000) + 1;
  const caption =
    period.view === "daily"   ? (period.isCurrent ? "Today" : "Daily view")
    : period.view === "weekly"  ? `${period.isCurrent ? "This week" : "Weekly view"} · Mon – Sun`
    : period.view === "monthly" ? (period.isCurrent ? "This month" : "Monthly view")
    : `Custom range · ${plural(spanDays, "day")}`;

  // Switching view keeps your place: the current period follows today,
  // a past one keeps its first day.
  const switchView = (v: "daily" | "weekly" | "monthly") => {
    if (v === period.view) return;
    go(link({ view: v, date: period.isCurrent ? undefined : period.from }));
  };
  const step = (anchor: string | null) => {
    if (anchor && period.view !== "custom") go(link({ view: period.view, date: anchor }));
  };
  const openDay = (day: string) => go(link({ view: "daily", date: day }));
  // Same period, other way of counting revenue.
  const switchBasis = (basis: CashBookBasis) => {
    if (basis === period.basis) return;
    go(cashBookHref(period.view === "custom"
      ? { view: "custom", from: period.from, to: period.to, basis }
      : { view: period.view, date: period.isCurrent ? undefined : period.from, basis }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "26px", color: "#0f172a", letterSpacing: "-0.02em", marginBottom: "4px", display: "flex", alignItems: "center", gap: "10px" }}>
            <Banknote size={24} style={{ color: "#1a7fba" }} /> Daily Cash
          </h1>
          <p style={{ fontSize: "13px", color: "#94a3b8" }}>
            {orderView
              ? "Every order placed in the period at its full price, whatever the payment method — and how much of it has been paid."
              : "Every payment and expense that went through the cash register — count the drawer against it."}
          </p>
        </div>
        <div>
          <p style={{ fontSize: "9.5px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "5px", textAlign: "right" }}>
            Revenue by
          </p>
          <SegmentedControl
            options={[
              { value: "cash"   as const, label: "Cash in"    },
              { value: "orders" as const, label: "Order date" },
            ]}
            value={period.basis}
            onChange={switchBasis}
          />
        </div>
      </div>

      {/* ── Period toolbar ── */}
      <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", flexWrap: "wrap" }}>
        <SegmentedControl
          options={[
            { value: "daily"   as const, label: "Daily"   },
            { value: "weekly"  as const, label: "Weekly"  },
            { value: "monthly" as const, label: "Monthly" },
          ]}
          value={period.view as "daily" | "weekly" | "monthly"}
          onChange={switchView}
        />

        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          {period.view !== "custom" && (
            <NavArrow label="Previous" disabled={!period.prevAnchor || pending} onClick={() => step(period.prevAnchor)}>
              <ChevronLeft size={15} />
            </NavArrow>
          )}
          <div style={{ textAlign: "center", minWidth: "210px" }}>
            <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "15px", color: "#0f172a", letterSpacing: "-0.01em", display: "flex", alignItems: "center", justifyContent: "center", gap: "7px" }}>
              {period.label}
              {pending && <Loader2 size={13} className="animate-spin" style={{ color: "#1a7fba" }} />}
            </p>
            <p style={{ fontSize: "10.5px", fontWeight: 700, marginTop: "2px", color: period.isCurrent ? "#16a34a" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}>
              {period.isCurrent && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 0 3px rgba(34,197,94,0.18)" }} />}
              {caption}
            </p>
          </div>
          {period.view !== "custom" && (
            <NavArrow label="Next" disabled={!period.nextAnchor || pending} onClick={() => step(period.nextAnchor)}>
              <ChevronRight size={15} />
            </NavArrow>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {!(period.view === "daily" && period.isCurrent) && (
            <button
              type="button"
              onClick={() => go(link({ view: "daily" }))}
              style={{
                display: "inline-flex", alignItems: "center", gap: "6px",
                padding: "6px 11px", borderRadius: "9px", border: "1.5px solid #e2e8f0",
                background: "white", color: "#334155", fontSize: "11.5px", fontWeight: 700,
                fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              <CalendarCheck size={13} style={{ color: "#1a7fba" }} /> Today
            </button>
          )}
          <PeriodPicker
            key={`${period.view}:${period.from}:${period.to}`}
            period={period}
            onRange={(from, to) => go(link({ view: "custom", from, to }))}
            onDay={openDay}
            onClear={() => go(link({ view: "daily" }))}
          />
        </div>
      </div>

      {book && (
        <CashView period={period} book={book} phrase={phrase} multiDay={multiDay} pending={pending} onOpenDay={openDay} />
      )}
      {orderBook && (
        <OrdersView period={period} orderBook={orderBook} phrase={phrase} multiDay={multiDay} pending={pending} onOpenDay={openDay} />
      )}
    </div>
  );
}

// ─── Cash-in view (the drawer count) ──────────────────────────────────────────

function CashView({ period, book, phrase, multiDay, pending, onOpenDay: openDay }: ViewProps & { book: CashBook }) {
  const income  = book.entries.filter((e) => e.direction === "income");
  const outcome = book.entries.filter((e) => e.direction === "outcome");
  const net     = book.cashIn - book.cashOut;

  // Breakdowns shown under the Cash in / Cash out totals. The first row always
  // shows; the others only when there's something in them.
  const otherIn   = tally(book.entries, (e) => e.direction === "income" && e.kind === "manual");
  const adjIn     = tally(book.entries, (e) => e.direction === "income" && (e.kind === "adjustment" || e.kind === "opening"));
  const expenses  = tally(book.entries, (e) => e.direction === "outcome" && e.kind === "manual");
  const adjOut    = tally(book.entries, (e) => e.direction === "outcome" && e.kind === "adjustment");
  const changeOut = tally(book.entries, (e) => e.direction === "outcome" && e.kind === "change");

  const inRows = [
    // Non-breaking spaces keep "(6 · 1 DP)" together when the card is narrow.
    { label: `Payments (${book.paymentCount}${book.dpCount ? ` · ${book.dpCount} DP` : ""})`, value: book.orderIncome, always: true },
    { label: `Other income (${otherIn.count})`, value: otherIn.total },
    { label: "Adjustments", value: adjIn.total },
  ].filter((r) => r.always || r.value > 0);
  const outRows = [
    { label: `Expenses (${expenses.count})`, value: expenses.total, always: true },
    { label: "Adjustments", value: adjOut.total },
    { label: `Change given (${changeOut.count})`, value: changeOut.total },
  ].filter((r) => r.always || r.value > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "22px", opacity: pending ? 0.55 : 1, transition: "opacity 0.2s" }}>

      {/* ── Opening + in − out = expected ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 26px minmax(0,1fr) 26px minmax(0,1fr) 26px minmax(0,1.3fr)", gap: "10px", alignItems: "stretch" }}>
        <FlowCard
          label="Opening balance"
          value={formatUSD(book.openingBalance)}
          note={multiDay
            ? `Cash in the drawer when ${dayLabel(period.from)} began.`
            : `Carried over from the close of ${dayLabel(addDaysISO(period.from, -1))}.`}
          icon={Wallet}
          tone={SLATE}
        />
        <Operator>+</Operator>
        <FlowCard
          label="Cash in"
          value={formatUSD(book.cashIn)}
          valueColor={GREEN.color}
          rows={inRows}
          icon={ArrowDownLeft}
          tone={GREEN}
        />
        <Operator>−</Operator>
        <FlowCard
          label="Cash out"
          value={formatUSD(book.cashOut)}
          valueColor={ROSE.color}
          rows={outRows}
          icon={ArrowUpRight}
          tone={ROSE}
        />
        <Operator>=</Operator>
        <div style={{ borderRadius: "14px", background: "linear-gradient(135deg,#0c1e35 0%,#0f3460 60%,#1a5276 100%)", boxShadow: "0 12px 32px rgba(12,30,53,0.26)", padding: "16px 18px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <Banknote size={13} style={{ color: "rgba(255,255,255,0.55)" }} />
            <p style={{ fontSize: "9.5px", fontWeight: 800, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
              {period.isCurrent ? "Expected in drawer" : "Closing balance"}
            </p>
          </div>
          <p style={{ ...num, fontWeight: 900, fontSize: "27px", color: "white", letterSpacing: "-0.03em", lineHeight: 1, marginTop: "12px" }}>
            {formatUSD(book.closingBalance)}
          </p>
          <p style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.55)", marginTop: "6px" }}>
            Net <span style={{ ...num, fontWeight: 800, color: net >= 0 ? "#86efac" : "#fda4af" }}>{signed(net)}</span> {phrase}
          </p>
          {period.isCurrent && (
            <CountCheck key={`${period.from}:${period.to}`} expected={book.closingBalance} />
          )}
        </div>
      </div>

      {book.drift !== 0 && (
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "12px 16px", borderRadius: "12px", background: "#fffbeb", border: "1.5px solid #fcd34d" }}>
          <AlertTriangle size={16} style={{ color: "#d97706", flexShrink: 0, marginTop: "1px" }} />
          <p style={{ fontSize: "12px", color: "#92400e", lineHeight: 1.55 }}>
            The register recorded <strong>{formatUSD(book.closingBalance + book.drift)}</strong> at the end of this period —{" "}
            <strong>{formatUSD(Math.abs(book.drift))} {book.drift > 0 ? "more" : "less"}</strong> than the entries below add up to.
            Some cash moved without a matching entry; check the Cash Register history before closing the count.
          </p>
        </div>
      )}

      {/* ── Day by day (multi-day periods) ── */}
      {multiDay && <DayTable days={book.days} book={book} onOpenDay={openDay} />}

      {/* ── Income | Outcome ── */}
      {/* Side by side when there's room (wide screens), stacked otherwise. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "18px", alignItems: "flex-start" }}>
        <section style={{ ...card, flex: "1.5 1 600px", minWidth: 0, overflow: "hidden" }}>
          <TableTitle
            icon={ArrowDownLeft} tone={GREEN} title="Income"
            sub={`Cash received ${phrase} · ${plural(income.length, "entry", "entries")}`}
            total={book.cashIn ? `+${formatUSD(book.cashIn)}` : formatUSD(0)}
          />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "480px", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: multiDay ? "92px" : "70px" }} />
                <col />
                <col style={{ width: "132px" }} />
                <col style={{ width: "124px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={th}>Time</th>
                  <th style={th}>Customer · Order</th>
                  <th style={th}>Type</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {income.length === 0 ? (
                  <EmptyRow colSpan={4} text={`No cash came in ${phrase}.`} />
                ) : income.map((e) => (
                  <IncomeRow key={e.id} e={e} multiDay={multiDay} />
                ))}
              </tbody>
              {income.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f8fafc" }}>
                    <td colSpan={3} style={{ ...td, borderBottom: "none", fontSize: "10.5px", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Total income
                    </td>
                    <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontSize: "13px", fontWeight: 800, color: GREEN.color }}>
                      +{formatUSD(book.cashIn)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        <section style={{ ...card, flex: "1 1 380px", minWidth: 0, overflow: "hidden" }}>
          <TableTitle
            icon={ArrowUpRight} tone={ROSE} title="Outcome"
            sub={`Cash paid out ${phrase} · ${plural(outcome.length, "entry", "entries")}`}
            total={book.cashOut ? `−${formatUSD(book.cashOut)}` : formatUSD(0)}
          />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: "320px", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: multiDay ? "92px" : "70px" }} />
                <col />
                <col style={{ width: "108px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={th}>Time</th>
                  <th style={th}>Description · Category</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {outcome.length === 0 ? (
                  <EmptyRow colSpan={3} text={`Nothing was paid out ${phrase}.`} />
                ) : outcome.map((e) => (
                  <OutcomeRow key={e.id} e={e} multiDay={multiDay} />
                ))}
              </tbody>
              {outcome.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f8fafc" }}>
                    <td colSpan={2} style={{ ...td, borderBottom: "none", fontSize: "10.5px", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Total outcome
                    </td>
                    <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontSize: "13px", fontWeight: 800, color: ROSE.color }}>
                      −{formatUSD(book.cashOut)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>

      <p style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#94a3b8" }}>
        <Info size={12} style={{ flexShrink: 0 }} /> Only cash goes through the drawer — transfer and QRIS payments are not listed here.
        Cash sales are shown net of the change handed back. Switch “Revenue by” to Order date to see every order.
      </p>
    </div>
  );
}

// ─── Order-date view (revenue by the day the order was placed) ────────────────

const AMBER = { color: "#b45309", bg: "linear-gradient(135deg,#fffbeb,#fef3c7)", border: "#fcd34d" };
const BLUE  = { color: "#1a7fba", bg: "linear-gradient(135deg,#edf7fd,#c8e9f8)", border: "#b6def5" };

const METHOD_LABEL: Record<string, string> = { cash: "Cash", transfer: "Transfer", qris: "QRIS", other: "Other" };

function OrdersView({ phrase, multiDay, pending, onOpenDay, orderBook: b }: ViewProps & { orderBook: OrderBook }) {
  const collectedRows = b.byMethod.length > 0
    ? b.byMethod.map((m) => ({ label: `${METHOD_LABEL[m.method]} (${m.count})`, value: m.amount }))
    : [{ label: "Nothing collected yet", value: 0 }];
  const owedRows = [
    { label: `Unpaid (${b.unpaidCount})`, value: b.unpaidDue, always: true },
    { label: `Balance on DP (${b.partialCount})`, value: b.partialDue },
  ].filter((r) => r.always || r.value > 0);
  const pct = b.value > 0 ? Math.round((b.collected / b.value) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "22px", opacity: pending ? 0.55 : 1, transition: "opacity 0.2s" }}>

      {/* ── Collected + outstanding = order value ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 26px minmax(0,1fr) 26px minmax(0,1.3fr)", gap: "10px", alignItems: "stretch" }}>
        <FlowCard
          label="Collected"
          value={formatUSD(b.collected)}
          valueColor={GREEN.color}
          rows={collectedRows}
          icon={HandCoins}
          tone={GREEN}
        />
        <Operator>+</Operator>
        <FlowCard
          label="Still owed"
          value={formatUSD(b.outstanding)}
          valueColor={AMBER.color}
          rows={owedRows}
          icon={Hourglass}
          tone={AMBER}
        />
        <Operator>=</Operator>
        <div style={{ borderRadius: "14px", background: "linear-gradient(135deg,#0c1e35 0%,#0f3460 60%,#1a5276 100%)", boxShadow: "0 12px 32px rgba(12,30,53,0.26)", padding: "16px 18px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <ShoppingBag size={13} style={{ color: "rgba(255,255,255,0.55)" }} />
            <p style={{ fontSize: "9.5px", fontWeight: 800, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
              Order value
            </p>
          </div>
          <p style={{ ...num, fontWeight: 900, fontSize: "27px", color: "white", letterSpacing: "-0.03em", lineHeight: 1, marginTop: "12px" }}>
            {formatUSD(b.value)}
          </p>
          <p style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.55)", marginTop: "6px" }}>
            {plural(b.orderCount, "order")} placed {phrase}
          </p>
          <div style={{ marginTop: "auto", paddingTop: "14px" }}>
            <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.14)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#4ade80,#16a34a)", transition: "width 0.2s" }} />
            </div>
            <p style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.55)", marginTop: "6px" }}>
              <span style={{ ...num, fontWeight: 800, color: "#86efac" }}>{pct}%</span> collected so far
            </p>
          </div>
        </div>
      </div>

      {/* ── Day by day (multi-day periods) ── */}
      {multiDay && <OrderDayTable days={b.days} book={b} onOpenDay={onOpenDay} />}

      {/* ── Orders ── */}
      <section style={{ ...card, overflow: "hidden" }}>
        <TableTitle
          icon={ShoppingBag} tone={BLUE} title="Orders"
          sub={`Placed ${phrase} · ${plural(b.orderCount, "order")}`}
          total={formatUSD(b.value)}
        />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: "760px", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: multiDay ? "92px" : "70px" }} />
              <col />
              <col style={{ width: "150px" }} />
              <col style={{ width: "104px" }} />
              <col style={{ width: "104px" }} />
              <col style={{ width: "104px" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={th}>Time</th>
                <th style={th}>Customer · Order</th>
                <th style={th}>Payment</th>
                <th style={{ ...th, textAlign: "right" }}>Total</th>
                <th style={{ ...th, textAlign: "right" }}>Collected</th>
                <th style={{ ...th, textAlign: "right" }}>Still owed</th>
              </tr>
            </thead>
            <tbody>
              {b.orders.length === 0 ? (
                <EmptyRow colSpan={6} text={`No orders were placed ${phrase}.`} />
              ) : b.orders.map((o) => (
                <OrderRow key={o.id} o={o} multiDay={multiDay} />
              ))}
            </tbody>
            {b.orders.length > 0 && (
              <tfoot>
                <tr style={{ background: "#f8fafc" }}>
                  <td colSpan={3} style={{ ...td, borderBottom: "none", fontSize: "10.5px", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Total
                  </td>
                  <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontSize: "13px", fontWeight: 800 }}>{formatUSD(b.value)}</td>
                  <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontSize: "13px", fontWeight: 800, color: GREEN.color }}>{formatUSD(b.collected)}</td>
                  <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontSize: "13px", fontWeight: 800, color: b.outstanding ? AMBER.color : "#cbd5e1" }}>
                    {b.outstanding ? formatUSD(b.outstanding) : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <p style={{ display: "flex", alignItems: "flex-start", gap: "6px", fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>
        <Info size={12} style={{ flexShrink: 0, marginTop: "2px" }} />
        <span>
          Orders are counted on the day they were placed, at their full price, whatever the payment method.
          “Collected” is what has been received against them so far — on any day — and the method shown is the one
          used for the latest payment. Switch “Revenue by” to Cash in for the drawer count.
        </span>
      </p>
    </div>
  );
}

function OrderDayTable({ days, book, onOpenDay }: {
  days: OrderBookDay[]; book: OrderBook; onOpenDay: (day: string) => void;
}) {
  return (
    <section style={{ ...card, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
        <div>
          <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "14px", color: "#0f172a" }}>Day by day</p>
          <p style={{ fontSize: "10.5px", color: "#94a3b8", marginTop: "1px" }}>Click a day to see its orders</p>
        </div>
        <p style={{ fontSize: "11px", color: "#94a3b8" }}>{plural(days.length, "day")}</p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Day</th>
              <th style={{ ...th, textAlign: "right" }}>Orders</th>
              <th style={{ ...th, textAlign: "right" }}>Order value</th>
              <th style={{ ...th, textAlign: "right" }}>Collected</th>
              <th style={{ ...th, textAlign: "right" }}>Still owed</th>
            </tr>
          </thead>
          <tbody>
            {days.length === 0 ? (
              <EmptyRow colSpan={5} text="No orders in this range." />
            ) : days.map((d) => {
              const quiet = d.orders === 0;
              return (
                <tr
                  key={d.day}
                  role="link"
                  tabIndex={0}
                  onClick={() => onOpenDay(d.day)}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpenDay(d.day); }}
                  style={{ cursor: "pointer", transition: "background 0.1s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f4faff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <td style={{ ...td, fontWeight: 700, color: quiet ? "#94a3b8" : "#0f172a", whiteSpace: "nowrap" }}>
                    {dayLabel(d.day)}
                    {quiet && <span style={{ marginLeft: "8px", fontSize: "10px", fontWeight: 600, color: "#cbd5e1" }}>no orders</span>}
                  </td>
                  <td style={{ ...td, ...num, textAlign: "right", color: quiet ? "#cbd5e1" : "#475569" }}>{quiet ? "—" : d.orders}</td>
                  <td style={{ ...td, ...num, textAlign: "right", fontWeight: 800, color: quiet ? "#cbd5e1" : "#0f172a" }}>{quiet ? "—" : formatUSD(d.value)}</td>
                  <td style={{ ...td, ...num, textAlign: "right", fontWeight: 700, color: d.collected ? GREEN.color : "#cbd5e1" }}>{d.collected ? formatUSD(d.collected) : "—"}</td>
                  <td style={{ ...td, ...num, textAlign: "right", fontWeight: 700, color: d.outstanding ? AMBER.color : "#cbd5e1" }}>{d.outstanding ? formatUSD(d.outstanding) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          {days.length > 0 && (
            <tfoot>
              <tr style={{ background: "#f8fafc" }}>
                <td style={{ ...td, borderBottom: "none", fontSize: "10.5px", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontWeight: 800 }}>{book.orderCount}</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontWeight: 800 }}>{formatUSD(book.value)}</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontWeight: 800, color: GREEN.color }}>{formatUSD(book.collected)}</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontWeight: 800, color: book.outstanding ? AMBER.color : "#cbd5e1" }}>{book.outstanding ? formatUSD(book.outstanding) : "—"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function OrderRow({ o, multiDay }: { o: OrderBookOrder; multiDay: boolean }) {
  const status =
    o.paymentStatus === "paid"    ? { label: "Paid",   color: "#15803d", bg: "#f0fdf4", border: "#86efac", title: "Paid in full" }
    : o.paymentStatus === "partial" ? { label: "DP",     color: "#b45309", bg: "#fffbeb", border: "#fcd34d", title: "Down payment — a balance is still owed" }
    :                                 { label: "Unpaid", color: "#be123c", bg: "#fff1f2", border: "#fda4af", title: "Nothing paid yet" };
  const chip: React.CSSProperties = {
    display: "inline-block", maxWidth: "100%", padding: "1px 7px", borderRadius: "6px",
    fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: "10.5px", fontWeight: 700,
    textDecoration: "none", verticalAlign: "middle", color: "#0f5a85", background: "#edf7fd",
    border: "1px solid #b6def5", ...ellipsis,
  };
  return (
    <tr>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {multiDay && <p style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8" }}>{dayLabel(o.day)}</p>}
        <p style={{ ...num, fontSize: "12px", fontWeight: 700, color: "#475569" }}>{timeOf(o.createdAt)}</p>
      </td>
      <td style={td}>
        <p title={o.customerName ?? undefined} style={{ ...ellipsis, fontWeight: 700, color: "#0f172a" }}>{o.customerName ?? "—"}</p>
        <div style={{ marginTop: "3px", lineHeight: 1 }}>
          <Link href={`/admin/orders/${o.id}`} title="Open order" style={chip}>{o.orderNumber}</Link>
        </div>
      </td>
      <td style={td}>
        <Badge {...status} />
        {o.method && (
          <p style={{ fontSize: "10.5px", color: "#94a3b8", marginTop: "3px", lineHeight: 1.35 }}>
            {METHOD_LABEL[o.method]}{o.paidDay ? ` · paid ${dayLabel(o.paidDay)}` : ""}
          </p>
        )}
      </td>
      <td style={{ ...td, ...num, textAlign: "right", whiteSpace: "nowrap", fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>{formatUSD(o.total)}</td>
      <td style={{ ...td, ...num, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, color: o.collected ? GREEN.color : "#cbd5e1" }}>{o.collected ? formatUSD(o.collected) : "—"}</td>
      <td style={{ ...td, ...num, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, color: o.outstanding ? AMBER.color : "#cbd5e1" }}>{o.outstanding ? formatUSD(o.outstanding) : "—"}</td>
    </tr>
  );
}

// ─── Toolbar pieces ───────────────────────────────────────────────────────────

function NavArrow({ label, disabled, onClick, children }: {
  label: string; disabled: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 32, height: 32, borderRadius: "9px", flexShrink: 0,
        border: "1.5px solid #e2e8f0", background: disabled ? "#f8fafc" : "white",
        color: disabled ? "#cbd5e1" : "#334155",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer", transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.borderColor = "#1a7fba"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
    >
      {children}
    </button>
  );
}

/**
 * Wraps the shared range picker: a multi-day range opens a custom period right
 * away; a single day (one click, then close the picker) opens that day.
 * Re-mounted (via `key`) on every navigation, so it always starts from the URL.
 */
function PeriodPicker({ period, onRange, onDay, onClear }: {
  period:  CashBookPeriod;
  onRange: (from: string, to: string) => void;
  onDay:   (day: string) => void;
  onClear: () => void;
}) {
  const initial: DateRange | undefined = period.view === "custom"
    ? { from: fromLocalISO(period.from), to: fromLocalISO(period.to) }
    : undefined;
  const [range, setRange] = useState<DateRange | undefined>(initial);
  // Read on close — the picker may close in the same tick as the last change.
  const latest = useRef<DateRange | undefined>(initial);

  const handleChange = (r: DateRange | undefined) => {
    latest.current = r;
    setRange(r);
    if (!r) {
      if (period.view === "custom") onClear();
      return;
    }
    if (r.from && r.to && toLocalISO(r.from) !== toLocalISO(r.to)) {
      onRange(toLocalISO(r.from), toLocalISO(r.to));
    }
  };

  const handleOpenChange = (open: boolean) => {
    const r = latest.current;
    if (open || !r?.from) return;
    const from = toLocalISO(r.from);
    if (!r.to || toLocalISO(r.to) === from) onDay(from);
  };

  return (
    <DateRangePicker
      value={range}
      onChange={handleChange}
      onOpenChange={handleOpenChange}
      align="right"
      size="sm"
    />
  );
}

// ─── Summary pieces ───────────────────────────────────────────────────────────

function FlowCard({ label, value, valueColor, note, rows, icon: Icon, tone }: {
  label: string; value: string; valueColor?: string;
  /** Plain explanation under the value… */
  note?: string;
  /** …or a small breakdown pinned to the bottom of the card. */
  rows?: { label: string; value: number }[];
  icon: React.ElementType; tone: { color: string; bg: string; border: string };
}) {
  return (
    <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
        <div style={{ width: 30, height: 30, borderRadius: "9px", background: tone.bg, border: `1.5px solid ${tone.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={14} style={{ color: tone.color }} />
        </div>
        <p style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155" }}>{label}</p>
      </div>
      <p style={{ ...num, fontWeight: 800, fontSize: "22px", color: valueColor ?? "#0f172a", letterSpacing: "-0.02em", lineHeight: 1, marginTop: "14px" }}>
        {value}
      </p>
      {note && (
        <p style={{ fontSize: "10.5px", color: "#94a3b8", marginTop: "7px", lineHeight: 1.45 }}>{note}</p>
      )}
      {rows && (
        <div style={{ marginTop: "auto", paddingTop: "12px" }}>
          <div style={{ borderTop: "1px dashed #e2e8f0", paddingTop: "9px", display: "flex", flexDirection: "column", gap: "5px" }}>
            {rows.map((r) => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
                <span style={{ fontSize: "10.5px", lineHeight: 1.3, color: "#64748b", minWidth: 0 }}>{r.label}</span>
                <span style={{ ...num, fontSize: "11px", fontWeight: 700, color: r.value ? "#334155" : "#cbd5e1", flexShrink: 0 }}>
                  {formatUSD(r.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Operator({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", background: "white", border: "1.5px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 800, color: "#94a3b8", lineHeight: 1 }}>
        {children}
      </span>
    </div>
  );
}

/** Type the cash you counted; see at once whether the drawer is short or over. */
function CountCheck({ expected }: { expected: number }) {
  const inputId = useId();
  const [counted, setCounted] = useState("");
  const value = parseFloat(counted);
  const diff  = counted.trim() !== "" && Number.isFinite(value)
    ? Math.round((value - expected) * 100) / 100
    : null;

  const status =
    diff === null ? null
    : diff === 0  ? { text: "Matches — drawer is balanced", color: "#86efac", bg: "rgba(34,197,94,0.14)", border: "rgba(134,239,172,0.35)", Icon: CheckCircle2 }
    : diff < 0    ? { text: `Short by ${formatUSD(-diff)}`,   color: "#fda4af", bg: "rgba(244,63,94,0.14)", border: "rgba(253,164,175,0.35)", Icon: AlertTriangle }
    :               { text: `Over by ${formatUSD(diff)}`,     color: "#fcd34d", bg: "rgba(245,158,11,0.14)", border: "rgba(252,211,77,0.35)", Icon: AlertTriangle };

  return (
    <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
      <label htmlFor={inputId} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "9.5px", fontWeight: 800, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        <Calculator size={11} /> Counted in drawer
      </label>
      <div style={{ position: "relative", marginTop: "7px" }}>
        <span style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.45)" }}>$</span>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={counted}
          onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ""))}
          style={{
            ...num, width: "100%", boxSizing: "border-box",
            padding: "8px 10px 8px 23px", borderRadius: "8px",
            border: "1.5px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)",
            color: "white", fontSize: "14px", fontWeight: 700, outline: "none",
          }}
        />
      </div>
      {status && (
        <p style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", padding: "6px 9px", borderRadius: "7px", background: status.bg, border: `1px solid ${status.border}`, fontSize: "11px", fontWeight: 800, color: status.color }}>
          <status.Icon size={12} /> {status.text}
        </p>
      )}
    </div>
  );
}

// ─── Day-by-day table ─────────────────────────────────────────────────────────

function DayTable({ days, book, onOpenDay }: {
  days: CashBookDay[]; book: CashBook; onOpenDay: (day: string) => void;
}) {
  const totalPayments = days.reduce((s, d) => s + d.payments, 0);
  return (
    <section style={{ ...card, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
        <div>
          <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "14px", color: "#0f172a" }}>Day by day</p>
          <p style={{ fontSize: "10.5px", color: "#94a3b8", marginTop: "1px" }}>Click a day to see its transactions</p>
        </div>
        <p style={{ fontSize: "11px", color: "#94a3b8" }}>{plural(days.length, "day")}</p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Day</th>
              <th style={{ ...th, textAlign: "right" }}>Payments</th>
              <th style={{ ...th, textAlign: "right" }}>Opening</th>
              <th style={{ ...th, textAlign: "right" }}>Cash in</th>
              <th style={{ ...th, textAlign: "right" }}>Cash out</th>
              <th style={{ ...th, textAlign: "right" }}>Net</th>
              <th style={{ ...th, textAlign: "right" }}>Closing</th>
            </tr>
          </thead>
          <tbody>
            {days.length === 0 ? (
              <EmptyRow colSpan={7} text="No transactions in this range." />
            ) : days.map((d) => {
              const quiet = d.entries === 0;
              const dayNet = d.cashIn - d.cashOut;
              return (
                <tr
                  key={d.day}
                  role="link"
                  tabIndex={0}
                  onClick={() => onOpenDay(d.day)}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpenDay(d.day); }}
                  style={{ cursor: "pointer", transition: "background 0.1s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f4faff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <td style={{ ...td, fontWeight: 700, color: quiet ? "#94a3b8" : "#0f172a", whiteSpace: "nowrap" }}>
                    {dayLabel(d.day)}
                    {quiet && <span style={{ marginLeft: "8px", fontSize: "10px", fontWeight: 600, color: "#cbd5e1" }}>no transactions</span>}
                  </td>
                  <td style={{ ...td, ...num, textAlign: "right", color: quiet ? "#cbd5e1" : "#475569" }}>{quiet ? "—" : d.payments}</td>
                  <td style={{ ...td, ...num, textAlign: "right", color: "#94a3b8" }}>{formatUSD(d.opening)}</td>
                  <td style={{ ...td, ...num, textAlign: "right", fontWeight: 700, color: d.cashIn ? GREEN.color : "#cbd5e1" }}>{d.cashIn ? formatUSD(d.cashIn) : "—"}</td>
                  <td style={{ ...td, ...num, textAlign: "right", fontWeight: 700, color: d.cashOut ? ROSE.color : "#cbd5e1" }}>{d.cashOut ? formatUSD(d.cashOut) : "—"}</td>
                  <td style={{ ...td, ...num, textAlign: "right", fontWeight: 700, color: quiet ? "#cbd5e1" : dayNet >= 0 ? "#0f172a" : ROSE.color }}>{quiet ? "—" : signed(dayNet)}</td>
                  <td style={{ ...td, ...num, textAlign: "right", fontWeight: 800, color: "#0f172a" }}>{formatUSD(d.closing)}</td>
                </tr>
              );
            })}
          </tbody>
          {days.length > 0 && (
            <tfoot>
              <tr style={{ background: "#f8fafc" }}>
                <td style={{ ...td, borderBottom: "none", fontSize: "10.5px", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontWeight: 800 }}>{totalPayments}</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", color: "#94a3b8" }}>{formatUSD(book.openingBalance)}</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontWeight: 800, color: GREEN.color }}>{formatUSD(book.cashIn)}</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontWeight: 800, color: ROSE.color }}>{formatUSD(book.cashOut)}</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontWeight: 800 }}>{signed(book.cashIn - book.cashOut)}</td>
                <td style={{ ...td, ...num, borderBottom: "none", textAlign: "right", fontWeight: 800 }}>{formatUSD(book.closingBalance)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

// ─── Income / outcome tables ──────────────────────────────────────────────────

function TableTitle({ icon: Icon, tone, title, sub, total }: {
  icon: React.ElementType; tone: { color: string; bg: string; border: string };
  title: string; sub: string; total: string;
}) {
  return (
    <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "11px", minWidth: 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: "10px", background: tone.bg, border: `1.5px solid ${tone.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={16} style={{ color: tone.color }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: "14px", color: "#0f172a" }}>{title}</p>
          <p style={{ fontSize: "10.5px", color: "#94a3b8", marginTop: "1px" }}>{sub}</p>
        </div>
      </div>
      <p style={{ ...num, fontWeight: 800, fontSize: "18px", color: tone.color, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{total}</p>
    </div>
  );
}

function TimeCell({ e, multiDay }: { e: CashBookEntry; multiDay: boolean }) {
  return (
    <td style={{ ...td, whiteSpace: "nowrap" }}>
      {multiDay && <p style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8" }}>{dayLabel(e.day)}</p>}
      <p style={{ ...num, fontSize: "12px", fontWeight: 700, color: "#475569" }}>{timeOf(e.createdAt)}</p>
    </td>
  );
}

function OrderChip({ e }: { e: CashBookEntry }) {
  if (!e.orderNumber) return null;
  const style: React.CSSProperties = {
    display: "inline-block", maxWidth: "100%", padding: "1px 7px", borderRadius: "6px",
    fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: "10.5px", fontWeight: 700,
    textDecoration: "none", verticalAlign: "middle", ...ellipsis,
  };
  return e.orderId ? (
    <Link href={`/admin/orders/${e.orderId}`} title="Open order" style={{ ...style, color: "#0f5a85", background: "#edf7fd", border: "1px solid #b6def5" }}>
      {e.orderNumber}
    </Link>
  ) : (
    <span title="This order was deleted" style={{ ...style, color: "#94a3b8", background: "#f8fafc", border: "1px dashed #e2e8f0" }}>
      {e.orderNumber}
    </span>
  );
}

function Badge({ label, color, bg, border, title }: {
  label: string; color: string; bg: string; border: string; title?: string;
}) {
  return (
    <span title={title} style={{ display: "inline-block", maxWidth: "100%", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 800, color, background: bg, border: `1px solid ${border}`, verticalAlign: "middle", ...ellipsis }}>
      {label}
    </span>
  );
}

function CategoryChip({ e }: { e: CashBookEntry }) {
  return (
    <span title={e.categoryLabel} style={{ display: "inline-flex", alignItems: "center", gap: "5px", maxWidth: "100%", fontSize: "10px", fontWeight: 700, color: e.categoryColor, background: `${e.categoryColor}18`, border: `1px solid ${e.categoryColor}40`, padding: "2px 8px", borderRadius: "999px", verticalAlign: "middle" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: e.categoryColor, flexShrink: 0 }} />
      <span style={ellipsis}>{e.categoryLabel}</span>
    </span>
  );
}

function TypeBadge({ e }: { e: CashBookEntry }) {
  switch (e.paymentType) {
    case "full":    return <Badge label="Full" color="#15803d" bg="#f0fdf4" border="#86efac" title="Order paid in full" />;
    case "dp":      return <Badge label="DP"   color="#b45309" bg="#fffbeb" border="#fcd34d" title="Down payment — the order still has a balance due" />;
    case "balance": return <Badge label="Final" color="#0f5a85" bg="#edf7fd" border="#b6def5" title="Remaining balance after an earlier payment" />;
  }
  if (e.kind === "adjustment") return <Badge label="Adjustment" color="#0e7490" bg="#ecfeff" border="#a5f3fc" />;
  if (e.kind === "opening")    return <Badge label="Opening"    color="#475569" bg="#f8fafc" border="#e2e8f0" />;
  return <CategoryChip e={e} />;
}

function IncomeRow({ e, multiDay }: { e: CashBookEntry; multiDay: boolean }) {
  const isPayment = e.kind === "payment";
  return (
    <tr>
      <TimeCell e={e} multiDay={multiDay} />
      <td style={td}>
        {isPayment ? (
          <>
            {e.customerName
              ? <p title={e.customerName} style={{ ...ellipsis, fontWeight: 700, color: "#0f172a" }}>{e.customerName}</p>
              : <p style={{ fontStyle: "italic", color: "#94a3b8" }}>Deleted order</p>}
            <div style={{ marginTop: "3px", lineHeight: 1 }}><OrderChip e={e} /></div>
          </>
        ) : (
          <p title={e.description} style={{ ...ellipsis, color: "#334155" }}>{e.description}</p>
        )}
      </td>
      <td style={td}><TypeBadge e={e} /></td>
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
        <p style={{ ...num, fontSize: "13px", fontWeight: 800, color: GREEN.color }}>+{formatUSD(e.amount)}</p>
        {e.tendered !== null && e.change !== null && (
          <p
            title={`Customer handed over ${formatUSD(e.tendered)} and got ${formatUSD(e.change)} back`}
            style={{ ...num, fontSize: "10px", lineHeight: 1.35, color: "#94a3b8", marginTop: "2px" }}
          >
            paid {formatUSD(e.tendered)}<br />change {formatUSD(e.change)}
          </p>
        )}
      </td>
    </tr>
  );
}

function OutcomeRow({ e, multiDay }: { e: CashBookEntry; multiDay: boolean }) {
  return (
    <tr>
      <TimeCell e={e} multiDay={multiDay} />
      <td style={td}>
        {e.kind === "change" ? (
          <>
            <p style={{ ...ellipsis, color: "#334155" }}>
              Change given{e.customerName && <> · <span style={{ fontWeight: 700, color: "#0f172a" }}>{e.customerName}</span></>}
            </p>
            <div style={{ marginTop: "4px", lineHeight: 1 }}><OrderChip e={e} /></div>
          </>
        ) : (
          <>
            <p title={e.description} style={{ ...ellipsis, fontWeight: 600, color: "#0f172a" }}>{e.description}</p>
            <div style={{ marginTop: "4px", lineHeight: 1 }}>
              {e.kind === "adjustment"
                ? <Badge label="Adjustment" color="#0e7490" bg="#ecfeff" border="#a5f3fc" />
                : <CategoryChip e={e} />}
            </div>
          </>
        )}
      </td>
      <td style={{ ...td, ...num, textAlign: "right", whiteSpace: "nowrap", fontSize: "13px", fontWeight: 800, color: ROSE.color }}>
        −{formatUSD(e.amount)}
      </td>
    </tr>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: "40px 16px", textAlign: "center" }}>
        <Inbox size={22} style={{ color: "#cbd5e1", margin: "0 auto 8px" }} />
        <p style={{ fontSize: "12.5px", fontWeight: 600, color: "#94a3b8" }}>{text}</p>
      </td>
    </tr>
  );
}

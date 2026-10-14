// components/employee/CashRegisterClient.tsx
// Employee cash register: the live drawer balance with today's balance trail,
// today's money in / out, and every recent movement grouped by day. Staff can
// add expenses (admin-managed categories); balance adjustments stay admin-only
// (components/admin/CashRegisterAdmin.tsx).
"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type LucideIcon, Activity, ArrowDownLeft, ArrowUpRight, CheckCircle2, Coins, Lock, Plus, Receipt,
  RefreshCw, SlidersHorizontal, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { formatUSD } from "@/lib/utils/order-form";
import {
  formatBiz, formatDateTimeBiz, formatDayLabelBiz, isoDayBiz, timeAgoShort,
} from "@/lib/utils/business-time";
import { AutoRefresh } from "@/components/employee/AutoRefresh";
import { ExpenseModal } from "@/components/employee/ExpenseModal";
import type { CashDrawerToday, CashRegisterState } from "@/lib/actions/payments";
import type { ExpenseCategory } from "@/lib/db/schema";

type Tx     = CashRegisterState["recentTransactions"][number];
type Filter = "all" | "in" | "out";
type Tone   = "emerald" | "amber" | "teal" | "rose" | "slate";

const TONES: Record<Tone, { chip: string; amount: string; dot: string }> = {
  emerald: { chip: "bg-emerald-50 text-emerald-600 ring-emerald-100", amount: "text-emerald-600", dot: "bg-emerald-500" },
  amber:   { chip: "bg-amber-50 text-amber-600 ring-amber-100",       amount: "text-amber-600",   dot: "bg-amber-400"   },
  teal:    { chip: "bg-teal-50 text-teal-600 ring-teal-100",          amount: "text-teal-600",    dot: "bg-teal-500"    },
  rose:    { chip: "bg-rose-50 text-rose-600 ring-rose-100",          amount: "text-rose-600",    dot: "bg-rose-500"    },
  slate:   { chip: "bg-slate-100 text-slate-500 ring-slate-200",      amount: "text-slate-700",   dot: "bg-slate-400"   },
};

const KINDS: Record<string, { label: string; summary: string; icon: LucideIcon; tone: Tone }> = {
  payment_in:        { label: "Payment",    summary: "Payments received", icon: ArrowDownLeft,     tone: "emerald" },
  change_out:        { label: "Change",     summary: "Change given",      icon: Coins,             tone: "amber"   },
  manual_income:     { label: "Income",     summary: "Other income",      icon: Plus,              tone: "teal"    },
  manual_outcome:    { label: "Expense",    summary: "Expenses",          icon: Receipt,           tone: "rose"    },
  manual_adjustment: { label: "Adjustment", summary: "Adjustments",       icon: SlidersHorizontal, tone: "slate"   },
  initial:           { label: "Opening",    summary: "Opening balance",   icon: Wallet,            tone: "slate"   },
};

/** "+$8.00" / "−$4.75" — and a plain "$0.00" when nothing moved. */
function signedUSD(n: number): string {
  if (n === 0) return formatUSD(0);
  return `${n > 0 ? "+" : "−"}${formatUSD(Math.abs(n))}`;
}

function kindOf(type: string, direction: "income" | "outcome") {
  return KINDS[type] ?? (direction === "income"
    ? { label: "Money in",  summary: "Money in",  icon: ArrowDownLeft, tone: "emerald" as Tone }
    : { label: "Money out", summary: "Money out", icon: ArrowUpRight,  tone: "rose"    as Tone });
}

/** Animates a number from its previous value to the new one (shown as-is on first render). */
function useCountUp(value: number, duration = 700): number {
  const [display, setDisplay] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start  = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const p = reduce ? 1 : Math.min(1, (now - start) / duration);
      shownRef.current = p === 1 ? value : from + (value - from) * (1 - Math.pow(1 - p, 3));
      setDisplay(shownRef.current);
      if (p < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return display;
}

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  state: CashRegisterState;
  today: CashDrawerToday;
  /** Server render time (ISO) — for "Today / 5m ago" labels. */
  now:   string;
  /** Admin-managed categories staff can file an expense under. */
  categories: ExpenseCategory[];
}

export function CashRegisterClient({ state, today, now, categories }: Props) {
  const router  = useRouter();
  const nowDate = new Date(now);
  const [isRefreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [addingExpense, setAddingExpense] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const { balance, lastUpdatedAt, recentTransactions } = state;
  const opening = today.openingBalance ?? balance;
  const net     = Math.round((today.moneyIn - today.moneyOut) * 100) / 100;
  const shown   = useCountUp(balance);
  const updatedAgo = timeAgoShort(lastUpdatedAt, nowDate);

  const trail = [opening, ...today.balanceTrail.map((p) => p.balance)];
  if (trail.length === 1) trail.push(balance);

  const visible = recentTransactions.filter((tx) =>
    filter === "all" ? true : filter === "in" ? tx.direction === "income" : tx.direction === "outcome",
  );
  const groups: { day: string; txs: Tx[]; moneyIn: number; moneyOut: number }[] = [];
  for (const tx of visible) {
    const day  = isoDayBiz(new Date(tx.createdAt));
    let group  = groups.at(-1);
    if (!group || group.day !== day) {
      group = { day, txs: [], moneyIn: 0, moneyOut: 0 };
      groups.push(group);
    }
    group.txs.push(tx);
    if (tx.direction === "income") group.moneyIn += parseFloat(tx.amount);
    else group.moneyOut += parseFloat(tx.amount);
  }

  const totalFlow = today.moneyIn + today.moneyOut;

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={60} />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] md:text-[30px] font-extrabold tracking-tight text-slate-900">Cash Register</h1>
          <p className="mt-0.5 text-sm font-semibold text-slate-500">Live drawer balance and every cash movement</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAddingExpense(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-rose-600 px-4 text-[13px] font-extrabold text-white shadow-md shadow-rose-600/20 transition hover:bg-rose-700 active:scale-95"
          >
            <Plus size={15} strokeWidth={3} /> Add expense
          </button>
          <button
            type="button"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={isRefreshing}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 disabled:opacity-70"
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-[13px] font-bold text-emerald-700 ring-1 ring-emerald-100">
          <CheckCircle2 size={16} className="shrink-0" /> {notice}
        </p>
      )}

      <div className="grid items-start gap-5 min-[900px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ── Left: balance + today ────────────────────────────────────
            Stays in view beside the long transaction list — only on screens
            tall enough to show all of it (a taller sticky column would hide
            its own bottom). */}
        <div className="space-y-4 [@media(min-width:900px)_and_(min-height:700px)]:sticky [@media(min-width:900px)_and_(min-height:700px)]:top-6">
          <section className="akiro-wallet-card relative overflow-hidden rounded-[28px] p-5 md:p-6 text-white">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-white/70">
                <Wallet size={15} /> Cash in drawer
              </span>
              <span className="flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold ring-1 ring-white/15">
                <span className="akiro-dot" /> Live
              </span>
            </div>
            <p className="mt-4 font-display text-[42px] md:text-[48px] font-extrabold leading-none tracking-tight tabular-nums">
              {formatUSD(shown)}
            </p>
            <p className="mt-2 text-[13px] font-semibold text-white/60">
              Updated {updatedAgo === "just now" ? "just now" : `${updatedAgo} ago`} · {formatDateTimeBiz(lastUpdatedAt)}
            </p>
            <div className="mt-5">
              <BalanceTrail points={trail} />
              <div className="mt-1.5 flex justify-between text-[11px] font-bold text-white/55">
                <span>Opened {formatUSD(opening)}</span>
                <span>
                  {today.count === 0 ? "No movement yet today" : `${today.count} movement${today.count === 1 ? "" : "s"} today`}
                </span>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-3 gap-3">
            <StatTile icon={TrendingUp}   tone="emerald" label="Money in"  value={signedUSD(today.moneyIn)} />
            <StatTile icon={TrendingDown} tone="rose"    label="Money out" value={signedUSD(-today.moneyOut)} />
            <StatTile icon={Activity}     tone={net < 0 ? "rose" : "teal"} label="Net today" value={signedUSD(net)} />
          </div>

          <section className="rounded-[24px] bg-white p-4 md:p-5 ring-1 ring-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[15px] font-extrabold text-slate-900">Today&apos;s cash flow</h2>
              <span className="text-xs font-bold text-slate-400">{formatDayLabelBiz(isoDayBiz(nowDate), nowDate)}</span>
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              {totalFlow > 0 && (
                <>
                  <div className="h-full bg-emerald-400" style={{ width: `${(today.moneyIn / totalFlow) * 100}%` }} />
                  <div className="h-full bg-rose-400" style={{ width: `${(today.moneyOut / totalFlow) * 100}%` }} />
                </>
              )}
            </div>
            {today.byType.length === 0 ? (
              <p className="mt-3 text-[13px] font-semibold text-slate-400">
                Nothing in or out of the drawer yet today.
              </p>
            ) : (
              <ul className="mt-3.5 space-y-2.5">
                {today.byType.map((t) => {
                  const kind = kindOf(t.type, t.direction);
                  return (
                    <li key={`${t.type}:${t.direction}`} className="flex items-center gap-2.5 text-[13px]">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONES[kind.tone].dot}`} />
                      <span className="flex-1 font-semibold text-slate-600">
                        {kind.summary} <span className="text-slate-400">· {t.count}</span>
                      </span>
                      <span className={`font-display font-extrabold tabular-nums ${t.direction === "income" ? "text-emerald-600" : "text-rose-600"}`}>
                        {t.direction === "income" ? "+" : "−"}{formatUSD(t.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p className="flex items-center gap-2 px-1 text-xs font-semibold text-slate-400">
            <Lock size={12} className="shrink-0" />
            Balance adjustments are made by admins only.
          </p>
        </div>

        {/* ── Right: transactions ──────────────────────────────────── */}
        <section className="overflow-clip rounded-[28px] bg-white ring-1 ring-slate-200/80 shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
            <div>
              <h2 className="font-display text-lg font-extrabold text-slate-900">Transactions</h2>
              <p className="text-xs font-semibold text-slate-400">Latest {recentTransactions.length} movements</p>
            </div>
            <div className="inline-flex rounded-2xl bg-slate-100 p-1" role="group" aria-label="Filter transactions">
              {([
                { value: "all", label: "All"       },
                { value: "in",  label: "Money in"  },
                { value: "out", label: "Money out" },
              ] as const).map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  aria-pressed={filter === f.value}
                  className={`h-9 rounded-xl px-3.5 text-[13px] font-bold transition-colors ${
                    filter === f.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </header>

          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 pb-14 pt-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-400">
                <Receipt size={24} />
              </span>
              <p className="font-display text-sm font-extrabold text-slate-700">No transactions here yet</p>
              <p className="text-xs font-semibold text-slate-400">Cash payments, change and expenses will show up here.</p>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.day}>
                <div className="sticky top-14 z-10 flex items-center justify-between gap-3 border-y border-slate-100 bg-slate-50/95 px-5 py-2 backdrop-blur md:top-0">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                    {formatDayLabelBiz(g.day, nowDate)}
                  </span>
                  <span className="flex gap-3 text-[12px] font-extrabold tabular-nums">
                    {g.moneyIn > 0 && <span className="text-emerald-600">+{formatUSD(g.moneyIn)}</span>}
                    {g.moneyOut > 0 && <span className="text-rose-600">−{formatUSD(g.moneyOut)}</span>}
                  </span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {g.txs.map((tx) => <TxRow key={tx.id} tx={tx} />)}
                </ul>
              </div>
            ))
          )}
        </section>
      </div>

      {addingExpense && (
        <ExpenseModal
          categories={categories}
          balance={balance}
          onClose={() => setAddingExpense(false)}
          onSaved={(message) => {
            setAddingExpense(false);
            setNotice(message);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function StatTile({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: Tone; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[22px] bg-white p-3.5 ring-1 ring-slate-200/80 shadow-sm">
      <p className="flex items-center gap-1.5 text-[10.5px] font-black uppercase tracking-wider text-slate-400">
        <span className={`hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg ring-1 sm:flex ${TONES[tone].chip}`}>
          <Icon size={13} strokeWidth={2.5} />
        </span>
        <span className="truncate">{label}</span>
      </p>
      <p className={`mt-2 truncate font-display text-[18px] font-extrabold tabular-nums ${TONES[tone].amount}`}>{value}</p>
    </div>
  );
}

function TxRow({ tx }: { tx: Tx }) {
  const income = tx.direction === "income";
  const kind   = kindOf(tx.type, tx.direction);
  const tone   = TONES[kind.tone];
  const Icon   = kind.icon;
  return (
    <li className="flex items-center gap-3.5 px-5 py-3.5">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ${tone.chip}`}>
        <Icon size={19} strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold leading-snug text-slate-800 [overflow-wrap:anywhere]">{tx.displayDescription}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-slate-400">
          <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide ring-1 ${tone.chip}`}>
            {kind.label}
          </span>
          {tx.categoryName && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-500">{tx.categoryName}</span>
          )}
          <span>{formatBiz(new Date(tx.createdAt), { hour: "numeric", minute: "2-digit" })}</span>
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`font-display text-[15px] font-extrabold tabular-nums ${
          income ? "text-emerald-600" : kind.tone === "amber" ? "text-amber-600" : "text-rose-600"
        }`}>
          {income ? "+" : "−"}{formatUSD(parseFloat(tx.amount))}
        </p>
        <p className="text-[11px] font-semibold text-slate-400 tabular-nums">bal {formatUSD(parseFloat(tx.balanceAfter))}</p>
      </div>
    </li>
  );
}

/** Drawer balance through today (opening → after each movement) as a soft area line. */
function BalanceTrail({ points }: { points: number[] }) {
  const gradientId = useId();
  const W = 320;
  const H = 64;
  const min  = Math.min(...points);
  const max  = Math.max(...points);
  const span = max - min || 1;
  const xs = points.map((_, i) => (i * W) / Math.max(1, points.length - 1));
  // Flat when nothing moved — sit the line two thirds down.
  const ys = points.map((v) => (max === min ? H * 0.66 : 6 + (1 - (v - min) / span) * (H - 12)));
  const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const lastX = xs[xs.length - 1];
  const lastY = ys[ys.length - 1];

  return (
    <div className="relative h-16">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#7dd3fc" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line} fill="none" stroke="#bae6fd" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
          strokeDasharray={max === min ? "6 6" : undefined}
        />
      </svg>
      <span
        aria-hidden
        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-4 ring-sky-300/40"
        style={{ left: `${(lastX / W) * 100}%`, top: `${(lastY / H) * 100}%` }}
      />
    </div>
  );
}

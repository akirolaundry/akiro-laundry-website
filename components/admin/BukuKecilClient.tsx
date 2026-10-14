// components/admin/BukuKecilClient.tsx
"use client";
//
// Buku Kecil: the cash book as an analysable transaction table. This shell owns
// the period selection and the headline figures; the table itself (sorting,
// per-column filters, insights, detail drawer) lives in buku-kecil/LedgerTable.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  Download, NotebookPen, Plus, RefreshCw, Receipt, Scale, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { getFinanceExportBundle } from "@/lib/actions/finance";
import type { LedgerEntry } from "@/lib/actions/finance";
import { formatUSD } from "@/lib/utils/order-form";
import { FINANCE_PERIODS, addDaysISO, isoDayBiz, type FinancePeriod } from "@/lib/utils/business-time";
import { ExportModal, type ExportDateRange } from "@/components/admin/ExportModal";
import { DateRangePicker } from "@/components/admin/DateRangePicker";
import { exportFinanceWorkbook } from "@/lib/utils/export-xlsx";
import { LedgerTable } from "@/components/admin/buku-kecil/LedgerTable";
import { RecordTransactionModal } from "@/components/admin/buku-kecil/RecordTransactionModal";
import type { ExpenseCategory } from "@/lib/db/schema";

interface Props {
  balance:       number;
  lastUpdatedAt: Date | string;
  categories:    ExpenseCategory[];
  ledger:        LedgerEntry[];
  period:        FinancePeriod | "custom";
  range:         { from: string; to: string; label: string };
}

const localISO = (d: Date) => format(d, "yyyy-MM-dd");
const fromISO  = (iso: string) => new Date(`${iso}T00:00:00`);

export function BukuKecilClient({ balance, lastUpdatedAt, categories, ledger, period, range }: Props) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const [showExport, setShowExport] = useState(false);
  const [recording,  setRecording]  = useState(false);

  const totals = useMemo(() => {
    const cashIn  = ledger.reduce((s, e) => s + e.credit, 0);
    const cashOut = ledger.reduce((s, e) => s + e.debit, 0);
    const orders  = new Set(ledger.map((e) => e.orderNumber).filter(Boolean)).size;
    return { cashIn, cashOut, net: cashIn - cashOut, orders };
  }, [ledger]);

  const go = (qs: string) => startNav(() => router.push(`/admin/buku-kecil?${qs}`, { scroll: false }));

  // Quick ranges, resolved in the shop's timezone.
  const today = isoDayBiz(new Date());
  const QUICK = [
    { label: "Today",        from: today,                  to: today },
    { label: "Yesterday",    from: addDaysISO(today, -1),  to: addDaysISO(today, -1) },
    { label: "Last 7 days",  from: addDaysISO(today, -6),  to: today },
    { label: "Last 30 days", from: addDaysISO(today, -29), to: today },
  ];
  const quickActive = (q: { from: string; to: string }) => period === "custom" && range.from === q.from && range.to === q.to;
  const customActive = period === "custom" && !QUICK.some(quickActive);

  const pickRange = (r: DateRange | undefined) => {
    if (r?.from && r?.to) go(`from=${localISO(r.from)}&to=${localISO(r.to)}`);
  };

  const handleExport = async ({ from, to }: ExportDateRange) => {
    const bundle = await getFinanceExportBundle(from, to);
    if (bundle.ledger.length === 0) throw new Error("No transactions in the selected range.");
    exportFinanceWorkbook(
      { from, to, ledger: bundle.ledger, recap: bundle.recap, pies: bundle.pies },
      `buku_kecil_${from.replace(/-/g, "")}_${to.replace(/-/g, "")}`,
    );
  };

  const pill = (active: boolean) =>
    `h-8 rounded-full px-3.5 text-[12px] font-bold ring-1 transition active:scale-95 ${active
      ? "bg-sky-50 text-sky-700 ring-sky-300"
      : "bg-white text-slate-500 ring-slate-200 hover:text-slate-800 hover:ring-slate-300"}`;

  return (
    <>
      {showExport && <ExportModal title="Export Buku Kecil" onClose={() => setShowExport(false)} onExport={handleExport} />}
      {recording && (
        <RecordTransactionModal
          categories={categories} balance={balance}
          onClose={() => setRecording(false)} onRecorded={() => router.refresh()}
        />
      )}

      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 font-display text-[26px] font-extrabold tracking-tight text-slate-900">
              <NotebookPen size={22} className="text-sky-600" /> Buku Kecil
            </h1>
            <p className="mt-1 text-[13px] font-semibold text-slate-400">
              Every cash movement · {range.label} · updated {new Date(lastUpdatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button" onClick={() => startNav(() => router.refresh())}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-white px-3.5 text-[13px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 active:scale-95"
            >
              <RefreshCw size={14} className={navPending ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              type="button" onClick={() => setShowExport(true)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-50 px-3.5 text-[13px] font-extrabold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 active:scale-95"
            >
              <Download size={14} /> Finance Excel
            </button>
            <button
              type="button" onClick={() => setRecording(true)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-[13px] font-extrabold text-white shadow-md shadow-sky-600/25 hover:bg-sky-700 active:scale-95"
            >
              <Plus size={15} strokeWidth={3} /> Record transaction
            </button>
          </div>
        </div>

        {/* Period */}
        <div className={`flex flex-wrap items-center gap-2 ${navPending ? "opacity-60" : ""}`}>
          {FINANCE_PERIODS.map((p) => (
            <button key={p.value} type="button" onClick={() => go(`period=${p.value}`)} className={pill(p.value === period)}>{p.label}</button>
          ))}
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          {QUICK.map((q) => (
            <button key={q.label} type="button" onClick={() => go(`from=${q.from}&to=${q.to}`)} className={pill(quickActive(q))}>{q.label}</button>
          ))}
          <div className={customActive ? "rounded-xl ring-2 ring-sky-300" : ""}>
            <DateRangePicker
              key={`${range.from}:${range.to}`}
              value={period === "custom" ? { from: fromISO(range.from), to: fromISO(range.to) } : undefined}
              onChange={pickRange}
              align="left" size="sm"
            />
          </div>
        </div>

        {/* Headline figures for the period */}
        <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-5">
          <div className="col-span-2 flex items-center gap-4 rounded-2xl bg-gradient-to-br from-[#0c1e35] via-[#0f3460] to-[#1a5276] p-5 text-white shadow-lg shadow-slate-900/15 min-[900px]:col-span-1">
            <Wallet size={22} className="shrink-0 text-white/50" />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/50">Drawer balance</p>
              <p className="mt-1 truncate font-display text-[26px] font-extrabold leading-none tracking-tight tabular-nums">{formatUSD(balance)}</p>
            </div>
          </div>
          {[
            { label: "Cash in",  value: formatUSD(totals.cashIn),  Icon: TrendingUp,   tone: "text-emerald-600", chip: "bg-emerald-50 text-emerald-600 ring-emerald-100" },
            { label: "Cash out", value: formatUSD(totals.cashOut), Icon: TrendingDown, tone: "text-rose-600",    chip: "bg-rose-50 text-rose-600 ring-rose-100" },
            { label: "Net flow", value: formatUSD(totals.net),     Icon: Scale,        tone: totals.net < 0 ? "text-rose-600" : "text-slate-900", chip: "bg-sky-50 text-sky-600 ring-sky-100" },
            { label: "Entries",  value: `${ledger.length.toLocaleString()}`, sub: `${totals.orders} order${totals.orders === 1 ? "" : "s"}`, Icon: Receipt, tone: "text-slate-900", chip: "bg-slate-100 text-slate-500 ring-slate-200" },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
              <p className="flex items-center gap-2 text-[10.5px] font-black uppercase tracking-wider text-slate-400">
                <span className={`flex h-6 w-6 items-center justify-center rounded-lg ring-1 ${c.chip}`}><c.Icon size={13} strokeWidth={2.5} /></span>
                {c.label}
              </p>
              <p className={`mt-2.5 truncate font-display text-[20px] font-extrabold tracking-tight tabular-nums ${c.tone}`}>
                {c.value}
                {"sub" in c && c.sub && <span className="ml-2 text-[12px] font-semibold text-slate-400">{c.sub}</span>}
              </p>
            </div>
          ))}
        </div>

        <div className={navPending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <LedgerTable entries={ledger} />
        </div>
      </div>
    </>
  );
}

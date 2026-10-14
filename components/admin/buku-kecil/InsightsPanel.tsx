// components/admin/buku-kecil/InsightsPanel.tsx
"use client";
//
// Analysis over whatever the table is currently showing: a cash in / out trend
// and a group-by breakdown. Clicking a breakdown row narrows the table to it.

import { useMemo, useState } from "react";
import { formatUSD } from "@/lib/utils/order-form";
import {
  GROUP_OPTIONS, groupRows, trendBuckets,
  type GroupBy, type GroupRow, type LedgerRow,
} from "@/lib/utils/ledger-table";

/** Group-bys whose rows can narrow the table when clicked. */
const CLICKABLE: GroupBy[] = ["category", "kind", "customer", "order", "day", "month"];

const money = (n: number) => formatUSD(n);

export function InsightsPanel({ rows, onPick }: {
  rows:   LedgerRow[];
  onPick: (by: GroupBy, group: GroupRow) => void;
}) {
  const [by, setBy] = useState<GroupBy>("category");
  const [hover, setHover] = useState<number | null>(null);

  const { unit, buckets } = useMemo(() => trendBuckets(rows), [rows]);
  const groups = useMemo(() => groupRows(rows, by), [rows, by]);

  const peak   = Math.max(1, ...buckets.map((b) => Math.max(b.cashIn, b.cashOut)));
  const volume = Math.max(1, ...groups.map((g) => Math.max(g.cashIn, g.cashOut)));
  const hovered = hover !== null ? buckets[hover] : null;
  const labelEvery = Math.ceil(buckets.length / 10);
  const clickable = CLICKABLE.includes(by);
  const shownGroups = groups.slice(0, by === "day" || by === "month" ? 40 : 12);

  if (rows.length === 0) {
    return <p className="px-5 py-10 text-center text-[13px] font-semibold text-slate-400">Nothing to analyse — no entries match the current view.</p>;
  }

  return (
    <div className="grid gap-px bg-slate-100 min-[1100px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Trend */}
      <div className="bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-[13px] font-extrabold text-slate-900">
            {unit === "day" ? "Daily" : "Monthly"} cash flow
          </h3>
          <p className="min-h-4 text-[11.5px] font-bold tabular-nums text-slate-500">
            {hovered ? (
              <>
                {hovered.label} ·{" "}
                <span className="text-emerald-600">in {money(hovered.cashIn)}</span> ·{" "}
                <span className="text-rose-600">out {money(hovered.cashOut)}</span>
              </>
            ) : (
              <span className="flex items-center gap-3 font-semibold text-slate-400">
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-emerald-500" /> Cash in</span>
                <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-rose-400" /> Cash out</span>
              </span>
            )}
          </p>
        </div>

        <div className="relative mt-4">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-36 flex-col justify-between" aria-hidden>
            {[peak, peak / 2, 0].map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-right text-[10px] font-bold tabular-nums text-slate-300">
                  {v === 0 ? "0" : money(v).replace(/\.00$/, "")}
                </span>
                <span className="h-px flex-1 bg-slate-100" />
              </div>
            ))}
          </div>

          <div
            className="relative ml-14 grid h-36 items-end gap-px"
            style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
            onMouseLeave={() => setHover(null)}
          >
            {buckets.map((b, i) => (
              <div
                key={b.key}
                className={`group relative flex h-full items-end justify-center gap-px px-px ${hover === i ? "bg-slate-50" : ""}`}
                onMouseEnter={() => setHover(i)}
              >
                <span className="w-full max-w-3 rounded-t-sm bg-emerald-500" style={{ height: `${(b.cashIn / peak) * 100}%`, minHeight: b.cashIn > 0 ? 2 : 0 }} />
                <span className="w-full max-w-3 rounded-t-sm bg-rose-400"    style={{ height: `${(b.cashOut / peak) * 100}%`, minHeight: b.cashOut > 0 ? 2 : 0 }} />
              </div>
            ))}
          </div>

          <div
            className="ml-14 mt-1.5 grid gap-px"
            style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
            aria-hidden
          >
            {buckets.map((b, i) => (
              <span key={b.key} className="overflow-visible whitespace-nowrap text-center text-[10px] font-bold text-slate-400">
                {i % labelEvery === 0 ? b.label : ""}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-[13px] font-extrabold text-slate-900">Breakdown</h3>
          <label className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
            Group by
            <select
              value={by} onChange={(e) => setBy(e.target.value as GroupBy)}
              className="h-8 rounded-lg bg-slate-50 px-2 text-[12px] font-bold text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-sky-300"
            >
              {GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-3 max-h-[184px] overflow-y-auto pr-1">
          <table className="w-full border-separate border-spacing-y-0.5 text-[12px]">
            <thead className="sticky top-0 bg-white">
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                <th className="py-1 text-left font-black">{GROUP_OPTIONS.find((o) => o.value === by)?.label}</th>
                <th className="py-1 text-right font-black">#</th>
                <th className="py-1 text-right font-black">In</th>
                <th className="py-1 text-right font-black">Out</th>
                <th className="py-1 text-right font-black">Net</th>
              </tr>
            </thead>
            <tbody>
              {shownGroups.map((g) => {
                return (
                  <tr
                    key={g.key}
                    onClick={clickable ? () => onPick(by, g) : undefined}
                    className={`group/row ${clickable ? "cursor-pointer" : ""}`}
                    title={clickable ? "Click to filter the table to this group" : undefined}
                  >
                    <td className="relative max-w-[150px] rounded-l-lg py-1.5 pl-2 pr-2 group-hover/row:bg-sky-50">
                      <span className="absolute inset-y-1 left-0 w-[3px] rounded-full" style={{ background: g.color ?? "#94a3b8", opacity: 0.8 }} />
                      <span className="block truncate font-bold text-slate-700">{g.label}</span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-sky-400/70" style={{ width: `${(Math.max(g.cashIn, g.cashOut) / volume) * 100}%` }} />
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-slate-400 group-hover/row:bg-sky-50">{g.count}</td>
                    <td className="py-1.5 pl-2 text-right font-bold tabular-nums text-emerald-600 group-hover/row:bg-sky-50">{g.cashIn ? money(g.cashIn) : "—"}</td>
                    <td className="py-1.5 pl-2 text-right font-bold tabular-nums text-rose-600 group-hover/row:bg-sky-50">{g.cashOut ? money(g.cashOut) : "—"}</td>
                    <td className={`rounded-r-lg py-1.5 pl-2 pr-1 text-right font-extrabold tabular-nums group-hover/row:bg-sky-50 ${g.net < 0 ? "text-rose-600" : "text-slate-800"}`}>{money(g.net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {groups.length > shownGroups.length && (
            <p className="px-2 pt-1 text-[11px] font-semibold text-slate-400">
              Showing {shownGroups.length} of {groups.length} — filter the table to see the rest.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

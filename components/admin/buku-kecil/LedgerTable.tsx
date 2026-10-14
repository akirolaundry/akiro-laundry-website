// components/admin/buku-kecil/LedgerTable.tsx
"use client";
//
// The Buku Kecil transaction table: every ledger entry in the chosen period with
// click-to-sort headers (shift-click for a secondary sort), a filter under every
// column, global search, show/hide columns, density, pagination, live totals for
// whatever is filtered, an insights panel, a detail drawer and Excel export.

import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, BarChart3, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3,
  Download, Filter, FilterX, Rows3, Search, X,
} from "lucide-react";
import type { LedgerEntry } from "@/lib/actions/finance";
import { exportSheetsToXlsx } from "@/lib/utils/export-xlsx";
import { isoDayBiz } from "@/lib/utils/business-time";
import { formatUSD } from "@/lib/utils/order-form";
import {
  COLUMNS, COLUMN_BY_KEY, EMPTY_FILTERS, activeFilterKeys, dateLabel, exportRecords, filterRows,
  isFilterActive, sortRows, summarize, timeLabel, toRow,
  type ColumnFilter, type ColumnKey, type Direction, type GroupBy, type GroupRow,
  type LedgerRow, type SortSpec, type ViewFilters,
} from "@/lib/utils/ledger-table";
import { ColumnFilterControl, type SelectOption } from "@/components/admin/buku-kecil/ColumnFilter";
import { InsightsPanel } from "@/components/admin/buku-kecil/InsightsPanel";
import { Popover, usePopover } from "@/components/admin/buku-kecil/Popover";
import { RowDrawer } from "@/components/admin/buku-kecil/RowDrawer";
import { CategoryPill, KindTag, Money } from "@/components/admin/buku-kecil/cells";

const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
const DEFAULT_SORT: SortSpec[] = [{ key: "date", dir: "desc" }];
const PAGE_SIZES = [25, 50, 100, 250];
const HEADER_H = 40;

const iconBtn =
  "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-bold ring-1 transition active:scale-95 ";
const iconBtnOff = iconBtn + "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50";
const iconBtnOn  = iconBtn + "bg-sky-50 text-sky-700 ring-sky-200";

function describeFilter(key: ColumnKey, f: ColumnFilter): string {
  const label = COLUMN_BY_KEY[key].label;
  switch (f.type) {
    case "text":   return `${label}: “${f.q.trim()}”`;
    case "select": return `${label}: ${f.values.length > 2 ? `${f.values.slice(0, 2).join(", ")} +${f.values.length - 2}` : f.values.join(", ")}`;
    case "date":   return `${label}: ${f.from || "…"} → ${f.to || "…"}`;
    case "number": return `${label}: ${f.min.trim() ? `≥ ${f.min}` : ""}${f.min.trim() && f.max.trim() ? " · " : ""}${f.max.trim() ? `≤ ${f.max}` : ""}`;
  }
}

export function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  const allRows = useMemo(() => entries.map(toRow), [entries]);

  const [filters,     setFilters]     = useState<ViewFilters>(EMPTY_FILTERS);
  const [sorts,       setSorts]       = useState<SortSpec[]>(DEFAULT_SORT);
  const [visible,     setVisible]     = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  const [showFilters, setShowFilters] = useState(true);
  const [showInsights, setShowInsights] = useState(true);
  const [compact,     setCompact]     = useState(false);
  const [pageSize,    setPageSize]    = useState(50);
  const [page,        setPage]        = useState(0);
  const [selectedId,  setSelectedId]  = useState<number | null>(null);
  const columnsPop = usePopover();

  // Typing in a filter stays snappy: the table catches up a beat later.
  const deferred = useDeferredValue(filters);
  const filtered = useMemo(() => filterRows(allRows, deferred), [allRows, deferred]);
  const sorted   = useMemo(() => sortRows(filtered, sorts), [filtered, sorts]);
  const summary  = useMemo(() => summarize(sorted), [sorted]);
  const stale    = deferred !== filters;

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage  = Math.min(page, pageCount - 1);
  const pageRows  = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const cols = COLUMNS.filter((c) => visible.includes(c.key));
  const activeKeys = activeFilterKeys(filters.columns);
  const activeCount = activeKeys.length + (filters.search.trim() ? 1 : 0) + (filters.direction !== "all" ? 1 : 0);

  const selectOptions = useMemo(() => {
    const out: Partial<Record<ColumnKey, SelectOption[]>> = {};
    for (const c of COLUMNS) {
      if (c.type !== "select") continue;
      const counts = new Map<string, number>();
      for (const r of allRows) {
        const v = String(c.value(r) ?? "");
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      out[c.key] = [...counts]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    }
    return out;
  }, [allRows]);

  // ── State updaters (all of them send the table back to page 1) ──
  const patchFilters = (patch: Partial<ViewFilters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); };
  const setColumnFilter = (key: ColumnKey, f: ColumnFilter | undefined) => {
    setFilters((cur) => {
      const columns = { ...cur.columns };
      if (f && isFilterActive(f)) columns[key] = f; else delete columns[key];
      return { ...cur, columns };
    });
    setPage(0);
  };
  const clearAll = () => { setFilters(EMPTY_FILTERS); setPage(0); };
  const resetView = () => { clearAll(); setSorts(DEFAULT_SORT); setVisible(DEFAULT_COLUMNS); };

  const toggleSort = (key: ColumnKey, additive: boolean) => {
    setSorts((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      const firstDir = COLUMN_BY_KEY[key].type === "text" || COLUMN_BY_KEY[key].type === "select" ? "asc" : "desc";
      if (additive) {
        if (i === -1) return [...prev, { key, dir: firstDir }];
        if (prev[i].dir === firstDir) return prev.map((s, j) => (j === i ? { ...s, dir: firstDir === "asc" ? "desc" : "asc" } : s));
        return prev.filter((_, j) => j !== i);
      }
      if (prev.length === 1 && i === 0) {
        return prev[0].dir === firstDir ? [{ key, dir: firstDir === "asc" ? "desc" : "asc" }] : [];
      }
      return [{ key, dir: firstDir }];
    });
    setPage(0);
  };

  const toggleColumn = (key: ColumnKey) =>
    setVisible((v) => (v.includes(key) ? (v.length > 1 ? v.filter((k) => k !== key) : v) : [...v, key]));

  const applyText = (key: ColumnKey, q: string) => { setColumnFilter(key, { type: "text", q }); setSelectedId(null); };

  const pickGroup = (by: GroupBy, g: GroupRow) => {
    switch (by) {
      case "category": setColumnFilter("category", { type: "select", values: [g.key] }); break;
      case "kind":     setColumnFilter("kind",     { type: "select", values: [g.key] }); break;
      case "customer": if (g.key !== "—") setColumnFilter("customer", { type: "text", q: g.key }); break;
      case "order":    if (g.key !== "—") setColumnFilter("order",    { type: "text", q: g.key }); break;
      case "day":      setColumnFilter("date", { type: "date", from: g.key, to: g.key }); break;
      case "month":    setColumnFilter("date", { type: "date", from: `${g.key}-01`, to: `${g.key}-31` }); break;
      default: break;
    }
  };

  const handleExport = () => {
    const keys = cols.map((c) => c.key);
    const numeric = cols.filter((c) => c.type === "number").map((c) => c.label);
    exportSheetsToXlsx(
      [{ name: "Buku Kecil", rows: exportRecords(sorted, keys), numberColumns: numeric }],
      `buku_kecil_view_${isoDayBiz(new Date()).replace(/-/g, "")}`,
    );
  };

  // ── Drawer ──
  const selIdx = selectedId === null ? -1 : sorted.findIndex((r) => r.id === selectedId);
  const selRow = selIdx >= 0 ? sorted[selIdx] : null;

  const sortOf = (key: ColumnKey) => {
    const i = sorts.findIndex((s) => s.key === key);
    return i === -1 ? null : { dir: sorts[i].dir, rank: i + 1 };
  };

  const rowPad = compact ? "py-1.5" : "py-3";

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80" aria-label="Transactions">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="space-y-3 border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1 basis-72">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={filters.search}
              onChange={(e) => patchFilters({ search: e.target.value })}
              placeholder="Search order, customer, phone, description, amount…"
              aria-label="Search transactions"
              className="h-9 w-full rounded-xl bg-slate-50 pl-9 pr-9 text-[13px] font-semibold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:font-medium placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-sky-300"
            />
            {filters.search && (
              <button type="button" onClick={() => patchFilters({ search: "" })} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="inline-flex rounded-xl bg-slate-100 p-0.5" role="group" aria-label="Direction">
            {([
              { v: "all", label: "All" },
              { v: "in",  label: "Cash in" },
              { v: "out", label: "Cash out" },
            ] as { v: Direction; label: string }[]).map((o) => (
              <button
                key={o.v} type="button" onClick={() => patchFilters({ direction: o.v })} aria-pressed={filters.direction === o.v}
                className={`h-8 rounded-[10px] px-3 text-[12.5px] font-bold transition ${filters.direction === o.v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setShowFilters((v) => !v)} className={showFilters ? iconBtnOn : iconBtnOff} aria-pressed={showFilters}>
              <Filter size={14} /> Filters
              {activeKeys.length > 0 && <span className="rounded-full bg-sky-600 px-1.5 text-[10px] font-extrabold text-white">{activeKeys.length}</span>}
            </button>
            <button type="button" onClick={() => setShowInsights((v) => !v)} className={showInsights ? iconBtnOn : iconBtnOff} aria-pressed={showInsights}>
              <BarChart3 size={14} /> Insights
            </button>
            <button type="button" onClick={columnsPop.toggle} className={columnsPop.open ? iconBtnOn : iconBtnOff}>
              <Columns3 size={14} /> Columns
            </button>
            {columnsPop.anchor && (
              <Popover anchor={columnsPop.anchor} onClose={columnsPop.close} width={220} align="right">
                <div className="max-h-[min(380px,60vh)] overflow-y-auto p-1.5">
                  {COLUMNS.map((c) => {
                    const on = visible.includes(c.key);
                    return (
                      <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50">
                        <input type="checkbox" checked={on} onChange={() => toggleColumn(c.key)} className="h-4 w-4 accent-sky-600" />
                        {c.label}
                      </label>
                    );
                  })}
                </div>
                <div className="border-t border-slate-100 p-2">
                  <button type="button" onClick={() => setVisible(DEFAULT_COLUMNS)} className="h-8 w-full rounded-lg bg-slate-100 text-[12px] font-bold text-slate-600 hover:bg-slate-200">
                    Reset columns
                  </button>
                </div>
              </Popover>
            )}
            <button
              type="button" onClick={() => setCompact((v) => !v)} className={compact ? iconBtnOn : iconBtnOff}
              aria-pressed={compact} title={compact ? "Switch to comfortable rows" : "Switch to compact rows"}
            >
              <Rows3 size={14} /> {compact ? "Compact" : "Comfortable"}
            </button>
            <button type="button" onClick={handleExport} disabled={sorted.length === 0} className={`${iconBtnOff} disabled:opacity-40`} title="Download the rows in this view (all pages) as Excel">
              <Download size={14} /> Export view
            </button>
          </div>
        </div>

        {/* Active filter chips */}
        {activeCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {filters.search.trim() && <Chip label={`Search: “${filters.search.trim()}”`} onRemove={() => patchFilters({ search: "" })} />}
            {filters.direction !== "all" && <Chip label={filters.direction === "in" ? "Cash in only" : "Cash out only"} onRemove={() => patchFilters({ direction: "all" })} />}
            {activeKeys.map((k) => <Chip key={k} label={describeFilter(k, filters.columns[k]!)} onRemove={() => setColumnFilter(k, undefined)} />)}
            <button type="button" onClick={clearAll} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <FilterX size={13} /> Clear all
            </button>
          </div>
        )}
      </div>

      {/* ── Insights ─────────────────────────────────────────────────── */}
      {showInsights && (
        <div className={`border-b border-slate-100 transition-opacity ${stale ? "opacity-60" : ""}`}>
          <InsightsPanel rows={sorted} onPick={pickGroup} />
        </div>
      )}

      {/* ── Live summary of the current view ─────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-[12.5px]">
        <p className="font-bold text-slate-700">
          {sorted.length === allRows.length
            ? <>{allRows.length.toLocaleString()} entr{allRows.length === 1 ? "y" : "ies"}</>
            : <>{sorted.length.toLocaleString()} <span className="font-semibold text-slate-400">of {allRows.length.toLocaleString()} entries</span></>}
        </p>
        <Stat label="Cash in"  value={formatUSD(summary.cashIn)}  tone="text-emerald-600" />
        <Stat label="Cash out" value={formatUSD(summary.cashOut)} tone="text-rose-600" />
        <Stat label="Net"      value={formatUSD(summary.net)}     tone={summary.net < 0 ? "text-rose-600" : "text-slate-900"} />
        <Stat label="Orders"   value={String(summary.orders)} />
        <Stat label="Customers" value={String(summary.customers)} />
        {summary.largestIn > 0 && <Stat label="Largest in" value={formatUSD(summary.largestIn)} />}
        {summary.largestOut > 0 && <Stat label="Largest out" value={formatUSD(summary.largestOut)} />}
        {(sorts.length !== 1 || sorts[0].key !== "date" || sorts[0].dir !== "desc" || visible.length !== DEFAULT_COLUMNS.length || activeCount > 0) && (
          <button type="button" onClick={resetView} className="ml-auto text-[12px] font-bold text-sky-700 hover:underline">Reset view</button>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className={`max-h-[72vh] overflow-auto transition-opacity ${stale ? "opacity-60" : ""}`}>
        <table className="w-full min-w-max border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              {cols.map((c) => {
                const s = sortOf(c.key);
                return (
                  <th
                    key={c.key} scope="col"
                    aria-sort={s ? (s.dir === "asc" ? "ascending" : "descending") : "none"}
                    style={{ height: HEADER_H }}
                    className={`sticky top-0 z-20 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 text-[10.5px] font-black uppercase tracking-wider text-slate-500 ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    <button
                      type="button" onClick={(e) => toggleSort(c.key, e.shiftKey)}
                      title="Click to sort · Shift+click to add a secondary sort"
                      className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-900 ${s ? "text-sky-700" : ""}`}
                    >
                      {c.label}
                      {s ? (s.dir === "asc" ? <ArrowUp size={12} strokeWidth={3} /> : <ArrowDown size={12} strokeWidth={3} />) : <ChevronsUpDown size={12} className="opacity-40" />}
                      {s && sorts.length > 1 && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-600 text-[9px] font-black text-white">{s.rank}</span>}
                    </button>
                  </th>
                );
              })}
            </tr>
            {showFilters && (
              <tr>
                {cols.map((c) => (
                  <th key={c.key} style={{ top: HEADER_H }} className="sticky z-20 border-b border-slate-200 bg-white px-2 py-2 font-normal">
                    <ColumnFilterControl
                      col={c} filter={filters.columns[c.key]} options={selectOptions[c.key]}
                      onChange={(f) => setColumnFilter(c.key, f)}
                    />
                  </th>
                ))}
              </tr>
            )}
          </thead>

          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-6 py-16 text-center">
                  <p className="font-display text-[15px] font-extrabold text-slate-700">
                    {allRows.length === 0 ? "No transactions in this period" : "No entries match your filters"}
                  </p>
                  <p className="mt-1 text-[13px] font-semibold text-slate-400">
                    {allRows.length === 0 ? "Pick a wider period above." : "Try removing a filter or widening the search."}
                  </p>
                  {activeCount > 0 && (
                    <button type="button" onClick={clearAll} className="mt-4 h-9 rounded-xl bg-sky-600 px-4 text-[13px] font-bold text-white hover:bg-sky-700">Clear all filters</button>
                  )}
                </td>
              </tr>
            ) : pageRows.map((r) => (
              <tr
                key={r.id} tabIndex={0}
                onClick={() => setSelectedId(r.id)}
                onKeyDown={(e) => { if (e.key === "Enter") setSelectedId(r.id); }}
                className={`group cursor-pointer outline-none transition-colors hover:bg-sky-50/60 focus-visible:bg-sky-50 ${selectedId === r.id ? "bg-sky-50" : ""}`}
              >
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`border-b border-slate-100 px-3 align-middle ${rowPad} ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    <CellContent col={c.key} r={r} compact={compact} onText={applyText} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>

          {sorted.length > 0 && (
            <tfoot>
              <tr>
                {cols.map((c, i) => (
                  <td
                    key={c.key}
                    className={`sticky bottom-0 z-10 border-t border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] font-extrabold ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {i === 0 ? <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-500">Total · {sorted.length.toLocaleString()}</span>
                      : c.key === "cashOut" ? <Money value={summary.cashOut} tone="out" />
                      : c.key === "cashIn"  ? <Money value={summary.cashIn}  tone="in" />
                      : c.key === "net"     ? <Money value={summary.net} signed />
                      : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[12.5px] font-semibold text-slate-500">
        <label className="flex items-center gap-2">
          Rows per page
          <select
            value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            className="h-8 rounded-lg bg-slate-50 px-2 text-[12.5px] font-bold text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-sky-300"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <p className="tabular-nums">
          {sorted.length === 0 ? "0 entries" : `${safePage * pageSize + 1}–${Math.min(sorted.length, (safePage + 1) * pageSize)} of ${sorted.length.toLocaleString()}`}
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage === 0} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-35"><ChevronLeft size={15} /></button>
          <span className="px-2 tabular-nums">Page {safePage + 1} / {pageCount}</span>
          <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-35"><ChevronRight size={15} /></button>
        </div>
      </div>

      {selRow && (
        <RowDrawer
          row={selRow} position={selIdx + 1} total={sorted.length}
          onClose={() => setSelectedId(null)}
          onPrev={selIdx > 0 ? () => setSelectedId(sorted[selIdx - 1].id) : null}
          onNext={selIdx < sorted.length - 1 ? () => setSelectedId(sorted[selIdx + 1].id) : null}
          onFilterOrder={(order) => applyText("order", order)}
          onFilterCustomer={(customer) => applyText("customer", customer)}
        />
      )}
    </section>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-sky-50 pl-2.5 pr-1.5 text-[12px] font-bold text-sky-700 ring-1 ring-sky-200">
      <span className="max-w-[260px] truncate">{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="flex h-4 w-4 items-center justify-center rounded text-sky-500 hover:bg-sky-100 hover:text-sky-800">
        <X size={11} strokeWidth={3} />
      </button>
    </span>
  );
}

function Stat({ label, value, tone = "text-slate-900" }: { label: string; value: string; tone?: string }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className="text-[10.5px] font-black uppercase tracking-wider text-slate-400">{label}</span>
      <span className={`font-extrabold tabular-nums ${tone}`}>{value}</span>
    </p>
  );
}

function CellContent({ col, r, compact, onText }: {
  col: ColumnKey; r: LedgerRow; compact: boolean; onText: (key: ColumnKey, q: string) => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  switch (col) {
    case "date":
      return compact ? (
        <span className="whitespace-nowrap font-semibold text-slate-700">{dateLabel(r.ts)} <span className="text-slate-400">· {timeLabel(r.ts)}</span></span>
      ) : (
        <div className="whitespace-nowrap">
          <p className="font-bold text-slate-700">{dateLabel(r.ts)}</p>
          <p className="text-[11px] font-semibold text-slate-400">{timeLabel(r.ts)}</p>
        </div>
      );
    case "ref":
      return <span className="font-mono text-[12px] font-semibold text-slate-400">#{r.id}</span>;
    case "order":
      return r.order ? (
        <button
          type="button" onClick={(e) => { stop(e); onText("order", r.order); }}
          title="Show every entry for this order"
          className="rounded-md bg-sky-50 px-1.5 py-0.5 font-mono text-[12px] font-bold text-sky-700 ring-1 ring-sky-100 hover:bg-sky-100"
        >
          {r.order}
        </button>
      ) : <span className="text-slate-200">—</span>;
    case "customer":
      return r.customer ? (
        <button
          type="button" onClick={(e) => { stop(e); onText("customer", r.customer); }}
          title="Show every entry for this customer"
          className="max-w-[150px] truncate text-left font-bold text-slate-800 hover:text-sky-700 hover:underline"
        >
          {r.customer}
        </button>
      ) : <span className="text-slate-200">—</span>;
    case "phone":
      return r.phone ? <span className="tabular-nums text-slate-500">{r.phone}</span> : <span className="text-slate-200">—</span>;
    case "description":
      return <p className={`max-w-[260px] font-semibold text-slate-600 [overflow-wrap:anywhere] ${compact ? "truncate" : "line-clamp-2"}`} title={r.description}>{r.description}</p>;
    case "category":
      return <CategoryPill label={r.category} color={r.categoryColor} />;
    case "kind":
      return <KindTag kind={r.kind} />;
    case "cashOut":    return <Money value={r.cashOut} tone="out" />;
    case "cashIn":     return <Money value={r.cashIn}  tone="in" />;
    case "net":        return <Money value={r.net} signed />;
    case "balance":    return <span className="font-bold tabular-nums text-slate-800">{formatUSD(r.balance)}</span>;
    case "tendered":   return <Money value={r.tendered} tone="neutral" />;
    case "change":     return <Money value={r.change} tone="neutral" />;
    case "orderTotal": return <Money value={r.orderTotal} tone="neutral" />;
    case "orderStatus":
      return r.orderStatus ? <span className="whitespace-nowrap font-semibold text-slate-600">{r.orderStatus}</span> : <span className="text-slate-200">—</span>;
  }
}

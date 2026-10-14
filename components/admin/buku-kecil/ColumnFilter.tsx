// components/admin/buku-kecil/ColumnFilter.tsx
"use client";
//
// The filter control that sits under each column header. Text columns get an
// inline input; select / date / number columns get a compact trigger that opens
// a popover (so the narrow header cell never has to fit the whole control).

import { useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Popover, usePopover } from "@/components/admin/buku-kecil/Popover";
import { formatDateBiz } from "@/lib/utils/business-time";
import type { ColumnDef, ColumnFilter } from "@/lib/utils/ledger-table";
import { isFilterActive } from "@/lib/utils/ledger-table";

export interface SelectOption { value: string; count: number }

interface Props {
  col:      ColumnDef;
  filter:   ColumnFilter | undefined;
  options?: SelectOption[];
  onChange: (f: ColumnFilter | undefined) => void;
}

const field =
  "h-8 w-full rounded-lg bg-white px-2.5 text-[12px] font-semibold text-slate-700 outline-none ring-1 ring-slate-200 " +
  "placeholder:font-medium placeholder:text-slate-300 focus:ring-2 focus:ring-sky-300";

const triggerBase =
  "flex h-8 w-full items-center justify-between gap-1 rounded-lg px-2.5 text-left text-[12px] font-semibold ring-1 transition";

function Trigger({ active, label, onClick }: { active: boolean; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`${triggerBase} ${active
        ? "bg-sky-50 text-sky-700 ring-sky-200"
        : "bg-white text-slate-400 ring-slate-200 hover:text-slate-600"}`}
    >
      <span className="truncate">{label}</span>
      <ChevronDown size={12} className="shrink-0 opacity-60" />
    </button>
  );
}

export function ColumnFilterControl({ col, filter, options = [], onChange }: Props) {
  const pop = usePopover();

  if (col.type === "text") {
    const q = filter?.type === "text" ? filter.q : "";
    return (
      <div className="relative">
        <input
          value={q}
          onChange={(e) => onChange(e.target.value ? { type: "text", q: e.target.value } : undefined)}
          placeholder="Contains…"
          aria-label={`Filter ${col.label}`}
          className={`${field} pr-7 ${q ? "!bg-sky-50 !ring-sky-200" : ""}`}
        />
        {q && (
          <button
            type="button" onClick={() => onChange(undefined)} aria-label={`Clear ${col.label} filter`}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
  }

  if (col.type === "select") {
    const values = filter?.type === "select" ? filter.values : [];
    const label  = values.length === 0 ? "All" : values.length === 1 ? values[0] : `${values.length} selected`;
    return (
      <>
        <Trigger active={values.length > 0} label={label} onClick={pop.toggle} />
        {pop.anchor && (
          <Popover anchor={pop.anchor} onClose={pop.close} width={252}>
            <SelectList
              options={options} selected={values}
              onChange={(next) => onChange(next.length ? { type: "select", values: next } : undefined)}
            />
          </Popover>
        )}
      </>
    );
  }

  if (col.type === "date") {
    const f = filter?.type === "date" ? filter : { type: "date" as const, from: "", to: "" };
    const label = !isFilterActive(filter) ? "Any date"
      : f.from && f.to ? (f.from === f.to ? formatDateBiz(`${f.from}T12:00:00Z`) : `${f.from.slice(5)} → ${f.to.slice(5)}`)
      : f.from ? `From ${f.from.slice(5)}` : `Until ${f.to.slice(5)}`;
    const set = (next: { from: string; to: string }) =>
      onChange(next.from || next.to ? { type: "date", ...next } : undefined);
    return (
      <>
        <Trigger active={isFilterActive(filter)} label={label} onClick={pop.toggle} />
        {pop.anchor && (
          <Popover anchor={pop.anchor} onClose={pop.close} width={252}>
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  From
                  <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value, to: f.to })} className={`${field} mt-1`} />
                </label>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  To
                  <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ from: f.from, to: e.target.value })} className={`${field} mt-1`} />
                </label>
              </div>
              <ClearButton disabled={!isFilterActive(filter)} onClick={() => onChange(undefined)} />
            </div>
          </Popover>
        )}
      </>
    );
  }

  // number
  const f = filter?.type === "number" ? filter : { type: "number" as const, min: "", max: "" };
  const label = !isFilterActive(filter) ? "Any amount"
    : f.min && f.max ? `${f.min} – ${f.max}`
    : f.min ? `≥ ${f.min}` : `≤ ${f.max}`;
  const set = (next: { min: string; max: string }) =>
    onChange(next.min.trim() || next.max.trim() ? { type: "number", ...next } : undefined);
  return (
    <>
      <Trigger active={isFilterActive(filter)} label={label} onClick={pop.toggle} />
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={232} align="right">
          <div className="space-y-3 p-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Min
                <input type="number" inputMode="decimal" step="0.01" value={f.min} onChange={(e) => set({ min: e.target.value, max: f.max })} placeholder="0" className={`${field} mt-1`} />
              </label>
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Max
                <input type="number" inputMode="decimal" step="0.01" value={f.max} onChange={(e) => set({ min: f.min, max: e.target.value })} placeholder="∞" className={`${field} mt-1`} />
              </label>
            </div>
            <ClearButton disabled={!isFilterActive(filter)} onClick={() => onChange(undefined)} />
          </div>
        </Popover>
      )}
    </>
  );
}

function ClearButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="h-8 w-full rounded-lg bg-slate-100 text-[12px] font-bold text-slate-600 transition hover:bg-slate-200 disabled:opacity-40"
    >
      Clear filter
    </button>
  );
}

function SelectList({ options, selected, onChange }: {
  options: SelectOption[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const shown = q ? options.filter((o) => o.value.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div className="flex max-h-[min(340px,60vh)] flex-col">
      {options.length > 7 && (
        <div className="relative border-b border-slate-100 p-2">
          <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={`${field} pl-8`} />
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {shown.length === 0 && <li className="px-3 py-4 text-center text-xs font-semibold text-slate-400">Nothing found</li>}
        {shown.map((o) => {
          const on = selected.includes(o.value);
          return (
            <li key={o.value}>
              <button
                type="button" onClick={() => toggle(o.value)} aria-pressed={on}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 ${on ? "bg-sky-600 text-white ring-sky-600" : "bg-white ring-slate-300"}`}>
                  {on && <Check size={11} strokeWidth={3.5} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.value || "(none)"}</span>
                <span className="text-[11px] font-bold tabular-nums text-slate-400">{o.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-slate-100 p-2">
        <ClearButton disabled={selected.length === 0} onClick={() => onChange([])} />
      </div>
    </div>
  );
}

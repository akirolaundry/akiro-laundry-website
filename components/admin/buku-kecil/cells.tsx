// components/admin/buku-kecil/cells.tsx
// Small presentational pieces shared by the Buku Kecil table and its drawer.

import { formatUSD } from "@/lib/utils/order-form";

const KIND_TONE: Record<string, string> = {
  "Order payment":   "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "Down payment":    "bg-teal-50 text-teal-700 ring-teal-100",
  "Balance payment": "bg-sky-50 text-sky-700 ring-sky-100",
  "Change given":    "bg-amber-50 text-amber-700 ring-amber-100",
  "Income":          "bg-green-50 text-green-700 ring-green-100",
  "Expense":         "bg-rose-50 text-rose-700 ring-rose-100",
  "Adjustment":      "bg-violet-50 text-violet-700 ring-violet-100",
  "Opening balance": "bg-slate-100 text-slate-600 ring-slate-200",
};

export function KindTag({ kind }: { kind: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide ring-1 ${KIND_TONE[kind] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}>
      {kind}
    </span>
  );
}

export function CategoryPill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold"
      style={{ color, background: color + "18", boxShadow: `inset 0 0 0 1px ${color}40` }}
    >
      <i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Right-aligned money; zero / missing shows a faint dash. `tone` colours non-zero values. */
export function Money({ value, tone, signed }: { value: number | null; tone?: "in" | "out" | "neutral"; signed?: boolean }) {
  if (value === null || value === 0) return <span className="text-slate-200">—</span>;
  const color = tone === "in" ? "text-emerald-600"
    : tone === "out" ? "text-rose-600"
    : signed ? (value < 0 ? "text-rose-600" : "text-emerald-600")
    : "text-slate-800";
  const text = signed ? `${value < 0 ? "−" : "+"}${formatUSD(Math.abs(value))}` : formatUSD(value);
  return <span className={`font-bold tabular-nums ${color}`}>{text}</span>;
}

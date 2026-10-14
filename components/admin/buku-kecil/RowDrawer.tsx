// components/admin/buku-kecil/RowDrawer.tsx
"use client";
//
// Slide-over with everything known about one ledger entry, links to its order
// and customer, and shortcuts to narrow the table to that order / customer.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronDown, ChevronUp, ExternalLink, Filter, X } from "lucide-react";
import { formatUSD } from "@/lib/utils/order-form";
import { dateLabel, timeLabel, type LedgerRow } from "@/lib/utils/ledger-table";
import { KindTag } from "@/components/admin/buku-kecil/cells";

interface Props {
  row:         LedgerRow;
  position:    number;   // 1-based, within the current sorted view
  total:       number;
  onClose:     () => void;
  onPrev:      (() => void) | null;
  onNext:      (() => void) | null;
  onFilterOrder:    (order: string) => void;
  onFilterCustomer: (customer: string) => void;
}

export function RowDrawer({ row, position, total, onClose, onPrev, onNext, onFilterOrder, onFilterCustomer }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown" && onNext) { e.preventDefault(); onNext(); }
      else if (e.key === "ArrowUp" && onPrev)   { e.preventDefault(); onPrev(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, onNext, onPrev]);

  const amount = row.direction === "in" ? row.cashIn : row.cashOut;

  const facts: { k: string; v: React.ReactNode }[] = [
    { k: "Date", v: `${dateLabel(row.ts)} · ${timeLabel(row.ts)}` },
    { k: "Category", v: (
      <span className="inline-flex items-center gap-1.5">
        <i className="h-2 w-2 rounded-full" style={{ background: row.categoryColor }} />{row.category}
      </span>
    ) },
    { k: "Balance after", v: formatUSD(row.balance) },
  ];
  if (row.tendered !== null) facts.push({ k: "Cash handed over", v: formatUSD(row.tendered) }, { k: "Change given", v: formatUSD(row.change ?? 0) });
  if (row.orderTotal !== null) facts.push({ k: "Order total", v: formatUSD(row.orderTotal) });
  if (row.orderStatus) facts.push({ k: "Order payment", v: row.orderStatus });

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/40 backdrop-blur-[2px]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label={`Transaction #${row.id}`} className="flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Transaction #{row.id}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">{position} of {total} in this view</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onPrev ?? undefined} disabled={!onPrev} aria-label="Previous entry" title="Previous (↑)" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronUp size={16} /></button>
            <button type="button" onClick={onNext ?? undefined} disabled={!onNext} aria-label="Next entry" title="Next (↓)" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronDown size={16} /></button>
            <button type="button" onClick={onClose} aria-label="Close" className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={17} /></button>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
          <div>
            <KindTag kind={row.kind} />
            <p className={`mt-3 font-display text-[34px] font-extrabold leading-none tracking-tight tabular-nums ${row.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
              {row.direction === "in" ? "+" : "−"}{formatUSD(amount)}
            </p>
            <p className="mt-3 text-[14px] font-semibold leading-snug text-slate-700 [overflow-wrap:anywhere]">{row.description}</p>
          </div>

          <dl className="divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200">
            {facts.map(({ k, v }) => (
              <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5 text-[13px]">
                <dt className="font-semibold text-slate-400">{k}</dt>
                <dd className="text-right font-bold tabular-nums text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>

          {(row.order || row.customer) && (
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Related</p>

              {row.order && (
                <div className="rounded-2xl p-4 ring-1 ring-slate-200">
                  <p className="font-mono text-[14px] font-bold text-sky-700">{row.order}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.orderId !== null && (
                      <Link href={`/admin/orders/${row.orderId}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-bold text-white hover:bg-slate-700">
                        Open order <ExternalLink size={12} />
                      </Link>
                    )}
                    <button type="button" onClick={() => onFilterOrder(row.order)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-50 px-3 text-[12px] font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100">
                      <Filter size={12} /> All entries for this order
                    </button>
                  </div>
                  {row.orderId === null && <p className="mt-2 text-[11.5px] font-semibold text-slate-400">This order has since been deleted.</p>}
                </div>
              )}

              {row.customer && (
                <div className="rounded-2xl p-4 ring-1 ring-slate-200">
                  <p className="text-[14px] font-bold text-slate-800">{row.customer}</p>
                  {row.phone && <p className="text-xs font-semibold tabular-nums text-slate-400">{row.phone}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.customerId !== null && (
                      <Link href={`/admin/customers/${row.customerId}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-bold text-white hover:bg-slate-700">
                        Open customer <ExternalLink size={12} />
                      </Link>
                    )}
                    <button type="button" onClick={() => onFilterCustomer(row.customer)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-50 px-3 text-[12px] font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100">
                      <Filter size={12} /> All entries for this customer
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

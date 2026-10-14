// components/employee/ExpenseModal.tsx
"use client";
//
// Staff records money taken out of the drawer (lunch, supplies, …). Categories
// are the admin's expense master data; the amount is checked against the cash
// actually in the drawer.

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Receipt, Tags, X } from "lucide-react";
import { recordEmployeeExpense } from "@/lib/actions/payments";
import { formatUSD } from "@/lib/utils/order-form";
import type { ExpenseCategory } from "@/lib/db/schema";

interface Props {
  categories: ExpenseCategory[];
  /** Cash currently in the drawer. */
  balance:    number;
  onClose:    () => void;
  onSaved:    (message: string) => void;
}

export function ExpenseModal({ categories, balance, onClose, onSaved }: Props) {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount,     setAmount]     = useState("");
  const [note,       setNote]       = useState("");
  const [error,      setError]      = useState<string | null>(null);
  const [pending,    start]         = useTransition();

  const value    = parseFloat(amount);
  const valid    = !isNaN(value) && value > 0;
  const category = categories.find((c) => c.id === categoryId);
  const after    = valid ? balance - value : null;

  const submit = () => {
    if (!category) { setError("Pick what the money was spent on."); return; }
    if (!valid)    { setError("Enter an amount greater than zero."); return; }
    if (value > balance) { setError(`Only ${formatUSD(balance)} is in the drawer.`); return; }
    setError(null);
    start(async () => {
      const res = await recordEmployeeExpense({ categoryId: category.id, amount: value, note });
      if (res.success) onSaved(`${formatUSD(value)} recorded for ${category.name}`);
      else setError(res.error ?? "Could not record the expense.");
    });
  };

  // Portalled to <body> so `fixed` isn't confined by the page-enter transform on <main>.
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="Add expense"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}
    >
      <div className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-w-md sm:rounded-[28px]">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-100">
              <Receipt size={19} strokeWidth={2.4} />
            </span>
            <div>
              <h2 className="font-display text-[17px] font-extrabold text-slate-900">Add expense</h2>
              <p className="text-xs font-semibold text-slate-400">Paid out of the drawer · {formatUSD(balance)} available</p>
            </div>
          </div>
          <button
            type="button" onClick={onClose} disabled={pending} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto px-5 py-5">
          {/* Category */}
          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">What was it for?</p>
            {categories.length === 0 ? (
              <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 p-3.5 text-[13px] font-semibold text-amber-700 ring-1 ring-amber-100">
                <Tags size={16} className="mt-0.5 shrink-0" />
                No expense categories have been set up yet. Ask an admin to add some.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {categories.map((c) => {
                  const active = c.id === categoryId;
                  const color  = c.color ?? "#64748b";
                  return (
                    <button
                      key={c.id} type="button" onClick={() => { setCategoryId(c.id); setError(null); }}
                      aria-pressed={active}
                      className="flex min-h-12 items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left text-[14px] font-bold ring-1 transition active:scale-[0.97]"
                      style={active
                        ? { background: color + "18", color, boxShadow: `inset 0 0 0 1.5px ${color}`, borderColor: color }
                        : { background: "white", color: "#475569", boxShadow: "inset 0 0 0 1px #e2e8f0" }}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {active && <Check size={15} strokeWidth={3} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
            {category?.description && (
              <p className="mt-2 px-1 text-xs font-semibold text-slate-400">{category.description}</p>
            )}
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="expense-amount" className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-400">Amount</label>
            <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-sky-300">
              <span className="font-display text-lg font-extrabold text-slate-400">$</span>
              <input
                id="expense-amount" type="number" inputMode="decimal" min="0" step="0.01"
                value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }}
                placeholder="0.00"
                className="h-14 w-full bg-transparent font-display text-2xl font-extrabold tabular-nums text-slate-900 outline-none placeholder:text-slate-300"
              />
            </div>
            {after !== null && (
              <p className={`mt-2 px-1 text-xs font-bold tabular-nums ${after < 0 ? "text-rose-600" : "text-slate-400"}`}>
                {after < 0 ? "More than the drawer holds" : `Drawer after: ${formatUSD(after)}`}
              </p>
            )}
          </div>

          {/* Note */}
          <div>
            <label htmlFor="expense-note" className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-400">
              Note <span className="font-semibold normal-case tracking-normal">(optional)</span>
            </label>
            <input
              id="expense-note" type="text" value={note} maxLength={120}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Nasi goreng for 3 staff"
              className="h-12 w-full rounded-2xl bg-slate-50 px-4 text-[14px] font-semibold text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-300 focus:ring-2 focus:ring-sky-300"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] font-bold text-rose-600 ring-1 ring-rose-100">{error}</p>
          )}
        </div>

        <footer className="flex gap-3 border-t border-slate-100 px-5 py-4">
          <button
            type="button" onClick={onClose} disabled={pending}
            className="h-12 flex-1 rounded-2xl bg-slate-100 text-[14px] font-bold text-slate-600 transition hover:bg-slate-200 active:scale-95"
          >
            Cancel
          </button>
          <button
            type="button" onClick={submit} disabled={pending || categories.length === 0}
            className="flex h-12 flex-[1.6] items-center justify-center gap-2 rounded-2xl bg-rose-600 text-[14px] font-extrabold text-white shadow-lg shadow-rose-600/25 transition hover:bg-rose-700 active:scale-95 disabled:opacity-60"
          >
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
            Record expense
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

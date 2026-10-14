// components/admin/buku-kecil/RecordTransactionModal.tsx
"use client";
//
// Manual income / expense entry for the cash book. Lives in a modal so the
// transaction table can use the full page width.

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Loader2, X } from "lucide-react";
import { recordManualTransaction } from "@/lib/actions/payments";
import { formatUSD } from "@/lib/utils/order-form";
import type { ExpenseCategory } from "@/lib/db/schema";

const field =
  "h-11 w-full rounded-xl bg-slate-50 px-3.5 text-[14px] font-semibold text-slate-800 outline-none ring-1 ring-slate-200 " +
  "placeholder:font-medium placeholder:text-slate-300 focus:bg-white focus:ring-2 focus:ring-sky-300";
const label = "mb-1.5 block text-[10.5px] font-black uppercase tracking-wider text-slate-400";

export function RecordTransactionModal({ categories, balance, onClose, onRecorded }: {
  categories: ExpenseCategory[];
  balance:    number;
  onClose:    () => void;
  onRecorded: () => void;
}) {
  const [dir,    setDir]    = useState<"income" | "outcome">("outcome");
  const [amount, setAmount] = useState("");
  const [desc,   setDesc]   = useState("");
  const [catId,  setCatId]  = useState<number | null>(null);
  const [error,  setError]  = useState<string | null>(null);
  const [done,   setDone]   = useState<string | null>(null);
  const [pending, start]    = useTransition();

  const formCats = useMemo(
    () => categories.filter((c) => (dir === "income" ? c.kind === "income" || c.kind === "both" : c.kind === "expense" || c.kind === "both")),
    [categories, dir],
  );

  const submit = () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError("Enter an amount greater than zero."); return; }
    if (!desc.trim())           { setError("Add a description."); return; }
    if (!catId)                 { setError("Select a category."); return; }
    setError(null);
    start(async () => {
      const res = await recordManualTransaction({ direction: dir, amount: amt, description: desc.trim(), categoryId: catId });
      if (res.success) {
        setDone(`Recorded. New balance ${formatUSD(res.newBalance ?? balance)}.`);
        setAmount(""); setDesc(""); setCatId(null);
        onRecorded();
      } else {
        setError(res.error ?? "Failed to record.");
      }
    });
  };

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="Record transaction"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}
    >
      <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-extrabold text-slate-900">Record transaction</h2>
            <p className="text-xs font-semibold text-slate-400">Drawer balance {formatUSD(balance)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2.5">
            {([
              { d: "income" as const,  name: "Income",  Icon: ArrowUpCircle,   on: "border-emerald-500 bg-emerald-50 text-emerald-700" },
              { d: "outcome" as const, name: "Expense", Icon: ArrowDownCircle, on: "border-rose-500 bg-rose-50 text-rose-700" },
            ]).map((o) => (
              <button
                key={o.d} type="button" onClick={() => { setDir(o.d); setCatId(null); setDone(null); }} aria-pressed={dir === o.d}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 py-3 text-[12.5px] font-extrabold transition ${dir === o.d ? o.on : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"}`}
              >
                <o.Icon size={20} /> {o.name}
              </button>
            ))}
          </div>

          <div>
            <label className={label}>Category <span className="text-rose-500">*</span></label>
            {formCats.length === 0 ? (
              <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-amber-700 ring-1 ring-amber-100">
                No {dir === "income" ? "income" : "expense"} categories yet —{" "}
                <Link href="/admin/expense-categories" className="underline">add one on the Expense Categories page</Link>.
              </p>
            ) : (
              <select value={catId ?? ""} onChange={(e) => setCatId(e.target.value ? parseInt(e.target.value) : null)} className={field}>
                <option value="">Select a category…</option>
                {formCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className={label}>Amount</label>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${field} h-12 text-[18px] font-extrabold tabular-nums`} />
          </div>

          <div>
            <label className={label}>Description</label>
            <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={dir === "income" ? "e.g. Vending machine income" : "e.g. Detergent restock"} className={field} />
          </div>

          {error && <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-[13px] font-bold text-rose-600 ring-1 ring-rose-100">{error}</p>}
          {done  && <p role="status" className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[13px] font-bold text-emerald-700 ring-1 ring-emerald-100">{done}</p>}

          <div className="flex gap-2.5">
            <button type="button" onClick={onClose} disabled={pending} className="h-11 flex-1 rounded-xl bg-slate-100 text-[13px] font-bold text-slate-600 hover:bg-slate-200">
              {done ? "Close" : "Cancel"}
            </button>
            <button
              type="button" onClick={submit} disabled={pending}
              className={`flex h-11 flex-[1.6] items-center justify-center gap-2 rounded-xl text-[13px] font-extrabold text-white transition active:scale-95 disabled:opacity-60 ${dir === "income" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}
            >
              {pending ? <Loader2 size={15} className="animate-spin" /> : dir === "income" ? <ArrowUpCircle size={15} /> : <ArrowDownCircle size={15} />}
              {dir === "income" ? "Record income" : "Record expense"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

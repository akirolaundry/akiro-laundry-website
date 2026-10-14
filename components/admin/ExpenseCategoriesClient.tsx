// components/admin/ExpenseCategoriesClient.tsx
"use client";
//
// Master data: the expense categories staff pick from when they take money out
// of the drawer (employee Cash Register → Add expense). The same categories feed
// Buku Kecil / Buku Besar, so each one also says which side of the ledger it
// applies to — only "Expense" and "Both" categories are offered to employees.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Tags, Plus, Pencil, Trash2, X, Loader2, AlertTriangle, UtensilsCrossed, Users,
} from "lucide-react";
import {
  createExpenseCategory, updateExpenseCategory, deleteExpenseCategory,
  type ExpenseCategoryWithUsage,
} from "@/lib/actions/payments";
import { formatUSD } from "@/lib/utils/order-form";

type Kind = "expense" | "income" | "both";

const PALETTE = [
  "#1a7fba", "#16a34a", "#d97706", "#e11d48", "#7c3aed",
  "#0891b2", "#be185d", "#b45309", "#4f46e5", "#059669",
];

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: "expense", label: "Expense", hint: "An expense category" },
  { value: "both",    label: "Both",    hint: "Usable as an expense and as income in Buku Kecil" },
  { value: "income",  label: "Income",  hint: "Buku Kecil income only — never offered to staff" },
];

const SUGGESTIONS = ["Lunch", "Dinner", "Snacks & Drinks", "Supplies", "Transport", "Cleaning", "Repairs"];

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 14px",
  border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, color: "#1e293b",
  outline: "none", background: "#f8fafc", fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 800, color: "#94a3b8",
  textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6,
};

// ─── Employee on/off switch ───────────────────────────────────────────────────

function Switch({ on, disabled, label, onChange }: {
  on: boolean; disabled?: boolean; label: string; onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: "none", padding: 2, flexShrink: 0,
        background: on ? "#16a34a" : "#cbd5e1", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1, transition: "background 0.15s", display: "flex", alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: "50%", background: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
    </button>
  );
}

// ─── Add / edit modal ─────────────────────────────────────────────────────────

function CategoryModal({ existing, onClose, onSaved }: {
  existing?: ExpenseCategoryWithUsage; onClose: () => void; onSaved: () => void;
}) {
  const [name,  setName]  = useState(existing?.name ?? "");
  const [desc,  setDesc]  = useState(existing?.description ?? "");
  const [color, setColor] = useState(existing?.color ?? PALETTE[0]);
  const [kind,  setKind]  = useState<Kind>((existing?.kind as Kind | undefined) ?? "expense");
  const [employeeEnabled, setEmployeeEnabled] = useState(existing?.employeeEnabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start]  = useTransition();

  const submit = () => {
    if (!name.trim()) { setError("Category name is required."); return; }
    setError(null);
    start(async () => {
      const data = { name: name.trim(), description: desc, color, kind, employeeEnabled };
      const res = existing
        ? await updateExpenseCategory(existing.id, data)
        : await createExpenseCategory({ ...data, description: desc.trim() || undefined });
      if (res.success) onSaved();
      else setError(res.error ?? "Something went wrong.");
    });
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}
    >
      <div style={{ background: "white", borderRadius: 14, boxShadow: "0 24px 60px rgba(0,0,0,0.18)", width: "100%", maxWidth: 440, maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: 16, color: "#0f172a" }}>
            {existing ? "Edit category" : "New expense category"}
          </p>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", display: "flex" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="e.g. Lunch" style={inputStyle}
            />
            {!existing && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => setName(s)} style={{
                    padding: "3px 10px", borderRadius: 20, border: "1.5px solid #e2e8f0",
                    background: "white", fontSize: 11, fontWeight: 600, color: "#64748b", cursor: "pointer",
                  }}>{s}</button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Description <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>(optional)</span></label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="When staff should use it" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Applies to</label>
            <div style={{ display: "flex", gap: 6 }}>
              {KINDS.map((k) => {
                const active = kind === k.value;
                return (
                  <button key={k.value} type="button" onClick={() => setKind(k.value)} style={{
                    flex: 1, padding: "8px 4px", borderRadius: 8, cursor: "pointer",
                    border: `1.5px solid ${active ? "#1a7fba" : "#e2e8f0"}`,
                    background: active ? "#edf7fd" : "white",
                    color: active ? "#1a7fba" : "#64748b", fontSize: 12, fontWeight: 700,
                  }}>{k.label}</button>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{KINDS.find((k) => k.value === kind)?.hint}</p>
          </div>

          {kind !== "income" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: "#f8fafc", border: "1.5px solid #e2e8f0" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>Employees can use this</p>
                <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                  {employeeEnabled ? "Shown when staff add an expense" : "Hidden from staff — admins only"}
                </p>
              </div>
              <Switch on={employeeEnabled} label="Employees can use this category" onChange={setEmployeeEnabled} />
            </div>
          )}

          <div>
            <label style={labelStyle}>Colour</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PALETTE.map((hex) => (
                <button
                  key={hex} type="button" onClick={() => setColor(hex)} aria-label={hex}
                  style={{
                    width: 26, height: 26, borderRadius: "50%", background: hex, cursor: "pointer",
                    border: `2.5px solid ${color === hex ? "#1e293b" : "transparent"}`,
                    boxShadow: color === hex ? "0 0 0 1.5px white inset" : "none",
                  }}
                />
              ))}
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 12, fontWeight: 600, padding: "8px 12px", borderRadius: 8, background: "#fff1f2", color: "#be123c", border: "1px solid #fda4af" }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} disabled={pending} style={{ flex: 1, padding: 11, borderRadius: 8, border: "1.5px solid #e2e8f0", background: "white", fontSize: 13, fontWeight: 700, color: "#64748b", cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={submit} disabled={pending} style={{
              flex: 1.4, padding: 11, borderRadius: 8, border: "none", color: "white", fontSize: 13, fontWeight: 800,
              background: pending ? "#94a3b8" : "linear-gradient(135deg,#1a7fba,#2496d6 55%,#0f5a85)",
              cursor: pending ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              {pending && <Loader2 size={13} className="animate-spin" />}
              {existing ? "Save changes" : "Add category"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

function ConfirmDelete({ category, pending, onConfirm, onClose }: {
  category: ExpenseCategoryWithUsage; pending: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}
    >
      <div style={{ background: "white", borderRadius: 14, border: "1.5px solid #fda4af", width: "100%", maxWidth: 380, padding: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
        <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#fff1f2", border: "1.5px solid #fda4af", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <AlertTriangle size={22} style={{ color: "#be123c" }} />
        </div>
        <div>
          <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: 16, color: "#0f172a", marginBottom: 6 }}>
            Delete “{category.name}”?
          </p>
          <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
            {category.txCount > 0
              ? `${category.txCount} past transaction${category.txCount === 1 ? "" : "s"} use it and will show as uncategorised in Buku Kecil / Buku Besar. `
              : ""}
            Staff will no longer be able to pick it.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          <button onClick={onClose} disabled={pending} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1.5px solid #e2e8f0", background: "white", fontSize: 13, fontWeight: 700, color: "#64748b", cursor: "pointer" }}>Cancel</button>
          <button onClick={onConfirm} disabled={pending} style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: pending ? "#94a3b8" : "linear-gradient(135deg,#dc2626,#ef4444)", fontSize: 13, fontWeight: 800, color: "white", cursor: pending ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {pending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ExpenseCategoriesClient({ categories }: { categories: ExpenseCategoryWithUsage[] }) {
  const router = useRouter();
  const [modal,    setModal]    = useState<"new" | ExpenseCategoryWithUsage | null>(null);
  const [deleting, setDeleting] = useState<ExpenseCategoryWithUsage | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [pending,  start]       = useTransition();

  const [togglingId, setTogglingId] = useState<number | null>(null);
  const forStaff = categories.filter((c) => c.employeeEnabled && (c.kind === "expense" || c.kind === "both"));

  const toggleEmployee = (c: ExpenseCategoryWithUsage, next: boolean) => {
    setTogglingId(c.id);
    setError(null);
    start(async () => {
      const res = await updateExpenseCategory(c.id, { employeeEnabled: next });
      if (!res.success) setError(res.error ?? "Failed to update category.");
      setTogglingId(null);
      router.refresh();
    });
  };

  const saved = () => { setModal(null); router.refresh(); };

  const confirmDelete = () => {
    if (!deleting) return;
    start(async () => {
      const res = await deleteExpenseCategory(deleting.id);
      if (res.success) { setDeleting(null); setError(null); router.refresh(); }
      else { setDeleting(null); setError(res.error ?? "Failed to delete category."); }
    });
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 4 }}>Master Data</p>
          <h1 style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: 26, color: "#0f172a", letterSpacing: "-0.02em" }}>
            Expense Categories
          </h1>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
            The categories staff choose from when they take money out of the cash drawer.
          </p>
        </div>
        <button onClick={() => setModal("new")} style={{
          display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 16px", borderRadius: 9, border: "none",
          background: "linear-gradient(135deg,#1a7fba,#2496d6 55%,#0f5a85)", color: "white",
          fontSize: 13, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 14px rgba(26,127,186,0.3)",
        }}>
          <Plus size={15} /> New category
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "white", borderRadius: 12, border: "1.5px solid #e2e8f0" }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, background: "#edf7fd", border: "1.5px solid #b6def5", display: "flex", alignItems: "center", justifyContent: "center", color: "#1a7fba" }}>
            <Tags size={16} />
          </span>
          <div>
            <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: 20, color: "#0f172a", lineHeight: 1.1 }}>{categories.length}</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>Categories in total</p>
          </div>
        </div>
        <div style={{ flex: "1 1 220px", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "white", borderRadius: 12, border: "1.5px solid #e2e8f0" }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, background: "#f0fdf4", border: "1.5px solid #86efac", display: "flex", alignItems: "center", justifyContent: "center", color: "#16a34a" }}>
            <Users size={16} />
          </span>
          <div>
            <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: 20, color: "#0f172a", lineHeight: 1.1 }}>{forStaff.length}</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>Available to employees</p>
          </div>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 12, fontWeight: 600, padding: "10px 14px", borderRadius: 8, background: "#fff1f2", color: "#be123c", border: "1px solid #fda4af" }}>{error}</p>
      )}

      <div style={{ background: "white", borderRadius: 12, border: "1.5px solid #e2e8f0", boxShadow: "0 1px 6px rgba(0,0,0,0.04)", overflow: "hidden" }}>
        {categories.length === 0 ? (
          <div style={{ padding: "52px 24px", textAlign: "center" }}>
            <span style={{ width: 52, height: 52, borderRadius: 14, background: "#f1f5f9", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", marginBottom: 12 }}>
              <UtensilsCrossed size={22} />
            </span>
            <p style={{ fontFamily: "Sora,sans-serif", fontWeight: 800, fontSize: 15, color: "#334155" }}>No categories yet</p>
            <p style={{ fontSize: 13, color: "#94a3b8", margin: "4px 0 16px" }}>
              Add things like Lunch, Dinner or Supplies so staff can record what they spend.
            </p>
            <button onClick={() => setModal("new")} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#1a7fba", color: "white", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              Add the first category
            </button>
          </div>
        ) : (
          categories.map((c, i) => {
            const color = c.color ?? "#64748b";
            const canToggle    = c.kind !== "income";
            const staffVisible = canToggle && c.employeeEnabled;
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderTop: i === 0 ? "none" : "1px solid #f1f5f9" }}>
                <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, background: color + "18", border: `1.5px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: color }} />
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{c.name}</p>
                    <span style={{
                      fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 4,
                      background: staffVisible ? "#f0fdf4" : "#f1f5f9", color: staffVisible ? "#15803d" : "#64748b",
                      border: `1px solid ${staffVisible ? "#86efac" : "#e2e8f0"}`,
                    }}>
                      {c.kind === "income" ? "Income only" : staffVisible ? "Staff can use" : "Admin only"}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8" }}>
                      {c.kind === "both" ? "Expense + Income" : c.kind === "income" ? "" : "Expense"}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.description || (c.txCount > 0 ? "" : "No description")}
                    {c.txCount > 0 && <>{c.description ? " · " : ""}Used {c.txCount}× · {formatUSD(c.txTotal)}</>}
                  </p>
                </div>

                {canToggle && (
                  <Switch
                    on={c.employeeEnabled}
                    disabled={pending && togglingId === c.id}
                    label={`Let employees use ${c.name}`}
                    onChange={(next) => toggleEmployee(c, next)}
                  />
                )}
                <button onClick={() => setModal(c)} title="Edit" aria-label={`Edit ${c.name}`} style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid #e2e8f0", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                  <Pencil size={13} />
                </button>
                <button onClick={() => { setError(null); setDeleting(c); }} title="Delete" aria-label={`Delete ${c.name}`} style={{ width: 32, height: 32, borderRadius: 8, border: "1.5px solid #fecdd3", background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#e11d48" }}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {modal && (
        <CategoryModal
          existing={modal === "new" ? undefined : modal}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {deleting && (
        <ConfirmDelete category={deleting} pending={pending} onConfirm={confirmDelete} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

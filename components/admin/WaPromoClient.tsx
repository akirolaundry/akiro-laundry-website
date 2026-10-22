"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MessageCircle, Send, Search, Users, X, Loader2, Download,
  CheckCircle2, AlertTriangle, ExternalLink, Copy, Trash2, Info,
  Zap, Hand, Bookmark, BookmarkPlus,
} from "lucide-react";
import { interpolate } from "@/lib/utils/wa-message";
import { parseE164 } from "@/lib/utils/phone";
import {
  createPromoBlast, markPromoSent, sendPromoTest, deletePromoCampaign,
  savePromoTemplate, deletePromoTemplate,
  type PromoRecipient, type PromoCampaignRow, type CreatePromoResult, type PromoTemplateRow,
} from "@/lib/actions/wa-promo";

// ─── Constants ───────────────────────────────────────────────────────────────

const TOKENS: { token: string; label: string }[] = [
  { token: "{{firstName}}",     label: "First name" },
  { token: "{{customerName}}",  label: "Full name" },
  { token: "{{businessName}}",  label: "Business name" },
  { token: "{{businessPhone}}", label: "Business phone" },
  { token: "{{businessUrl}}",   label: "Business URL" },
];

type Audience = "all" | "ordered" | "never" | "new30";

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: "all",     label: "All customers" },
  { key: "ordered", label: "Has ordered" },
  { key: "never",   label: "Never ordered" },
  { key: "new30",   label: "New (30 days)" },
];

const DAY = 86_400_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waNumber(phone: string): string {
  const p = parseE164(phone);
  return p ? `${p.country.code}${p.localNumber}` : phone.replace(/\D/g, "").replace(/^0+/, "");
}

function waToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*(.+?)\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/~(.+?)~/g, "<del>$1</del>")
    .replace(/\n/g, "<br/>");
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "white", borderRadius: "12px", border: "1.5px solid #e2e8f0",
  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "10px", fontWeight: 800, color: "#94a3b8",
  textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px",
};
const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 12px",
  border: "1.5px solid #e2e8f0", borderRadius: "8px",
  fontSize: "13px", color: "#1e293b", outline: "none", background: "#f8fafc",
};
const primaryBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
  height: 44, padding: "0 20px", borderRadius: "9px", border: "none",
  background: "linear-gradient(135deg,#1a7fba,#2496d6 55%,#0f5a85)",
  boxShadow: "0 4px 14px rgba(26,127,186,0.3)",
  color: "white", fontSize: "13px", fontWeight: 800, cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: "7px",
  height: 38, padding: "0 14px", borderRadius: "8px",
  border: "1.5px solid #e2e8f0", background: "white",
  color: "#475569", fontSize: "12px", fontWeight: 700, cursor: "pointer",
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  recipients: PromoRecipient[];
  campaigns:  PromoCampaignRow[];
  templates:  PromoTemplateRow[];
  provider:   "manual" | "fonnte";
  business:   { name: string; phone: string; url: string };
}

export function WaPromoClient({ recipients, campaigns, templates, provider, business }: Props) {
  const router = useRouter();
  const [isPending, start] = useTransition();

  const [title, setTitle]       = useState("");
  const [message, setMessage]   = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [search, setSearch]     = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm]   = useState(false);
  const [testPhone, setTestPhone] = useState(business.phone);
  const [manualResult, setManualResult] = useState<CreatePromoResult | null>(null);

  // Saved templates: which one is loaded, plus the two "are you sure?" dialogs.
  const [activeTemplateId, setActiveTemplateId] = useState<number | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [replacing, setReplacing] = useState<PromoTemplateRow | null>(null);
  const [removing,  setRemoving]  = useState<PromoTemplateRow | null>(null);

  // ── Filtered audience ────────────────────────────────────────────────────
  // "now" captured once at mount so the memo stays pure across renders.
  const [newCutoff] = useState(() => Date.now() - 30 * DAY);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipients.filter((r) => {
      if (audience === "ordered" && r.totalOrders === 0) return false;
      if (audience === "never"   && r.totalOrders > 0)   return false;
      if (audience === "new30"   && new Date(r.createdAt).getTime() < newCutoff) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.phone.includes(q)) return false;
      return true;
    });
  }, [recipients, audience, search, newCutoff]);

  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });

  const selectedRecipients = recipients.filter((r) => selected.has(r.id));

  // ── Live preview ─────────────────────────────────────────────────────────
  const previewName = selectedRecipients[0]?.name ?? "Maria Santos";
  const preview = interpolate(message || "…", {
    customerName:  previewName,
    firstName:     previewName.split(/\s+/)[0],
    businessName:  business.name,
    businessPhone: business.phone,
    businessUrl:   business.url,
  });

  const insertToken = (token: string) => setMessage((m) => (m ? `${m} ${token}` : token));

  // ── Templates ────────────────────────────────────────────────────────────
  const applyTemplate = (t: PromoTemplateRow) => {
    setTitle(t.title ?? "");
    setMessage(t.message);
    setActiveTemplateId(t.id);
    toast.success(`Loaded “${t.name}”.`);
  };

  // Don't silently overwrite something the admin has typed.
  const useTemplate = (t: PromoTemplateRow) => {
    const typed = message.trim();
    if (typed && typed !== t.message.trim()) setReplacing(t);
    else applyTemplate(t);
  };

  // Resolves true once saved, so the panel knows when to close its name field.
  const saveTemplate = async (name: string): Promise<boolean> => {
    setSavingTemplate(true);
    const res = await savePromoTemplate({ name, title, message });
    setSavingTemplate(false);
    if (!res.success || !res.template) {
      toast.error(res.error ?? "Failed to save the template.");
      return false;
    }
    setActiveTemplateId(res.template.id);
    toast.success(res.replaced ? `Updated “${res.template.name}”.` : `Saved “${res.template.name}”.`);
    router.refresh();
    return true;
  };

  const removeTemplate = (t: PromoTemplateRow) => {
    setRemoving(null);
    start(async () => {
      const res = await deletePromoTemplate(t.id);
      if (!res.success) {
        toast.error(res.error ?? "Failed to delete the template.");
        return;
      }
      if (activeTemplateId === t.id) setActiveTemplateId(null);
      toast.success("Template deleted.");
      router.refresh();
    });
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  const doSend = () => {
    setConfirm(false);
    start(async () => {
      const res = await createPromoBlast({
        title: title || undefined,
        message,
        customerIds: [...selected],
      });
      if (!res.success) {
        toast.error(res.error ?? "Failed to send.");
        return;
      }
      if (res.provider === "manual") {
        setManualResult(res);
        toast.success(`Blast prepared for ${res.links?.length ?? 0} customers — send the links below.`);
      } else {
        toast.success(`Sent ${res.sent ?? 0} · failed ${res.failed ?? 0}`);
        setSelected(new Set());
        setTitle("");
        setMessage("");
        setActiveTemplateId(null);
      }
      router.refresh();
    });
  };

  const doTest = () => {
    if (!testPhone.trim()) { toast.error("Enter a phone number first."); return; }
    start(async () => {
      const res = await sendPromoTest(testPhone, message);
      if (res.success) toast.success("Test message queued.");
      else toast.error(res.error ?? "Test failed.");
    });
  };

  const exportSelected = () => {
    const list = selectedRecipients.length > 0 ? selectedRecipients : filtered;
    if (list.length === 0) { toast.error("Nothing to export."); return; }
    downloadCsv(
      `promo-recipients-${new Date().toISOString().slice(0, 10)}.csv`,
      [["Name", "Phone", "WhatsApp number", "Orders"],
        ...list.map((r) => [r.name, r.phone, waNumber(r.phone), String(r.totalOrders)])],
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

      {/* ── Provider banner ── */}
      <div style={{
        ...card, padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: "10px",
        borderColor: provider === "fonnte" ? "#86efac" : "#fcd34d",
        background:  provider === "fonnte" ? "#f0fdf4" : "#fffbeb",
      }}>
        {provider === "fonnte"
          ? <Zap size={16} style={{ color: "#16a34a", marginTop: 1, flexShrink: 0 }} />
          : <Hand size={16} style={{ color: "#d97706", marginTop: 1, flexShrink: 0 }} />}
        <div style={{ fontSize: "12px", color: "#3f3f46", lineHeight: 1.5 }}>
          {provider === "fonnte" ? (
            <><strong>One-click mode (Fonnte).</strong> Blasts are pushed straight to WhatsApp
              through the Fonnte gateway. Keep volumes modest to protect your number.</>
          ) : (
            <><strong>Manual mode.</strong> No WhatsApp API is connected, so a blast produces
              ready-to-send <code style={{ background: "#fef3c7", padding: "0 4px", borderRadius: 3 }}>wa.me</code> links
              you open one by one (or export the numbers for a WhatsApp Broadcast List).
              Add a <code style={{ background: "#fef3c7", padding: "0 4px", borderRadius: 3 }}>FONNTE_TOKEN</code> env
              var to unlock one-click sending.</>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "18px" }}>

        {/* ══ Compose ══ */}
        <div style={{ ...card, padding: "18px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <MessageCircle size={15} style={{ color: "#1a7fba" }} />
            <span style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>Compose promo</span>
          </div>

          <TemplatePanel
            templates={templates}
            activeId={activeTemplateId}
            canSave={message.trim().length > 0}
            suggestedName={templates.find((t) => t.id === activeTemplateId)?.name ?? title.trim()}
            busy={isPending || savingTemplate}
            onUse={useTemplate}
            onSave={saveTemplate}
            onDelete={setRemoving}
          />

          <div>
            <label style={lbl}>Campaign title (optional — for your history)</label>
            <input style={inp} value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Ramadan 20% off" />
          </div>

          <div>
            <label style={lbl}>Message</label>
            <textarea
              style={{ ...inp, minHeight: 150, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={"Botarde {{firstName}}! 🎉\n\nAmi iha promosaun foun iha *{{businessName}}* — deskontu 20% ba serbisu laundry to'o loron 30.\n\nMai vizita ami! {{businessUrl}}"}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: "10px", color: "#94a3b8" }}>
                *bold* · _italic_ · ~strike~
              </span>
              <span style={{ fontSize: "10px", color: message.length > 900 ? "#dc2626" : "#94a3b8" }}>
                {message.length} chars
              </span>
            </div>
          </div>

          <div>
            <label style={lbl}>Insert token</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {TOKENS.map((t) => (
                <button key={t.token} type="button" onClick={() => insertToken(t.token)}
                  style={{ padding: "5px 9px", borderRadius: "7px", cursor: "pointer",
                    border: "1.5px solid #e2e8f0", background: "white",
                    color: "#475569", fontSize: "11px", fontWeight: 700 }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={lbl}>Preview (as {previewName})</label>
            <div style={{
              background: "#e6ddd4", borderRadius: "10px", padding: "12px",
              backgroundImage: "linear-gradient(#efe7dd,#e6ddd4)",
            }}>
              <div style={{
                background: "#dcf8c6", borderRadius: "8px", padding: "8px 10px",
                fontSize: "13px", color: "#1f2937", lineHeight: 1.5,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
                boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
              }} dangerouslySetInnerHTML={{ __html: waToHtml(preview) }} />
            </div>
          </div>

          {provider === "fonnte" && (
            <div style={{ borderTop: "1px dashed #e2e8f0", paddingTop: "12px" }}>
              <label style={lbl}>Send a test to yourself</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input style={{ ...inp, flex: 1 }} value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)} placeholder="+670 7xxx xxxx" />
                <button style={ghostBtn} onClick={doTest} disabled={isPending}>
                  <Send size={12} /> Test
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ══ Audience ══ */}
        <div style={{ ...card, padding: "18px", display: "flex", flexDirection: "column", gap: "12px", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Users size={15} style={{ color: "#1a7fba" }} />
              <span style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>Recipients</span>
            </div>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#1a7fba", background: "#edf7fd",
              padding: "3px 8px", borderRadius: "6px", border: "1px solid #b6def5" }}>
              {selected.size} selected
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {AUDIENCES.map((a) => {
              const active = audience === a.key;
              return (
                <button key={a.key} type="button" onClick={() => setAudience(a.key)}
                  style={{ padding: "6px 10px", borderRadius: "7px", cursor: "pointer",
                    border: `1.5px solid ${active ? "#1a7fba" : "#e2e8f0"}`,
                    background: active ? "#edf7fd" : "white",
                    color: active ? "#0f5a85" : "#64748b", fontSize: "11px", fontWeight: 700 }}>
                  {a.label}
                </button>
              );
            })}
          </div>

          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input style={{ ...inp, paddingLeft: 30 }} value={search}
              onChange={(e) => setSearch(e.target.value)} placeholder="Search name or number…" />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            fontSize: "11px", color: "#64748b" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontWeight: 700 }}>
              <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} />
              Select all {filtered.length} shown
            </label>
            <button onClick={exportSelected} style={{ ...ghostBtn, height: 28, padding: "0 10px", fontSize: "11px" }}>
              <Download size={11} /> Export CSV
            </button>
          </div>

          <div style={{
            border: "1.5px solid #e2e8f0", borderRadius: "8px", overflow: "auto",
            maxHeight: 340, minHeight: 160,
          }}>
            {filtered.length === 0 ? (
              <p style={{ padding: "40px 12px", textAlign: "center", fontSize: "12px", color: "#94a3b8" }}>
                No customers match.
              </p>
            ) : filtered.map((r, i) => (
              <label key={r.id} style={{
                display: "flex", alignItems: "center", gap: "10px", padding: "9px 12px",
                borderBottom: i < filtered.length - 1 ? "1px solid #f1f5f9" : "none",
                background: selected.has(r.id) ? "#f0f9ff" : "white", cursor: "pointer",
              }}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</p>
                  <p style={{ fontSize: "10px", color: "#94a3b8" }}>
                    {r.phone} · {r.totalOrders} order{r.totalOrders !== 1 ? "s" : ""}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ══ Send bar ══ */}
      <div style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "12px", color: "#64748b" }}>
          {selected.size === 0
            ? "Pick recipients and write a message to enable sending."
            : <>Ready to {provider === "fonnte" ? "send" : "prepare"} <strong style={{ color: "#0f172a" }}>{selected.size}</strong> message{selected.size !== 1 ? "s" : ""}.</>}
        </div>
        <button
          style={{ ...primaryBtn, opacity: (selected.size === 0 || message.trim().length < 5 || isPending) ? 0.5 : 1,
            cursor: (selected.size === 0 || message.trim().length < 5 || isPending) ? "not-allowed" : "pointer" }}
          disabled={selected.size === 0 || message.trim().length < 5 || isPending}
          onClick={() => setConfirm(true)}
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {provider === "fonnte" ? "Send blast" : "Prepare blast"}
        </button>
      </div>

      {/* ══ History ══ */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9" }}>
          <span style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>Blast history</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Date", "Campaign", "Mode", "Status", "Recipients", "Sent", "Failed", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "10px",
                    fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em",
                    borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "36px", textAlign: "center", fontSize: "13px", color: "#94a3b8" }}>
                  No blasts sent yet.
                </td></tr>
              ) : campaigns.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 14px", fontSize: "11px", color: "#64748b", whiteSpace: "nowrap" }}>
                    {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: "12px", color: "#1e293b", fontWeight: 600, maxWidth: 220 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.title || c.message.slice(0, 60)}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "5px",
                      background: c.provider === "fonnte" ? "#dcfce7" : "#fef3c7",
                      color: c.provider === "fonnte" ? "#166534" : "#92400e" }}>
                      {c.provider}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <StatusBadge status={c.status} />
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: "12px", color: "#475569" }}>{c.recipientCount}</td>
                  <td style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 700, color: "#16a34a" }}>{c.sentCount}</td>
                  <td style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 700, color: c.failedCount ? "#dc2626" : "#cbd5e1" }}>{c.failedCount}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <button
                      onClick={() => start(async () => {
                        const r = await deletePromoCampaign(c.id);
                        if (r.success) { toast.success("Deleted."); router.refresh(); }
                        else toast.error(r.error ?? "Failed.");
                      })}
                      style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
                        borderRadius: "6px", border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══ Confirm modal ══ */}
      {confirm && (
        <Modal onClose={() => setConfirm(false)}>
          <div style={{ padding: "22px" }}>
            <AlertTriangle size={26} style={{ color: "#d97706" }} />
            <p style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", marginTop: "10px" }}>
              {provider === "fonnte" ? "Send this blast now?" : "Prepare this blast?"}
            </p>
            <p style={{ fontSize: "13px", color: "#64748b", marginTop: "6px", lineHeight: 1.5 }}>
              {provider === "fonnte"
                ? <>This will send the promo to <strong>{selected.size}</strong> customer{selected.size !== 1 ? "s" : ""} over WhatsApp via Fonnte. This cannot be undone.</>
                : <>This creates <strong>{selected.size}</strong> wa.me link{selected.size !== 1 ? "s" : ""} for you to send by hand.</>}
            </p>
            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <button style={{ ...ghostBtn, flex: 1, height: 42 }} onClick={() => setConfirm(false)}>Cancel</button>
              <button style={{ ...primaryBtn, flex: 1 }} onClick={doSend}>
                {provider === "fonnte" ? "Send now" : "Prepare"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ══ Template dialogs ══ */}
      {replacing && (
        <ConfirmDialog
          title={`Load “${replacing.name}”?`}
          body="This replaces the message you've written. Save it as a template first if you want to keep it."
          confirmLabel="Replace message"
          onCancel={() => setReplacing(null)}
          onConfirm={() => { applyTemplate(replacing); setReplacing(null); }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Delete “${removing.name}”?`}
          body="The template is removed for good. Blasts you already sent keep their message in the history."
          confirmLabel="Delete"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => removeTemplate(removing)}
        />
      )}

      {/* ══ Manual result modal ══ */}
      {manualResult?.links && (
        <ManualResult
          result={manualResult}
          message={message}
          business={business}
          onClose={() => setManualResult(null)}
          onDone={() => {
            setManualResult(null);
            setSelected(new Set());
            setTitle("");
            setMessage("");
            setActiveTemplateId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Saved templates ─────────────────────────────────────────────────────────

function TemplatePanel({
  templates, activeId, canSave, suggestedName, busy, onUse, onSave, onDelete,
}: {
  templates:     PromoTemplateRow[];
  activeId:      number | null;
  /** There's a message to save. */
  canSave:       boolean;
  /** Pre-fills the name field: the loaded template, else the campaign title. */
  suggestedName: string;
  busy:          boolean;
  onUse:         (t: PromoTemplateRow) => void;
  onSave:        (name: string) => Promise<boolean>;
  onDelete:      (t: PromoTemplateRow) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName]     = useState("");

  const trimmed  = name.trim().replace(/\s+/g, " ");
  const existing = templates.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const open = () => { setName(suggestedName); setNaming(true); };
  const submit = async () => {
    if (!trimmed || busy) return;
    if (await onSave(trimmed)) setNaming(false);
  };

  return (
    <div style={{ border: "1.5px solid #e2e8f0", borderRadius: "10px", background: "#f8fafc" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "9px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
          <Bookmark size={13} style={{ color: "#1a7fba", flexShrink: 0 }} />
          <span style={{ fontSize: "12px", fontWeight: 800, color: "#0f172a" }}>Templates</span>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", background: "white",
            border: "1px solid #e2e8f0", padding: "1px 7px", borderRadius: "999px" }}>
            {templates.length}
          </span>
        </div>
        {!naming && (
          <button
            type="button" onClick={open} disabled={!canSave || busy}
            title={canSave ? "Save the current message as a template" : "Write a message first"}
            style={{ ...ghostBtn, height: 30, padding: "0 10px", fontSize: "11px",
              opacity: canSave ? 1 : 0.5, cursor: canSave && !busy ? "pointer" : "not-allowed" }}
          >
            <BookmarkPlus size={12} /> Save as template
          </button>
        )}
      </div>

      {naming && (
        <div style={{ padding: "0 12px 10px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              autoFocus
              style={{ ...inp, flex: 1, background: "white" }}
              value={name}
              maxLength={60}
              placeholder="Template name, e.g. Ramadan 20% off"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  { e.preventDefault(); void submit(); }
                if (e.key === "Escape") setNaming(false);
              }}
            />
            <button
              type="button" onClick={() => void submit()} disabled={!trimmed || busy}
              style={{ ...ghostBtn, borderColor: "#1a7fba", background: "#1a7fba", color: "white",
                opacity: !trimmed || busy ? 0.5 : 1, cursor: !trimmed || busy ? "not-allowed" : "pointer" }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              {existing ? "Replace" : "Save"}
            </button>
            <button type="button" onClick={() => setNaming(false)} disabled={busy} style={ghostBtn}>Cancel</button>
          </div>
          {existing && (
            <p style={{ fontSize: "10.5px", color: "#b45309", marginTop: 6 }}>
              A template named “{existing.name}” already exists — saving replaces its message.
            </p>
          )}
        </div>
      )}

      {templates.length === 0 ? (
        <p style={{ padding: "0 12px 11px", fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>
          No saved templates yet. Write a message, then press <strong>Save as template</strong> to reuse it later.
        </p>
      ) : (
        <div style={{ maxHeight: 168, overflowY: "auto", borderTop: "1px solid #e2e8f0", background: "white",
          borderRadius: "0 0 9px 9px" }}>
          {templates.map((t, i) => {
            const active = t.id === activeId;
            return (
              <div key={t.id} style={{
                display: "flex", alignItems: "center",
                borderBottom: i < templates.length - 1 ? "1px solid #f1f5f9" : "none",
                background: active ? "#edf7fd" : "white",
              }}>
                <button
                  type="button" onClick={() => onUse(t)} disabled={busy}
                  title="Use this template"
                  style={{ flex: 1, minWidth: 0, textAlign: "left", padding: "8px 12px", border: "none",
                    background: "transparent", cursor: busy ? "not-allowed" : "pointer" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#1e293b",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                    {active && (
                      <span style={{ fontSize: "9px", fontWeight: 800, color: "#0f5a85", background: "white",
                        border: "1px solid #b6def5", padding: "0 5px", borderRadius: "4px", flexShrink: 0 }}>
                        LOADED
                      </span>
                    )}
                  </span>
                  <span style={{ display: "block", fontSize: "10.5px", color: "#94a3b8", marginTop: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.message.replace(/\s+/g, " ")}
                  </span>
                </button>
                <button
                  type="button" onClick={() => onDelete(t)} disabled={busy}
                  aria-label={`Delete template ${t.name}`} title="Delete template"
                  style={{ width: 30, height: 30, margin: "0 6px", flexShrink: 0, display: "flex",
                    alignItems: "center", justifyContent: "center", borderRadius: "6px", border: "none",
                    background: "transparent", cursor: busy ? "not-allowed" : "pointer", color: "#94a3b8" }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: {
  title:        string;
  body:         string;
  confirmLabel: string;
  danger?:      boolean;
  onConfirm:    () => void;
  onCancel:     () => void;
}) {
  return (
    <Modal onClose={onCancel}>
      <div style={{ padding: "22px" }}>
        <AlertTriangle size={26} style={{ color: danger ? "#dc2626" : "#d97706" }} />
        <p style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", marginTop: "10px" }}>{title}</p>
        <p style={{ fontSize: "13px", color: "#64748b", marginTop: "6px", lineHeight: 1.5 }}>{body}</p>
        <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
          <button style={{ ...ghostBtn, flex: 1, height: 42 }} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...primaryBtn, flex: 1,
              ...(danger ? { background: "linear-gradient(135deg,#be123c,#f43f5e 55%,#9f1239)", boxShadow: "0 4px 14px rgba(225,29,72,0.3)" } : {}) }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; c: string; label: string }> = {
    draft:   { bg: "#f1f5f9", c: "#475569", label: "Draft" },
    sending: { bg: "#dbeafe", c: "#1e40af", label: "Sending" },
    sent:    { bg: "#dcfce7", c: "#166534", label: "Sent" },
    failed:  { bg: "#fee2e2", c: "#991b1b", label: "Failed" },
  };
  const s = map[status] ?? map.draft;
  return (
    <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "5px", background: s.bg, color: s.c }}>
      {s.label}
    </span>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
        backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "white", borderRadius: "16px", border: "1.5px solid #e2e8f0",
        boxShadow: "0 32px 80px rgba(0,0,0,0.2)", width: "100%", maxWidth: 460, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

// ─── Manual result (wa.me link runner) ───────────────────────────────────────

function ManualResult({
  result, message, business, onClose, onDone,
}: {
  result: CreatePromoResult;
  message: string;
  business: { name: string; phone: string; url: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const links = result.links ?? [];
  const [idx, setIdx] = useState(0);
  const [saving, save] = useTransition();

  const openNext = () => {
    if (idx >= links.length) return;
    window.open(links[idx].url, "_blank", "noopener");
    setIdx((n) => n + 1);
  };

  const copyMessage = () => {
    const sample = interpolate(message, {
      customerName: "{{name}}", firstName: "{{name}}",
      businessName: business.name, businessPhone: business.phone, businessUrl: business.url,
    });
    navigator.clipboard.writeText(sample);
    toast.success("Message copied — paste it into a WhatsApp Broadcast List.");
  };

  const exportLinks = () =>
    downloadCsv(
      `promo-links-${new Date().toISOString().slice(0, 10)}.csv`,
      [["Name", "Phone", "wa.me link"], ...links.map((l) => [l.name, l.phone, l.url])],
    );

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "20px 22px", borderBottom: "1px solid #f1f5f9",
        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>Send {links.length} messages</p>
          <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: 2 }}>{idx} of {links.length} opened</p>
        </div>
        <button onClick={onClose} style={{ background: "#f1f5f9", border: "none", borderRadius: 7,
          width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <X size={14} style={{ color: "#64748b" }} />
        </button>
      </div>

      <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", gap: "8px", padding: "10px 12px", borderRadius: 8,
          background: "#eff6ff", border: "1px solid #bfdbfe" }}>
          <Info size={14} style={{ color: "#1d4ed8", flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: "11px", color: "#1e3a8a", lineHeight: 1.5 }}>
            Each click opens WhatsApp with the message pre-filled — just press send, come back,
            and open the next. Or export the numbers and build a <strong>Broadcast List</strong> in
            the WhatsApp app (up to 256 contacts, one tap).
          </p>
        </div>

        <div style={{ height: 6, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${links.length ? (idx / links.length) * 100 : 0}%`,
            background: "linear-gradient(90deg,#4ade80,#16a34a)", transition: "width .2s" }} />
        </div>

        <button
          style={{ ...primaryBtn, opacity: idx >= links.length ? 0.5 : 1,
            cursor: idx >= links.length ? "not-allowed" : "pointer",
            background: "linear-gradient(135deg,#16a34a,#22c55e)" }}
          disabled={idx >= links.length}
          onClick={openNext}
        >
          <ExternalLink size={14} />
          {idx === 0 ? "Open first" : idx >= links.length ? "All opened" : `Open next (${idx + 1}/${links.length})`}
        </button>
        {idx < links.length && (
          <p style={{ fontSize: "11px", color: "#64748b", textAlign: "center" }}>
            Next: <strong>{links[idx].name}</strong> ({links[idx].phone})
          </p>
        )}

        <div style={{ display: "flex", gap: "8px" }}>
          <button style={{ ...ghostBtn, flex: 1 }} onClick={copyMessage}>
            <Copy size={12} /> Copy message
          </button>
          <button style={{ ...ghostBtn, flex: 1 }} onClick={exportLinks}>
            <Download size={12} /> Export list
          </button>
        </div>

        <button
          style={{ ...ghostBtn, height: 42, borderColor: "#86efac", color: "#16a34a", background: "#f0fdf4" }}
          disabled={saving}
          onClick={() => save(async () => {
            const r = await markPromoSent(result.campaignId!);
            if (r.success) { toast.success("Marked as sent."); onDone(); }
            else toast.error(r.error ?? "Failed.");
          })}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          Mark all as sent &amp; close
        </button>
      </div>
    </Modal>
  );
}

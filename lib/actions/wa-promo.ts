// lib/actions/wa-promo.ts
"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  customers,
  orders,
  waPromoCampaigns,
  waPromoRecipients,
  waPromoTemplates,
} from "@/lib/db/schema";
import type { WaTemplateSettings } from "@/lib/db/schema/whatsapp";
import { getWaTemplateSettings } from "@/lib/actions/wa-templates";
import { interpolate } from "@/lib/utils/wa-message";
import {
  getWaProvider,
  sendViaFonnte,
  toWaNumber,
  waMeLink,
} from "@/lib/utils/wa-send";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// Hard cap per blast — keeps the Fonnte send loop inside the serverless time
// budget and stops an accidental send-to-everyone-twice.
const MAX_BLAST = 500;

// Tokens that change per recipient. If a message uses none of these, every
// recipient gets an identical body and we can push the whole list to Fonnte in
// one call instead of one-per-person.
const PERSONAL_TOKEN_RE = /\{\{\s*(firstName|customerName)\s*\}\}/;

// ─── Auth ────────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "admin") throw new Error("Not authorized.");
  return session!.user as { email?: string | null; name?: string | null };
}

// ─── Recipients ──────────────────────────────────────────────────────────────

export interface PromoRecipient {
  id:          number;
  name:        string;
  phone:       string;
  totalOrders: number;
  lastOrderAt: string | null;
  createdAt:   string;
}

export async function getPromoRecipients(): Promise<PromoRecipient[]> {
  const [custRows, orderRows] = await Promise.all([
    db.select().from(customers).orderBy(desc(customers.createdAt)),
    db
      .select({ customerId: orders.customerId, createdAt: orders.createdAt })
      .from(orders),
  ]);

  const stats = new Map<number, { count: number; last: Date | null }>();
  for (const o of orderRows) {
    const cur = stats.get(o.customerId) ?? { count: 0, last: null };
    cur.count += 1;
    const d = new Date(o.createdAt);
    if (!cur.last || d > cur.last) cur.last = d;
    stats.set(o.customerId, cur);
  }

  return custRows
    .filter((c) => c.phone && c.phone.trim())
    .map((c) => {
      const s = stats.get(c.id);
      return {
        id:          c.id,
        name:        c.name,
        phone:       c.phone,
        totalOrders: s?.count ?? 0,
        lastOrderAt: s?.last ? s.last.toISOString() : null,
        createdAt:   new Date(c.createdAt).toISOString(),
      };
    });
}

// ─── Message rendering ───────────────────────────────────────────────────────

function renderMessage(
  message:  string,
  name:     string,
  settings: WaTemplateSettings | null,
): string {
  const first = name.trim().split(/\s+/)[0] || name;
  return interpolate(message, {
    customerName:  name,
    firstName:     first,
    businessName:  settings?.businessName  ?? "Akiro Laundry",
    businessPhone: settings?.businessPhone ?? "",
    businessUrl:   settings?.businessUrl   ?? "",
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Create + send a blast ───────────────────────────────────────────────────

export interface CreatePromoInput {
  title?:       string;
  message:      string;
  customerIds:  number[];
}

export interface CreatePromoResult {
  success:    boolean;
  error?:     string;
  campaignId?: number;
  provider?:  "manual" | "fonnte";
  sent?:      number;
  failed?:    number;
  /** Manual mode only — click-to-chat links for the admin to send by hand. */
  links?:     { name: string; phone: string; url: string }[];
}

export async function createPromoBlast(
  input: CreatePromoInput,
): Promise<CreatePromoResult> {
  let user: { email?: string | null } = {};
  try {
    user = await requireAdmin();
  } catch {
    return { success: false, error: "You must be signed in as an admin." };
  }

  try {
    const message = input.message.trim();
    if (message.length < 5) {
      return { success: false, error: "Message is too short." };
    }
    const ids = [...new Set(input.customerIds)].filter((n) => Number.isInteger(n));
    if (ids.length === 0) {
      return { success: false, error: "Select at least one recipient." };
    }
    if (ids.length > MAX_BLAST) {
      return {
        success: false,
        error: `Too many recipients — max ${MAX_BLAST} per blast. Split it into smaller batches.`,
      };
    }

    const picked = await db
      .select()
      .from(customers)
      .where(inArray(customers.id, ids));
    const valid = picked.filter((c) => c.phone && c.phone.trim());
    if (valid.length === 0) {
      return { success: false, error: "None of the selected customers have a phone number." };
    }

    const settings = await getWaTemplateSettings();
    const provider = getWaProvider();

    const [campaign] = await db
      .insert(waPromoCampaigns)
      .values({
        title:          input.title?.trim() || null,
        message,
        provider,
        status:         provider === "fonnte" ? "sending" : "draft",
        recipientCount: valid.length,
        createdBy:      user.email ?? null,
      })
      .returning({ id: waPromoCampaigns.id });

    await db.insert(waPromoRecipients).values(
      valid.map((c) => ({
        campaignId: campaign.id,
        customerId: c.id,
        name:       c.name,
        phone:      c.phone,
        status:     "pending" as const,
      })),
    );

    // ── Manual mode — hand back the links, leave status "draft" ──────────────
    if (provider === "manual") {
      const links = valid.map((c) => ({
        name:  c.name,
        phone: c.phone,
        url:   waMeLink(c.phone, renderMessage(message, c.name, settings)),
      }));
      revalidatePath("/admin/wa-promo");
      return { success: true, campaignId: campaign.id, provider, links };
    }

    // ── Fonnte mode — push through the API ──────────────────────────────────
    const recips = await db
      .select()
      .from(waPromoRecipients)
      .where(eq(waPromoRecipients.campaignId, campaign.id));

    let sent = 0;
    let failed = 0;

    const markSent = (id: number) =>
      db
        .update(waPromoRecipients)
        .set({ status: "sent", sentAt: new Date(), error: null })
        .where(eq(waPromoRecipients.id, id));

    const markFailed = (id: number, err: string) =>
      db
        .update(waPromoRecipients)
        .set({ status: "failed", error: err.slice(0, 500) })
        .where(eq(waPromoRecipients.id, id));

    if (!PERSONAL_TOKEN_RE.test(message)) {
      // Identical body for everyone → one call per 100 numbers.
      const body = renderMessage(message, "", settings);
      for (const group of chunk(recips, 100)) {
        const target = group.map((r) => toWaNumber(r.phone)).join(",");
        const res = await sendViaFonnte(target, body);
        for (const r of group) {
          if (res.ok) {
            sent += 1;
            await markSent(r.id);
          } else {
            failed += 1;
            await markFailed(r.id, res.error ?? "Unknown error");
          }
        }
      }
    } else {
      // Personalised → send in small parallel batches.
      for (const group of chunk(recips, 8)) {
        await Promise.all(
          group.map(async (r) => {
            const res = await sendViaFonnte(
              toWaNumber(r.phone),
              renderMessage(message, r.name, settings),
            );
            if (res.ok) {
              sent += 1;
              await markSent(r.id);
            } else {
              failed += 1;
              await markFailed(r.id, res.error ?? "Unknown error");
            }
          }),
        );
      }
    }

    await db
      .update(waPromoCampaigns)
      .set({
        status:      failed === recips.length ? "failed" : "sent",
        sentCount:   sent,
        failedCount: failed,
        sentAt:      new Date(),
      })
      .where(eq(waPromoCampaigns.id, campaign.id));

    revalidatePath("/admin/wa-promo");
    return { success: true, campaignId: campaign.id, provider, sent, failed };
  } catch (err) {
    console.error("[createPromoBlast]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send the blast.",
    };
  }
}

// ─── Manual mode: mark a draft as sent once the admin has clicked through ─────

export async function markPromoSent(
  campaignId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { success: false, error: "Not authorized." };
  }
  try {
    const [c] = await db
      .select()
      .from(waPromoCampaigns)
      .where(eq(waPromoCampaigns.id, campaignId))
      .limit(1);
    if (!c) return { success: false, error: "Campaign not found." };

    await db
      .update(waPromoCampaigns)
      .set({ status: "sent", sentAt: new Date(), sentCount: c.recipientCount })
      .where(eq(waPromoCampaigns.id, campaignId));
    await db
      .update(waPromoRecipients)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(waPromoRecipients.campaignId, campaignId));

    revalidatePath("/admin/wa-promo");
    return { success: true };
  } catch (err) {
    console.error("[markPromoSent]", err);
    return { success: false, error: "Failed to update the campaign." };
  }
}

// ─── Test send (Fonnte only) ─────────────────────────────────────────────────

export async function sendPromoTest(
  phone:   string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { success: false, error: "Not authorized." };
  }

  if (getWaProvider() !== "fonnte") {
    return {
      success: false,
      error: "Test send needs Fonnte configured. In manual mode, use a wa.me link instead.",
    };
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) {
    return { success: false, error: "Enter a valid phone number (with country code)." };
  }

  const settings = await getWaTemplateSettings();
  const text = renderMessage(
    message.trim() || "Test mensajen husi {{businessName}} ✅",
    "Test",
    settings,
  );
  const res = await sendViaFonnte(toWaNumber(phone), text);
  return res.ok ? { success: true } : { success: false, error: res.error };
}

// ─── Saved templates ─────────────────────────────────────────────────────────
// A template is just a named message (plus an optional campaign title) the admin
// can load back into the composer. Placeholders are kept as typed.

export interface PromoTemplateRow {
  id:        number;
  name:      string;
  title:     string | null;
  message:   string;
  updatedAt: string;
}

const TEMPLATE_NAME_MAX = 60;

function toTemplateRow(t: typeof waPromoTemplates.$inferSelect): PromoTemplateRow {
  return {
    id:        t.id,
    name:      t.name,
    title:     t.title,
    message:   t.message,
    updatedAt: new Date(t.updatedAt).toISOString(),
  };
}

export async function getPromoTemplates(): Promise<PromoTemplateRow[]> {
  try {
    await requireAdmin();
    const rows = await db
      .select()
      .from(waPromoTemplates)
      .orderBy(desc(waPromoTemplates.updatedAt));
    return rows.map(toTemplateRow);
  } catch (err) {
    // Also covers the table not existing yet (migration pending) — the composer
    // still works, it just starts with no saved templates.
    console.error("[getPromoTemplates]", err);
    return [];
  }
}

export async function savePromoTemplate(input: {
  name:    string;
  title?:  string;
  message: string;
}): Promise<{ success: boolean; error?: string; template?: PromoTemplateRow; replaced?: boolean }> {
  let user: { email?: string | null } = {};
  try {
    user = await requireAdmin();
  } catch {
    return { success: false, error: "You must be signed in as an admin." };
  }

  const name    = input.name.trim().replace(/\s+/g, " ");
  const message = input.message.trim();
  const title   = input.title?.trim() || null;
  if (!name)                          return { success: false, error: "Give the template a name." };
  if (name.length > TEMPLATE_NAME_MAX) return { success: false, error: `Keep the name under ${TEMPLATE_NAME_MAX} characters.` };
  if (!message)                       return { success: false, error: "Write a message before saving it as a template." };

  try {
    // Same name (ignoring case) → replace that template instead of adding a twin.
    const [existing] = await db
      .select({ id: waPromoTemplates.id })
      .from(waPromoTemplates)
      .where(sql`lower(${waPromoTemplates.name}) = lower(${name})`)
      .limit(1);

    const [row] = existing
      ? await db
          .update(waPromoTemplates)
          .set({ name, title, message, updatedAt: new Date() })
          .where(eq(waPromoTemplates.id, existing.id))
          .returning()
      : await db
          .insert(waPromoTemplates)
          .values({ name, title, message, createdBy: user.email ?? null })
          .returning();

    revalidatePath("/admin/wa-promo");
    return { success: true, template: toTemplateRow(row), replaced: !!existing };
  } catch (err) {
    console.error("[savePromoTemplate]", err);
    return { success: false, error: "Failed to save the template." };
  }
}

export async function deletePromoTemplate(
  id: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { success: false, error: "Not authorized." };
  }
  try {
    await db.delete(waPromoTemplates).where(eq(waPromoTemplates.id, id));
    revalidatePath("/admin/wa-promo");
    return { success: true };
  } catch (err) {
    console.error("[deletePromoTemplate]", err);
    return { success: false, error: "Failed to delete the template." };
  }
}

// ─── History ─────────────────────────────────────────────────────────────────

export interface PromoCampaignRow {
  id:             number;
  title:          string | null;
  message:        string;
  provider:       string;
  status:         string;
  recipientCount: number;
  sentCount:      number;
  failedCount:    number;
  createdBy:      string | null;
  createdAt:      string;
  sentAt:         string | null;
}

export async function getPromoCampaigns(): Promise<PromoCampaignRow[]> {
  const rows = await db
    .select()
    .from(waPromoCampaigns)
    .orderBy(desc(waPromoCampaigns.createdAt))
    .limit(50);

  return rows.map((c) => ({
    id:             c.id,
    title:          c.title,
    message:        c.message,
    provider:       c.provider,
    status:         c.status,
    recipientCount: c.recipientCount,
    sentCount:      c.sentCount,
    failedCount:    c.failedCount,
    createdBy:      c.createdBy,
    createdAt:      new Date(c.createdAt).toISOString(),
    sentAt:         c.sentAt ? new Date(c.sentAt).toISOString() : null,
  }));
}

export async function deletePromoCampaign(
  campaignId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { success: false, error: "Not authorized." };
  }
  try {
    await db.delete(waPromoCampaigns).where(eq(waPromoCampaigns.id, campaignId));
    revalidatePath("/admin/wa-promo");
    return { success: true };
  } catch {
    return { success: false, error: "Failed to delete the campaign." };
  }
}

// lib/db/schema/whatsapp.ts
//
// WhatsApp message template schema.
// Allows admin to customise the notification messages sent to customers
// via WhatsApp when order status changes.
//
// Available placeholder variables (used inside template fields):
//   {{customerName}}    — customer's name
//   {{orderNumber}}     — e.g. AK-20260329-001
//   {{servicesSummary}} — comma-separated service names
//   {{statusLabel}}     — human-readable status label
//   {{totalPrice}}      — formatted price e.g. $12.50
//   {{paymentLine}}     — auto-generated payment status line
//   {{reviewUrl}}       — link to the review page
//   {{notes}}           — order notes (only rendered if present)
//   {{cashierName}}     — name of the logged-in employee sending the message
//   {{clothesCount}}    — recorded clothes count, one line per item + total
//   {{clothesTotal}}    — total pieces counted, e.g. "13 pcs"
//                         (lines using either are dropped when nothing was counted)
//   {{businessName}}    — from settings
//   {{businessPhone}}   — from settings
//   {{businessUrl}}     — from settings
//   {{greeting}}        — auto-picked by time of day (morning/afternoon/evening),
//                         text customisable per time-of-day in settings below

import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";

// ── Re-declare the same Postgres enum defined in index.ts ─────────────────────
// We reference it here instead of importing from "./index" to avoid a
// circular dependency (index.ts re-exports * from this file).
// The enum name "order_status" and values MUST match the one in index.ts.
const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "processing",
  "done",
  "picked_up",
]);

// ─── WhatsApp Template Settings (global, single row) ──────────────────────────
// Controls the greeting, footer, and business info shared across all templates.

export const waTemplateSettings = pgTable("wa_template_settings", {
  id: serial("id").primaryKey(),

  // Business info shown in footer
  businessName:  text("business_name").notNull().default("Akiro Laundry"),
  businessPhone: text("business_phone").notNull().default("+670 7675 8 7380"),
  businessUrl:   text("business_url").notNull().default("akirolaundry.com"),

  // Greeting template (top of message)
  greetingTemplate: text("greeting_template")
    .notNull()
    .default(
      "Ola Sr/a *{{customerName}}*,\nAmi husi *{{businessName}}* hakarak informa kona-ba ita-nia pedidu foun.",
    ),

  // Time-of-day greeting text — auto-selected at send time based on the
  // sender's local clock and exposed as {{greeting}}. Not inserted into any
  // message automatically; the admin opts in by typing the token themselves
  // (same convention as {{paymentLine}}).
  greetingMorning:   text("greeting_morning").notNull().default("Bondia"),
  greetingAfternoon: text("greeting_afternoon").notNull().default("Botarde"),
  greetingEvening:   text("greeting_evening").notNull().default("Bonoite"),

  // Order detail header
  orderDetailHeader: text("order_detail_header")
    .notNull()
    .default("🧾 *DETALLU PEDIDU*"),

  // Order detail body — the actual order-number/services/status/total/payment lines.
  // Fully editable/removable; supports {{orderNumber}}, {{servicesSummary}}, {{statusLabel}},
  // {{totalPrice}}, {{paymentLine}} placeholders.
  orderDetailBody: text("order_detail_body")
    .notNull()
    .default(
      "📌 *N.º Pedidu:*  {{orderNumber}}\n👕 *Servisu:*     {{servicesSummary}}\n📦 *Status:*      *{{statusLabel}}*\n💰 *Total:*       {{totalPrice}}\n{{paymentLine}}",
    ),

  // Footer template (bottom of message)
  footerTemplate: text("footer_template")
    .notNull()
    .default("{{businessName}}\n📞 {{businessPhone}}\n🌐 {{businessUrl}}"),

  // Review CTA
  reviewCtaTemplate: text("review_cta_template")
    .notNull()
    .default(
      "⭐ *Kontenti ho ami-nia servisu?*\nHusik review ida iha: {{reviewUrl}}\nObrigadu barak! 🙏",
    ),

  // Payment line templates
  paymentPaidTemplate: text("payment_paid_template")
    .notNull()
    .default("✅ *Pagamentu:* Kompletu ona"),

  paymentUnpaidTemplate: text("payment_unpaid_template")
    .notNull()
    .default(
      "⚠️ *Pagamentu:* Seidauk selu — favor prepara {{totalPrice}} bainhira mai foti",
    ),

  // Notes section header (only shown if order has notes)
  notesSectionHeader: text("notes_section_header")
    .notNull()
    .default("📝 *NOTA ESPESIAL*"),

  // Separator character/line
  separator: text("separator")
    .notNull()
    .default("─────────────────────────"),

  isActive:  boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── WhatsApp Status Templates (one per order status) ─────────────────────────
// Each status has its own body lines that describe what's happening with the order.

export const waStatusTemplates = pgTable("wa_status_templates", {
  id: serial("id").primaryKey(),

  // Which order status this template is for
  status: orderStatusEnum("status").notNull().unique(),

  // The body text lines for this status (supports multiple lines via \n)
  bodyTemplate: text("body_template").notNull(),

  // Sort order (for admin UI display)
  sortOrder: integer("sort_order").notNull().default(0),

  isActive:  boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── WhatsApp Promo Blasts ───────────────────────────────────────────────────
// A "promo blast" = one marketing message sent to many registered customers at
// once. Each blast is one `wa_promo_campaigns` row; every targeted customer is
// one `wa_promo_recipients` row so we keep a per-person delivery log.
//
// Message placeholders (substituted per recipient at send time):
//   {{customerName}} — customer's full name
//   {{firstName}}    — first word of the name
//   {{businessName}} — from wa_template_settings
//   {{businessPhone}}— from wa_template_settings
//   {{businessUrl}}  — from wa_template_settings

export const waPromoCampaigns = pgTable("wa_promo_campaigns", {
  id: serial("id").primaryKey(),

  // Optional short label so the history list is scannable ("Ramadan 20% off").
  title: text("title"),

  // The raw message body, WITH {{placeholders}} still in it.
  message: text("message").notNull(),

  // "manual" — links generated for the admin to click / broadcast by hand.
  // "fonnte" — pushed through the Fonnte HTTP API.
  provider: text("provider").notNull().default("manual"),

  // "draft" | "sending" | "sent" | "failed"
  status: text("status").notNull().default("draft"),

  recipientCount: integer("recipient_count").notNull().default(0),
  sentCount:      integer("sent_count").notNull().default(0),
  failedCount:    integer("failed_count").notNull().default(0),

  // Email of the admin who created the blast (from the auth session).
  createdBy: text("created_by"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt:    timestamp("sent_at"),
});

export const waPromoRecipients = pgTable("wa_promo_recipients", {
  id: serial("id").primaryKey(),

  campaignId: integer("campaign_id")
    .references(() => waPromoCampaigns.id, { onDelete: "cascade" })
    .notNull(),

  // Snapshot of who we sent to — kept even if the customer is later edited or
  // deleted. customerId is a soft link (no FK) for the same reason.
  customerId: integer("customer_id"),
  name:       text("name").notNull(),
  phone:      text("phone").notNull(), // E.164, as stored on the customer

  // "pending" | "sent" | "failed" | "skipped"
  status: text("status").notNull().default("pending"),

  // Provider error text, when status = "failed".
  error: text("error"),

  sentAt: timestamp("sent_at"),
});

// ─── WhatsApp Promo Templates ────────────────────────────────────────────────
// Saved message bodies the admin can reuse for future blasts. Placeholders
// ({{firstName}} …) stay in the text and are filled per recipient at send time.

export const waPromoTemplates = pgTable("wa_promo_templates", {
  id: serial("id").primaryKey(),

  // What the admin calls it in the picker ("Ramadan 20% off"). Unique, so
  // saving under an existing name replaces that template.
  name: text("name").notNull().unique(),

  // Optional default campaign title for the history list.
  title: text("title"),

  // The raw message body, WITH {{placeholders}} still in it.
  message: text("message").notNull(),

  // Email of the admin who saved it (from the auth session).
  createdBy: text("created_by"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Exported Types ───────────────────────────────────────────────────────────

export type WaTemplateSettings    = typeof waTemplateSettings.$inferSelect;
export type NewWaTemplateSettings = typeof waTemplateSettings.$inferInsert;
export type WaStatusTemplate      = typeof waStatusTemplates.$inferSelect;
export type NewWaStatusTemplate   = typeof waStatusTemplates.$inferInsert;
export type WaPromoCampaign       = typeof waPromoCampaigns.$inferSelect;
export type NewWaPromoCampaign    = typeof waPromoCampaigns.$inferInsert;
export type WaPromoRecipient      = typeof waPromoRecipients.$inferSelect;
export type NewWaPromoRecipient   = typeof waPromoRecipients.$inferInsert;
export type WaPromoTemplate       = typeof waPromoTemplates.$inferSelect;
export type NewWaPromoTemplate    = typeof waPromoTemplates.$inferInsert;
// lib/db/schema/index.ts

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  timestamp,
  boolean,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "processing",
  "done",
  "picked_up",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "partial",
  "paid",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "transfer",
  "qris",
]);

export const transactionDirectionEnum = pgEnum("transaction_direction", [
  "income",
  "outcome",
]);

// ─── Role Enum + Roles Table ──────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["admin", "employee", "user"]);

export const roles = pgTable("roles", {
  id:          serial("id").primaryKey(),
  name:        userRoleEnum("name").notNull().unique(),
  description: text("description").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull(),
  email:     text("email").notNull().unique(),
  password:  text("password").notNull(),
  role:      userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Customers ────────────────────────────────────────────────────────────────
export const customers = pgTable("customers", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull(),
  phone:     text("phone").notNull().unique(),
  address:   text("address").notNull(),
  // How the customer first heard about Akiro — optional, captured at order time.
  // "Facebook" | "Tiktok" | "Belun" | "Banner/Brosur" (free text, nullable).
  referralSource: text("referral_source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Soaps (Deterjen) ─────────────────────────────────────────────────────────
export const soaps = pgTable("soaps", {
  id:         serial("id").primaryKey(),
  name:       text("name").notNull(),
  brand:      text("brand"),
  pricePerKg: numeric("price_per_kg", { precision: 10, scale: 2 }).notNull(),
  isActive:   boolean("is_active").default(true).notNull(),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

// ─── Pewangi (Fabric Softener) ────────────────────────────────────────────────
export const pewangi = pgTable("pewangi", {
  id:         serial("id").primaryKey(),
  name:       text("name").notNull(),
  brand:      text("brand"),
  pricePerKg: numeric("price_per_kg", { precision: 10, scale: 2 }).notNull(),
  isActive:   boolean("is_active").default(true).notNull(),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

// ─── Service Pricing ──────────────────────────────────────────────────────────
export const servicePricing = pgTable("service_pricing", {
  id:             serial("id").primaryKey(),
  name:           text("name").notNull(),
  basePricePerKg: numeric("base_price_per_kg", { precision: 10, scale: 2 }).notNull(),
  category:       text("category").notNull().default("package"),
  pricingUnit:    text("pricing_unit").notNull().default("per_kg"), // "per_kg" | "per_pcs"
  minimumKg:      text("minimum_kg"),
  duration:       text("duration"),
  notes:          text("notes"),
  isActive:       boolean("is_active").default(true).notNull(),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  // Null until the first edit — presence of a value marks the service as "edited".
  updatedAt:      timestamp("updated_at"),
});

// ─── Orders ───────────────────────────────────────────────────────────────────
// Top-level order record. Service details live in `order_items`.
// Legacy single-service columns (servicePricingId, weightKg, basePricePerKg,
// soapCost, pewangiCost) are REMOVED — everything is now in order_items.
export const orders = pgTable("orders", {
  id:          serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId:  integer("customer_id").references(() => customers.id).notNull(),

  // ── Totals (sum of all items) ──
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),

  // ── Payment ──
  paymentStatus: paymentStatusEnum("payment_status").default("unpaid").notNull(),
  paymentMethod: paymentMethodEnum("payment_method"),
  amountPaid:    numeric("amount_paid",  { precision: 10, scale: 2 }),
  changeGiven:   numeric("change_given", { precision: 10, scale: 2 }),
  paidAt:        timestamp("paid_at"),

  // ── Order status ──
  status:          orderStatusEnum("status").default("pending").notNull(),
  notes:           text("notes"),
  estimatedDoneAt: timestamp("estimated_done_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),

  // ── Edit tracking ──
  // Bumped only by updateOrder() (correcting customer/items/notes) — status
  // changes and payment do NOT increment this. Drives the "Edited ×N" badge.
  editCount: integer("edit_count").default(0).notNull(),
  // Last time the order was changed (items, customer, notes or special
  // requests) while a payment — full or DP — was already on file. Such edits
  // never touch the cash register. Once set, `amountPaid` holds exactly the
  // money applied to the order (see lib/utils/order-payment.ts); null means the
  // order hasn't been edited since it was paid.
  editedAfterPaymentAt: timestamp("edited_after_payment_at"),

  // ── Clothes count ──
  // How the pieces were counted at drop-off: "customer" = counted together
  // with the customer (printed on the receipt), "staff" = the customer left
  // them with us and staff count afterwards (never printed). Null for orders
  // created before this existed. Counts live in `order_clothing_counts`.
  clothesCountMode: text("clothes_count_mode"),

  // ── Created by ──
  // Name of the logged-in staff member who created the order, read from the
  // session in createOrder(). A plain-text snapshot rather than a users FK, so
  // deleting the account later doesn't erase who took the order. Null for
  // orders that predate this column.
  createdByName: text("created_by_name"),
});

// ─── Order Items ──────────────────────────────────────────────────────────────
// One row per service line within an order.
// • Clothes service  → pricingUnit = "per_kg",  weightKg = X, quantity = null
// • Shoes service    → pricingUnit = "per_pcs", weightKg = null, quantity = N
// Both can coexist in the same order.
export const orderItems = pgTable("order_items", {
  id:               serial("id").primaryKey(),
  orderId:          integer("order_id").references(() => orders.id, { onDelete: "cascade" }).notNull(),
  servicePricingId: integer("service_pricing_id").references(() => servicePricing.id).notNull(),

  // ── Quantity fields — only one will be set depending on pricingUnit ──
  weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),   // set when pricingUnit = "per_kg"
  quantity: integer("quantity"),                                  // set when pricingUnit = "per_pcs"

  // ── Add-ons (per-item so shoes can skip soap/pewangi) ──
  soapId:    integer("soap_id").references(() => soaps.id),
  pewangiId: integer("pewangi_id").references(() => pewangi.id),

  // ── Snapshotted prices at time of order ──
  basePricePerKg: numeric("base_price_per_kg", { precision: 10, scale: 2 }).notNull(),
  soapCost:       numeric("soap_cost",    { precision: 10, scale: 2 }).default("0"),
  pewangiCost:    numeric("pewangi_cost", { precision: 10, scale: 2 }).default("0"),
  subtotal:       numeric("subtotal",     { precision: 10, scale: 2 }).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Order Special Requests ───────────────────────────────────────────────────
// Free-text requests attached to an order after it's been created. Each one
// can nudge the order total up or down (priceAdjustment may be negative).
export const orderSpecialRequests = pgTable("order_special_requests", {
  id:              serial("id").primaryKey(),
  orderId:         integer("order_id").references(() => orders.id, { onDelete: "cascade" }).notNull(),
  description:     text("description").notNull(),
  priceAdjustment: numeric("price_adjustment", { precision: 10, scale: 2 }).notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

// ─── Clothing Items (clothes count) ───────────────────────────────────────────
// The kinds of pieces staff count at drop-off (Baju, Celana, Sepatu, …).
// Admin-editable on the Services page.
export const clothingItems = pgTable("clothing_items", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull().unique(),
  sortOrder: integer("sort_order").default(0).notNull(),
  // Inactive items are hidden from new counts but stay readable on old orders.
  isActive:  boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Which clothing items to count for each service (many-to-many).
export const serviceClothingItems = pgTable("service_clothing_items", {
  id:             serial("id").primaryKey(),
  serviceId:      integer("service_id").references(() => servicePricing.id, { onDelete: "cascade" }).notNull(),
  clothingItemId: integer("clothing_item_id").references(() => clothingItems.id, { onDelete: "cascade" }).notNull(),
}, (t) => [unique("service_clothing_items_pair").on(t.serviceId, t.clothingItemId)]);

// Pieces counted for an order. `name` is a snapshot so renaming or deleting a
// clothing item never changes what an old order (or its receipt) says.
export const orderClothingCounts = pgTable("order_clothing_counts", {
  id:             serial("id").primaryKey(),
  orderId:        integer("order_id").references(() => orders.id, { onDelete: "cascade" }).notNull(),
  clothingItemId: integer("clothing_item_id").references(() => clothingItems.id, { onDelete: "set null" }),
  name:           text("name").notNull(),
  quantity:       integer("quantity").notNull(),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

// ─── Cash Register ────────────────────────────────────────────────────────────
export const cashRegister = pgTable("cash_register", {
  id:            serial("id").primaryKey(),
  balance:       numeric("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  notes:         text("notes"),
});

export const expenseCategories = pgTable("expense_categories", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull().unique(),       // e.g. "Store Improvement", "Supplies"
  description: text("description"),
  color:       text("color").default("#64748b"),      // hex for UI badge coloring
  // Which side of the ledger this category applies to — controls which
  // categories the Buku Kecil entry form offers. "income" | "expense" | "both".
  kind:        text("kind").notNull().default("expense"),
  // Admin switch: may staff pick this category when adding an expense on the
  // employee Cash Register? Only meaningful for kind "expense" | "both".
  employeeEnabled: boolean("employee_enabled").notNull().default(true),
  // No isActive — categories are hard-deleted. Past transactions retain categoryId
  // which resolves to null via ON DELETE SET NULL on the FK.
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ─── Finance Pie Configs ──────────────────────────────────────────────────────
// Backs the 3 customizable pie charts on the Buku Besar page. Each row is one
// chart slot (1-3); `categoryKeys` is a comma-separated list of recap keys
// (e.g. "inc:orders,exp:change,exp:cat:4").
export const financePieConfigs = pgTable("finance_pie_configs", {
  id:           serial("id").primaryKey(),
  slot:         integer("slot").notNull().unique(),   // 1 | 2 | 3
  title:        text("title").notNull(),
  categoryKeys: text("category_keys").notNull().default(""),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});

// ─── Cash Register Transactions ───────────────────────────────────────────────
export const cashRegisterTransactions = pgTable("cash_register_transactions", {
  id:           serial("id").primaryKey(),
 
  // ✦ NEW — direction: income (money in) or outcome (money out)
  direction:    transactionDirectionEnum("direction").notNull().default("income"),
 
  amount:       numeric("amount", { precision: 12, scale: 2 }).notNull(),
  // amount is always stored as POSITIVE; direction field tells you in/out
 
  type: text("type").notNull(),
  // "payment_in" | "change_out" | "manual_adjustment" | "initial" | "manual_income" | "manual_outcome"
  // A cash sale books BOTH: "payment_in" for the full amount tendered and
  // "change_out" for the change returned (net drawer effect = the sale price).
  // The cash-register menu shows both rows; the finance pages (Buku Kecil /
  // Buku Besar) net the pair back down to the revenue — see lib/actions/finance.ts.
 
  // ✦ NEW — category (required for manual_outcome type, null for payment_in/change_out/adjustments)
  // ON DELETE SET NULL so hard-deleting a category doesn't break ledger history
  categoryId:   integer("category_id").references(() => expenseCategories.id, { onDelete: "set null" }),
 
  orderId:      integer("order_id").references(() => orders.id),
  description:  text("description").notNull(),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }).notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

// ─── Marketing Campaigns ──────────────────────────────────────────────────────
// One row per ad / marketing campaign. Drives the Marketing & ROAS page: the
// business outcomes (new customers, revenue, orders, top services) are derived
// live from the campaign's date window — nothing is denormalised here.
export const marketingCampaigns = pgTable("marketing_campaigns", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull(),
  channel:   text("channel").notNull(), // "facebook" | "tiktok" | "banner" | "belun" | "other"
  spend:     numeric("spend", { precision: 12, scale: 2 }).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate:   timestamp("end_date").notNull(),
  notes:     text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Relations ────────────────────────────────────────────────────────────────
export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields:     [orders.customerId],
    references: [customers.id],
  }),
  items:           many(orderItems),
  specialRequests: many(orderSpecialRequests),
}));

export const orderSpecialRequestsRelations = relations(orderSpecialRequests, ({ one }) => ({
  order: one(orders, {
    fields:     [orderSpecialRequests.orderId],
    references: [orders.id],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields:     [orderItems.orderId],
    references: [orders.id],
  }),
  servicePricing: one(servicePricing, {
    fields:     [orderItems.servicePricingId],
    references: [servicePricing.id],
  }),
  soap: one(soaps, {
    fields:     [orderItems.soapId],
    references: [soaps.id],
  }),
  pewangi: one(pewangi, {
    fields:     [orderItems.pewangiId],
    references: [pewangi.id],
  }),
}));

export const expenseCategoriesRelations = relations(expenseCategories, ({ many }) => ({
  transactions: many(cashRegisterTransactions),
}));
 
// ✦ UPDATED — extend your existing cashRegisterTransactionsRelations
export const cashRegisterTransactionsRelations = relations(
  cashRegisterTransactions,
  ({ one }) => ({
    order: one(orders, {
      fields:     [cashRegisterTransactions.orderId],
      references: [orders.id],
    }),
    // ✦ NEW
    category: one(expenseCategories, {
      fields:     [cashRegisterTransactions.categoryId],
      references: [expenseCategories.id],
    }),
  }),
);

// ─── Exported Types ───────────────────────────────────────────────────────────
export type UserRole = typeof userRoleEnum.enumValues[number];
export type Role     = typeof roles.$inferSelect;

export type User               = typeof users.$inferSelect;
export type NewUser            = typeof users.$inferInsert;
export type Customer           = typeof customers.$inferSelect;
export type NewCustomer        = typeof customers.$inferInsert;
export type Soap               = typeof soaps.$inferSelect;
export type NewSoap            = typeof soaps.$inferInsert;
export type Pewangi            = typeof pewangi.$inferSelect;
export type NewPewangi         = typeof pewangi.$inferInsert;
export type ServicePricing     = typeof servicePricing.$inferSelect;
export type NewServicePricing  = typeof servicePricing.$inferInsert;
export type Order              = typeof orders.$inferSelect;
export type NewOrder           = typeof orders.$inferInsert;
export type OrderItem          = typeof orderItems.$inferSelect;
export type NewOrderItem       = typeof orderItems.$inferInsert;
export type OrderSpecialRequest    = typeof orderSpecialRequests.$inferSelect;
export type NewOrderSpecialRequest = typeof orderSpecialRequests.$inferInsert;
export type CashRegister            = typeof cashRegister.$inferSelect;
export type ExpenseCategory    = typeof expenseCategories.$inferSelect;
export type NewExpenseCategory = typeof expenseCategories.$inferInsert;
export type FinancePieConfig    = typeof financePieConfigs.$inferSelect;
export type NewFinancePieConfig = typeof financePieConfigs.$inferInsert;
export type CashRegisterTransaction = typeof cashRegisterTransactions.$inferSelect;
export type MarketingCampaign    = typeof marketingCampaigns.$inferSelect;
export type NewMarketingCampaign = typeof marketingCampaigns.$inferInsert;
export type ClothingItem         = typeof clothingItems.$inferSelect;
export type OrderClothingCount   = typeof orderClothingCounts.$inferSelect;

export * from "./cms";
export * from "./whatsapp";
export * from "./receipt";
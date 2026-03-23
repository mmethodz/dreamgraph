/**
 * enrich-graph.mjs — Example graph enrichment script for DreamGraph.
 *
 * This script adds domain labels, keywords, and cross-links to your
 * knowledge graph data files (features.json, workflows.json, data_model.json).
 *
 * The cognitive engine uses these links + keywords to:
 *   1. Build a FactSnapshot of your system
 *   2. Dream speculative connections between entities
 *   3. Normalize dreams into validated/latent/rejected categories
 *   4. Detect tensions (contradictions, missing links, weak spots)
 *
 * Customize this script for YOUR system by:
 *   - Updating the domainMap with your entity IDs
 *   - Defining featureLinks with cross-references between your entities
 *   - Adding keywords that help the dreamer find related concepts
 *
 * Run: node scripts/enrich-graph.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");

const read = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));
const write = (f, d) =>
  writeFileSync(join(DATA, f), JSON.stringify(d, null, 2) + "\n", "utf8");

// ─── Load ────────────────────────────────────────────────────────────────────
let features = read("features.json");
let workflows = read("workflows.json");
let dataModel = read("data_model.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a link object for the knowledge graph.
 * @param {string} target - Target entity ID
 * @param {string} type - Entity type: "feature" | "workflow" | "data_model"
 * @param {string} relationship - Verb describing the relationship
 * @param {string} description - Human-readable explanation
 * @param {string} strength - "strong" | "moderate" | "weak"
 * @param {object} meta - Optional metadata (direction, table, api_route, see_also)
 */
const link = (target, type, relationship, description, strength = "strong", meta) => ({
  target,
  type,
  relationship,
  description,
  strength,
  ...(meta ? { meta } : {}),
});

/** Create a see_also nested reference. */
const seeAlso = (target, type, hint) => ({ target, type, hint });

// ─── Domain map ──────────────────────────────────────────────────────────────
// Maps every entity ID to a domain label. The cognitive engine uses domains
// for grouping, tension categorisation, and dream strategy selection.
const domainMap = {
  // Features
  book_catalog: "storefront",
  shopping_cart: "storefront",
  order_management: "fulfillment",
  user_auth: "auth",
  inventory_tracking: "fulfillment",
  payment_processing: "billing",
  review_system: "engagement",
  recommendation_engine: "engagement",
  admin_dashboard: "admin",
  email_notifications: "integration",
  // Data model
  book: "storefront",
  user: "auth",
  order: "fulfillment",
  order_item: "fulfillment",
  review: "engagement",
  discount_code: "billing",
  // Workflows
  checkout_flow: "storefront",
  review_moderation: "engagement",
  inventory_reorder: "fulfillment",
};

// ─── Keywords map ────────────────────────────────────────────────────────────
// Keywords help the dreamer find related entities by shared concepts.
const keywordsMap = {
  book_catalog: ["browse", "search", "filter", "genre", "catalog", "inventory"],
  shopping_cart: ["cart", "add", "remove", "quantity", "discount", "checkout"],
  order_management: ["order", "status", "shipped", "delivered", "cancelled", "refund"],
  user_auth: ["login", "signup", "jwt", "password", "session", "email"],
  inventory_tracking: ["stock", "reorder", "warehouse", "threshold", "quantity"],
  payment_processing: ["stripe", "payment", "credit-card", "refund", "webhook"],
  review_system: ["rating", "stars", "comment", "moderation", "approval"],
  recommendation_engine: ["collaborative-filtering", "personalization", "history"],
  admin_dashboard: ["admin", "analytics", "management", "reports"],
  email_notifications: ["email", "transactional", "template", "notification"],
  book: ["isbn", "author", "title", "price", "genre", "published"],
  user: ["email", "role", "customer", "admin", "account"],
  order: ["total", "status", "payment", "shipping", "lifecycle"],
  order_item: ["quantity", "unit_price", "line_item"],
  review: ["rating", "comment", "approved", "moderation"],
  discount_code: ["code", "percent", "expiry", "promotion", "coupon"],
  checkout_flow: ["cart", "payment", "address", "confirmation", "stripe"],
  review_moderation: ["approve", "reject", "spam", "queue"],
  inventory_reorder: ["threshold", "alert", "stock", "reorder"],
};

// ─── Feature cross-links ────────────────────────────────────────────────────
// These define how features, data models, and workflows relate to each other.
// The cognitive engine builds its FactSnapshot from these links.
const featureLinks = {
  book_catalog: [
    link("book", "data_model", "reads", "Queries books table with filters for genre, author, price, availability", "strong", { table: "books" }),
    link("recommendation_engine", "feature", "enhanced_by", "Personalized recommendations shown alongside catalog browsing", "moderate"),
    link("shopping_cart", "feature", "feeds_into", "Add-to-cart buttons on catalog items", "strong"),
    link("admin_dashboard", "feature", "managed_by", "Admin manages book listings and inventory", "moderate"),
  ],
  shopping_cart: [
    link("book", "data_model", "reads", "Cart items reference books for price and stock validation", "strong"),
    link("discount_code", "data_model", "reads", "Validates and applies discount codes at checkout", "moderate"),
    link("checkout_flow", "workflow", "triggers", "Proceed to checkout initiates the checkout workflow", "strong"),
  ],
  order_management: [
    link("order", "data_model", "manages", "Full CRUD for orders with status lifecycle", "strong"),
    link("order_item", "data_model", "manages", "Line items within each order", "strong"),
    link("checkout_flow", "workflow", "created_by", "Orders created as final step of checkout", "strong"),
    link("email_notifications", "feature", "triggers", "Order status changes trigger email notifications", "strong"),
    link("payment_processing", "feature", "depends_on", "Payment must succeed before order is confirmed", "strong"),
    link("inventory_tracking", "feature", "triggers", "Order placement decrements stock and may trigger reorder alert", "strong"),
  ],
  user_auth: [
    link("user", "data_model", "authenticates", "JWT-based auth linked via user.id", "strong"),
    link("email_notifications", "feature", "uses", "Password reset emails sent via notification service", "moderate"),
  ],
  inventory_tracking: [
    link("book", "data_model", "monitors", "Tracks stock_count on books table", "strong", { table: "books" }),
    link("inventory_reorder", "workflow", "triggers", "Low stock triggers reorder alert workflow", "strong"),
    link("admin_dashboard", "feature", "displayed_in", "Stock levels visible in admin dashboard", "moderate"),
  ],
  payment_processing: [
    link("order", "data_model", "updates", "Sets stripe_payment_intent_id and status=paid on order", "strong"),
    link("checkout_flow", "workflow", "part_of", "Steps 4-5 of checkout: create intent + confirm payment", "strong"),
    link("discount_code", "data_model", "reads", "Discount applied before creating payment intent", "moderate"),
  ],
  review_system: [
    link("review", "data_model", "writes", "Creates review rows with rating and comment", "strong", { table: "reviews" }),
    link("book", "data_model", "enriches", "Reviews contribute to book average rating", "strong"),
    link("user", "data_model", "belongs_to", "Reviews written by authenticated users", "strong"),
    link("review_moderation", "workflow", "triggers", "New review enters moderation queue", "strong"),
  ],
  recommendation_engine: [
    link("book", "data_model", "reads", "Analyses book metadata for content-based filtering", "strong"),
    link("order", "data_model", "reads", "Purchase history for collaborative filtering", "strong"),
    link("user", "data_model", "reads", "User preferences and browsing behavior", "moderate"),
    link("book_catalog", "feature", "enhances", "Recommendations displayed in catalog and book detail pages", "strong"),
  ],
  admin_dashboard: [
    link("book", "data_model", "manages", "CRUD for book inventory", "strong"),
    link("order", "data_model", "reads", "View and manage orders", "strong"),
    link("user", "data_model", "reads", "View and manage user accounts", "strong"),
    link("review_moderation", "workflow", "hosts", "Moderation queue is part of admin dashboard", "strong"),
  ],
  email_notifications: [
    link("order", "data_model", "reads", "Order data for confirmation and shipping emails", "strong"),
    link("user", "data_model", "reads", "User email address for delivery", "strong"),
  ],
};

// ─── Workflow cross-links ────────────────────────────────────────────────────
const workflowLinks = {
  checkout_flow: [
    link("shopping_cart", "feature", "starts_from", "Checkout initiated from cart page", "strong"),
    link("payment_processing", "feature", "uses", "Stripe payment in steps 4-5", "strong"),
    link("order_management", "feature", "creates", "Order record created in step 6", "strong"),
    link("email_notifications", "feature", "triggers", "Confirmation email in step 7", "strong"),
    link("book", "data_model", "updates", "Decrements stock_count in step 6", "strong"),
    link("discount_code", "data_model", "reads", "Validates discount code in step 3", "moderate"),
  ],
  review_moderation: [
    link("review_system", "feature", "serves", "Moderation queue for new reviews", "strong"),
    link("admin_dashboard", "feature", "hosted_in", "Queue displayed in admin UI", "strong"),
    link("review", "data_model", "updates", "Sets approved=true or deletes review", "strong"),
    link("book", "data_model", "updates", "Recalculates avg_rating after approval", "strong"),
  ],
  inventory_reorder: [
    link("inventory_tracking", "feature", "triggered_by", "Stock threshold check after order", "strong"),
    link("book", "data_model", "reads", "Checks stock_count against threshold", "strong"),
    link("email_notifications", "feature", "uses", "Admin notification in step 3", "moderate"),
  ],
};

// ─── Data model cross-links ─────────────────────────────────────────────────
const dataModelLinks = {
  book: [
    link("order_item", "data_model", "referenced_by", "Books appear as line items in orders", "strong"),
    link("review", "data_model", "has_many", "Books can have customer reviews", "strong"),
    link("book_catalog", "feature", "displayed_by", "Books shown in catalog", "strong"),
    link("inventory_tracking", "feature", "tracked_by", "Stock levels monitored", "strong"),
  ],
  user: [
    link("order", "data_model", "has_many", "Users place orders", "strong"),
    link("review", "data_model", "has_many", "Users write reviews", "strong"),
    link("user_auth", "feature", "authenticated_by", "Login and session management", "strong"),
  ],
  order: [
    link("user", "data_model", "belongs_to", "Order placed by a user", "strong"),
    link("order_item", "data_model", "has_many", "Line items in this order", "strong"),
    link("checkout_flow", "workflow", "created_by", "Orders created during checkout", "strong"),
  ],
  order_item: [
    link("order", "data_model", "belongs_to", "Part of an order", "strong"),
    link("book", "data_model", "references", "Links to a book", "strong"),
  ],
  review: [
    link("book", "data_model", "belongs_to", "Review for a specific book", "strong"),
    link("user", "data_model", "belongs_to", "Written by a user", "strong"),
    link("review_moderation", "workflow", "enters", "New reviews enter moderation queue", "strong"),
  ],
  discount_code: [
    link("checkout_flow", "workflow", "applied_in", "Discount codes applied during checkout step 3", "strong"),
    link("shopping_cart", "feature", "validated_by", "Cart validates code before checkout", "moderate"),
  ],
};

// ─── Apply enrichments ──────────────────────────────────────────────────────

function enrichArray(arr, linksMap) {
  for (const item of arr) {
    item.domain = domainMap[item.id] ?? "general";
    item.keywords = keywordsMap[item.id] ?? [];
    item.links = linksMap[item.id] ?? [];
    if (!item.status) item.status = "active";
  }
}

enrichArray(features, featureLinks);
enrichArray(workflows, workflowLinks);
enrichArray(dataModel, dataModelLinks);

// ─── Write ──────────────────────────────────────────────────────────────────
write("features.json", features);
write("workflows.json", workflows);
write("data_model.json", dataModel);

console.log(
  `Enriched: ${features.length} features, ${workflows.length} workflows, ${dataModel.length} data model entities`
);
console.log("Run a dream cycle to see the cognitive engine explore your graph!");

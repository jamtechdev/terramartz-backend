/**
 * Rules for when a product may appear in the public catalog vs checkout.
 * Admin catalog approval (`adminApproved`) and lifecycle `status` must align.
 */

import { Product } from "../models/seller/product.js";

export const SELLER_SETTABLE_STATUSES = [
  "draft",
  "pending",
  "active",
  "inactive",
  "out_of_stock",
];

/** Category / stats counts — same as public product grid */
export function isPublicCatalogProduct(doc) {
  if (!doc) return false;
  return (
    doc.adminApproved === true &&
    doc.status === "active" &&
    (doc.stockQuantity ?? 0) > 0
  );
}

/** Product detail page: listed items plus out-of-stock (still approved) */
export function isPublicProductDetailVisible(doc) {
  if (!doc) return false;
  if (doc.adminApproved !== true) return false;
  return doc.status === "active" || doc.status === "out_of_stock";
}

/** Cart and payment: must be sellable now */
export function isPurchasablePublicProduct(doc) {
  if (!doc) return false;
  return (
    doc.adminApproved === true &&
    doc.status === "active" &&
    (doc.stockQuantity ?? 0) > 0
  );
}

export function normalizeSellerProductStatus(value) {
  if (value == null || typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  return SELLER_SETTABLE_STATUSES.includes(s) ? s : null;
}

/**
 * When stock hits 0, move active → out_of_stock; when restocked from OOS, move back to active.
 * Does not change inactive / draft / pending / rejected / archived.
 */
export function syncLifecycleWithStock(product) {
  if (!product) return;
  const sq = Number(product.stockQuantity);
  const st = product.status;
  if (Number.isNaN(sq) || sq < 0) return;
  if (sq === 0 && st === "active") {
    product.status = "out_of_stock";
  } else if (sq > 0 && st === "out_of_stock") {
    product.status = "active";
  }
}

/** Stock delta (+ restore, − decrement). Persists lifecycle (active ↔ out_of_stock). */
export async function adjustProductStockWithLifecycleSync(productId, delta) {
  const product = await Product.findById(productId).select(
    "stockQuantity status",
  );
  if (!product) return null;
  product.stockQuantity = (product.stockQuantity ?? 0) + delta;
  if (product.stockQuantity < 0) product.stockQuantity = 0;
  syncLifecycleWithStock(product);
  await product.save();
  return product;
}

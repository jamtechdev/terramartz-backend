import { Product } from "../models/seller/product.js";
import { Notification } from "../models/common/notification.js";

/**
 * Check if product stock has fallen to or below the inventory alert threshold
 * and create a low_stock notification for the seller if so.
 *
 * This should be called after every stock decrement (order placement).
 * It is safe to call even if inventoryAlert is 0 or not set (will do nothing).
 *
 * @param {string} productId - The product ID to check
 * @param {Object} [options] - Optional overrides
 * @param {Object} [options.session] - Mongoose session for transaction support
 * @param {number} [options.currentStock] - If you already have the updated stock, pass it to avoid an extra DB read
 * @param {Object} [options.productDoc] - If you already have the product document with the updated stock
 */
export const checkInventoryAlert = async (productId, options = {}) => {
  try {
    const { session, currentStock, productDoc } = options;

    // Fetch the product if not provided
    let product = productDoc;
    if (!product) {
      const query = Product.findById(productId).select(
        "title stockQuantity inventoryAlert createdBy",
      );
      if (session) query.session(session);
      product = await query;
    }

    if (!product) return;

    // If inventoryAlert is 0 or not set, the vendor hasn't enabled it — skip
    if (!product.inventoryAlert || product.inventoryAlert <= 0) return;

    const stock =
      currentStock !== undefined ? currentStock : product.stockQuantity;

    // Only notify when stock falls to or below the threshold
    if (stock > product.inventoryAlert) return;

    // Avoid duplicate notifications: check if an unread low_stock notification
    // already exists for this exact product
    const existingNotification = await Notification.findOne({
      user: String(product.createdBy),
      type: "low_stock",
      productId: String(productId),
      isRead: false,
    });

    if (existingNotification) return; // Already notified, don't spam

    const createArgs = [
      {
        user: String(product.createdBy),
        type: "low_stock",
        title: "Low Stock Alert",
        message: `Your product "${product.title}" has only ${stock} unit(s) left in stock, which is at or below your alert threshold of ${product.inventoryAlert}.`,
        productId: String(productId),
        metadata: {
          currentStock: stock,
          inventoryAlert: product.inventoryAlert,
        },
      },
    ];

    if (session) {
      await Notification.create(createArgs, { session });
    } else {
      await Notification.create(createArgs);
    }

    console.log(
      `Low stock alert created for product "${product.title}" (stock: ${stock}, threshold: ${product.inventoryAlert})`,
    );
  } catch (err) {
    // Never let inventory alert failures break the order flow
    console.error("Failed to check/create inventory alert:", err);
  }
};

/**
 * Batch check inventory alerts for multiple products after an order.
 *
 * @param {Array<{productId: string, quantity: number}>} items - Products and quantities purchased
 * @param {Object} [options] - Optional overrides (session, etc.)
 */
export const checkInventoryAlertBatch = async (items, options = {}) => {
  const promises = items.map((item) =>
    checkInventoryAlert(item.productId || item.product, options),
  );
  await Promise.all(promises);
};

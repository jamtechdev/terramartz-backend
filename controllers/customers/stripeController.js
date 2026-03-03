import Stripe from "stripe";
import mongoose from "mongoose";
import crypto from "crypto";

import { Product } from "../../models/seller/product.js";
import { Purchase } from "../../models/customers/purchase.js";
import { User } from "../../models/users.js";
import { TaxConfig } from "../../models/super-admin/taxWithAdminDiscountConfig.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { PromoCode } from "../../models/seller/promoCodes.js";
import { CustomerPromoCodeUse } from "../../models/customers/customerPromoCodeUse.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { LoyaltyPoint } from "./../../models/customers/loyaltyPoints.js";
import { PlatformFee } from "../../models/super-admin/platformFee.js";
import { SellerSettlement } from "../../models/seller/sellerSettlement.js";
import { calculateSettlementDate } from "../../utils/settlementHelper.js";

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function generateUniqueOrderId() {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(3).toString("hex");
  return `ORD-${timestamp}-${randomBytes}`;
}

/**
 * Helper to calculate overall order payment status based on all settlements
 * @param {string} purchaseId - The purchase/order ID
 * @returns {Object} - { paymentStatus, totalRefundAmount, refundAmountBySeller }
 */
export const calculateOrderPaymentStatus = async (purchaseId) => {
  const settlements = await SellerSettlement.find({ purchaseId });

  if (!settlements || settlements.length === 0) {
    return {
      paymentStatus: "paid",
      totalRefundAmount: 0,
      refundAmountBySeller: {},
    };
  }

  let totalRefundAmount = 0;
  const refundAmountBySeller = {};
  let totalProducts = 0;
  let refundedProducts = 0;

  for (const settlement of settlements) {
    for (const product of settlement.products) {
      totalProducts++;
      if (product.refundStatus === "refunded") {
        refundedProducts++;
        totalRefundAmount += product.refundAmount || 0;
        const sellerId = String(settlement.sellerId);
        refundAmountBySeller[sellerId] =
          (refundAmountBySeller[sellerId] || 0) + (product.refundAmount || 0);
      }
    }
  }

  let paymentStatus = "paid";
  if (refundedProducts > 0) {
    paymentStatus =
      refundedProducts === totalProducts ? "refunded" : "partially_refunded";
  }

  return { paymentStatus, totalRefundAmount, refundAmountBySeller };
};

/**
 * Helper to update purchase payment status based on all settlements
 * @param {string} purchaseId - The purchase/order ID
 */
export const updatePurchasePaymentStatus = async (purchaseId) => {
  const { paymentStatus, totalRefundAmount } =
    await calculateOrderPaymentStatus(purchaseId);

  const purchase = await Purchase.findById(purchaseId);
  if (purchase) {
    purchase.paymentStatus = paymentStatus;
    purchase.refundAmount = totalRefundAmount;
    await purchase.save();
  }

  return { paymentStatus, totalRefundAmount };
};

/**
 * Shared helper to calculate full checkout breakdown from database authoritative data.
 * @param {Array} products - Array of { product: id, quantity }
 * @param {string} shippingMethod - "standard", "express", or "overnight"
 * @param {string} promoCode - Applied promo code string
 * @param {Object} user - Authenticated user object
 */
export const calculateOrderBreakdown = async (
  products,
  shippingMethod,
  promoCode,
  user,
  useLoyaltyPoints = false,
) => {
  if (!products || products.length === 0)
    throw new Error("No products provided");

  const productDetailsArr = [];
  let totalSavings = 0;

  // 1. Fetch products and calculate subtotal (using DB prices)
  // Track all unique seller IDs for multi-seller settlement
  const sellerIdsSet = new Set();

  for (const item of products) {
    const product = await Product.findById(item.product);
    if (!product) throw new Error(`Product not found: ${item.product}`);

    const productSellerId = String(product.createdBy);
    sellerIdsSet.add(productSellerId);

    let basePrice = Number(product.price);
    const originalPrice = Number(product.originalPrice || product.price);

    // Apply product-level discount if applicable
    if (
      product.discount &&
      (!product.discountExpires ||
        new Date(product.discountExpires) >= new Date())
    ) {
      if (product.discountType === "fixed") basePrice -= product.discount;
      else if (product.discountType === "percentage")
        basePrice -= (basePrice * product.discount) / 100;
      if (basePrice < 0) basePrice = 0;
    }

    const quantity = Number(item.quantity) || 1;

    // ✅ Stock Validation
    if (product.stockQuantity < quantity) {
      throw new Error(
        `Insufficient stock for "${product.title}". Only ${product.stockQuantity} available.`,
      );
    }

    totalSavings += (originalPrice - basePrice) * quantity;

    productDetailsArr.push({
      product,
      basePrice,
      quantity,
      sellerId: productSellerId,
    });
  }

  const sellerIds = [...sellerIdsSet];
  // Use first seller for shipping config (backward compatible)
  const sellerId = sellerIds[0];

  const subtotal = productDetailsArr.reduce(
    (sum, p) => sum + p.basePrice * p.quantity,
    0,
  );

  const seller = await User.findById(sellerId);
  if (!seller) throw new Error("Seller not found");

  // 2. Shipping Calculation
  let shippingCost = 0;
  if (shippingMethod === "express") {
    shippingCost = 12.99;
  } else if (shippingMethod === "overnight") {
    shippingCost = 24.99;
  } else {
    // Standard shipping
    if (subtotal > 50) {
      shippingCost = 0;
    } else if (
      seller.sellerProfile.freeShippingThreshold &&
      subtotal >= seller.sellerProfile.freeShippingThreshold
    ) {
      shippingCost = 0;
    } else {
      shippingCost = seller.sellerProfile.shippingCharges || 5.99;
    }
  }

  // 3. Promo Code Calculation
  let promoDiscount = 0;
  let promoCodeId = null;

  if (promoCode) {
    // 💡 Search for the promo code globally first to identify its owner
    const matchedPromo = await PromoCode.findOne({
      code: promoCode.trim(),
      isActive: true,
    });

    console.log(matchedPromo, "matchedPromo==>");
    console.log(matchedPromo.sellerId, "matchedPromo.sellerId==>");

    if (matchedPromo) {
      // ✅ Check if ALL products in the cart belong to this promo code's seller
      // Use String conversion for reliable comparison
      const promoSellerIdStr = matchedPromo.sellerId.toString();

      console.log(
        `🔍 [calculateOrderBreakdown] Checking products for promo owner: ${promoSellerIdStr}`,
      );

      const allProductsFromPromoSeller = productDetailsArr.every((p, idx) => {
        const prodSellerId =
          p.product.createdBy?.toString() || p.product.seller?.toString();
        const matches = prodSellerId === promoSellerIdStr;
        console.log(
          `   - Product [${idx}] ID: ${p.product._id}, createdBy: ${prodSellerId}, Matches: ${matches}`,
        );
        return matches;
      });

      if (!allProductsFromPromoSeller) {
        // If products are from different sellers, this specific seller coupon cannot be applied
        console.log(
          `🚫 Promo code ${promoCode} rejected: Not all products belong to seller ${promoSellerIdStr}`,
        );
      } else {
        const now = new Date();
        const notExpired =
          !matchedPromo.expiresAt || new Date(matchedPromo.expiresAt) >= now;
        const meetsMinAmount = subtotal >= (matchedPromo.minOrderAmount || 0);
        const withinUsageLimit =
          !matchedPromo.usageLimit ||
          matchedPromo.usedCount < matchedPromo.usageLimit;

        let withinUserLimit = true;
        if (user && user.id) {
          const userUsageCount = await CustomerPromoCodeUse.countDocuments({
            user_id: user.id,
            promoCodeId: matchedPromo._id,
            purchase_id: { $ne: null },
          });
          withinUserLimit = userUsageCount < (matchedPromo.perUserLimit || 1);
        }

        if (
          notExpired &&
          meetsMinAmount &&
          withinUsageLimit &&
          withinUserLimit
        ) {
          promoDiscount =
            matchedPromo.type === "fixed"
              ? matchedPromo.discount
              : (subtotal * matchedPromo.discount) / 100;
          promoCodeId = matchedPromo._id;
        }
      }
    }
  }

  // 4. Admin Discount (Limited Time Offer)
  const activeTax =
    (await TaxConfig.findOne({ isActive: true })) ||
    (await TaxConfig.findOne({ active: true }));
  let adminDiscount = 0;
  if (activeTax && activeTax.limitedTimeOffer?.active) {
    const offer = activeTax.limitedTimeOffer;
    const now = new Date();
    const offerValid = !offer.expiresAt || new Date(offer.expiresAt) >= now;
    if (offerValid && subtotal >= offer.minSpend) {
      adminDiscount = (subtotal * offer.discountPercent) / 100;
    }
  }

  // 4.5. Loyalty Points Discount
  let loyaltyDiscount = 0;
  let pointsToUse = 0;
  if (useLoyaltyPoints && user && user.id) {
    // Fetch user's loyalty point balance
    const userIdString = String(user.id || user._id);
    const loyaltyRecords = await LoyaltyPoint.find({ user: userIdString });
    
    // Calculate balance: sum earned points, subtract redeemed points
    const balance = loyaltyRecords.reduce((sum, record) => {
      if (record.type === "earn") {
        return sum + Math.abs(record.points);
      } else if (record.type === "redeem") {
        return sum - Math.abs(record.points);
      }
      return sum;
    }, 0);

    if (balance > 0) {
      // Calculate subtotal after promo and admin discounts
      const subtotalAfterOtherDiscounts = Math.max(
        0,
        subtotal - promoDiscount - adminDiscount,
      );

      // Loyalty discount can't exceed the remaining amount
      const maxLoyaltyDiscount = balance * 0.1; // $0.1 per point
      loyaltyDiscount = Math.min(
        maxLoyaltyDiscount,
        subtotalAfterOtherDiscounts,
      );
      loyaltyDiscount = Math.round(loyaltyDiscount * 100) / 100;

      // Calculate actual points to use based on capped discount
      pointsToUse = Math.round(loyaltyDiscount / 0.1);

      console.log(`💎 Loyalty calculation:`);
      console.log(
        `   - User balance: ${balance} points ($${maxLoyaltyDiscount.toFixed(2)})`,
      );
      console.log(
        `   - Subtotal after other discounts: $${subtotalAfterOtherDiscounts.toFixed(2)}`,
      );
      console.log(
        `   - Loyalty discount applied: $${loyaltyDiscount.toFixed(2)}`,
      );
      console.log(`   - Points to use: ${pointsToUse}`);
    }
  }

  const totalDiscount = promoDiscount + adminDiscount + loyaltyDiscount;

  // 5. Proportional discounting and final totals
  const totalAfterDiscount = Math.max(0, subtotal - totalDiscount);

  // Set finalPricePerUnit on each item for metadata/line items
  productDetailsArr.forEach((p) => {
    if (subtotal > 0) {
      const proportion = (p.basePrice * p.quantity) / subtotal;
      const discountShare = totalDiscount * proportion;
      const finalUnitPrice = p.basePrice - discountShare / p.quantity;
      p.finalPricePerUnit = Math.round(finalUnitPrice * 100) / 100;
    } else {
      p.finalPricePerUnit = 0;
    }
  });

  // 6. Tax Calculation
  let taxRate = 0.08;
  if (activeTax && activeTax.rate) taxRate = activeTax.rate / 100;
  const taxAmount = Math.round(totalAfterDiscount * taxRate * 100) / 100;

  // 7. Total Amount
  const totalAmount =
    Math.round((totalAfterDiscount + shippingCost + taxAmount) * 100) / 100;

  // 8. Platform Fee
  const platformFeeConfig = await PlatformFee.findOne();
  let platformFeeAmount = 0;
  const hasStripeConnect =
    seller.sellerProfile?.stripeAccountId &&
    seller.sellerProfile?.stripeAccountStatus === "active";

  if (platformFeeConfig) {
    if (platformFeeConfig.type === "fixed") {
      platformFeeAmount = platformFeeConfig.fee;
    } else if (platformFeeConfig.type === "percentage") {
      platformFeeAmount = (totalAmount * platformFeeConfig.fee) / 100;
    }
    platformFeeAmount = Math.round(platformFeeAmount * 100) / 100;
  }

  // 9. Compute per-seller breakdown for settlements
  const sellerBreakdowns = {};
  for (const sId of sellerIds) {
    const sellerProducts = productDetailsArr.filter((p) => p.sellerId === sId);
    const sellerSubtotal = sellerProducts.reduce(
      (sum, p) => sum + p.basePrice * p.quantity,
      0,
    );
    const proportion = subtotal > 0 ? sellerSubtotal / subtotal : 0;
    const sellerPlatformFee =
      Math.round(platformFeeAmount * proportion * 100) / 100;
    const sellerCommission =
      Math.round((sellerSubtotal - sellerPlatformFee) * 100) / 100;

    sellerBreakdowns[sId] = {
      sellerId: sId,
      subtotal: Math.round(sellerSubtotal * 100) / 100,
      platformFee: sellerPlatformFee,
      commission: sellerCommission,
    };
  }

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    promoDiscount: Math.round(promoDiscount * 100) / 100,
    adminDiscount: Math.round(adminDiscount * 100) / 100,
    loyaltyDiscount: Math.round(loyaltyDiscount * 100) / 100,
    pointsToUse,
    shippingCost: Math.round(shippingCost * 100) / 100,
    taxAmount,
    totalAmount,
    totalSavings: Math.round(totalSavings * 100) / 100,
    platformFeeAmount,
    sellerReceives: Math.round((totalAmount - platformFeeAmount) * 100) / 100,
    promoCodeId,
    sellerId,
    sellerIds, // all unique seller IDs for multi-seller orders
    sellerBreakdowns, // per-seller breakdown for settlements
    productDetailsArr,
    hasStripeConnect,
    platformFeeConfig,
    activeTax,
  };
};

// ✅ Get Checkout Breakdown (for frontend preview)
export const getCheckoutBreakdown = catchAsync(async (req, res, next) => {
  const { products, shippingMethod, promoCode, useLoyaltyPoints } = req.body;

  try {
    const breakdown = await calculateOrderBreakdown(
      products,
      shippingMethod,
      promoCode,
      req.user,
      useLoyaltyPoints,
    );

    res.status(200).json({
      status: "success",
      data: breakdown,
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

// ✅ Create PaymentIntent
export const createPaymentIntent = catchAsync(async (req, res, next) => {
  const { products, shippingAddress, promoCode, skipWebhook, shippingMethod } =
    req.body;

  if (!products || products.length === 0)
    return next(new AppError("No products provided", 400));
  if (!req.user || !req.user.id)
    return next(new AppError("User not authenticated", 401));

  try {
    const breakdown = await calculateOrderBreakdown(
      products,
      shippingMethod,
      promoCode,
      req.user,
    );

    const {
      subtotal,
      promoDiscount,
      adminDiscount,
      shippingCost,
      taxAmount,
      totalAmount,
      platformFeeAmount,
      promoCodeId,
      sellerId,
      sellerIds,
      productDetailsArr,
      hasStripeConnect,
      platformFeeConfig,
    } = breakdown;

    // ✅ Step 11: Create Stripe PaymentIntent
    const paymentIntentConfig = {
      amount: Math.round(totalAmount * 100),
      currency: "usd",
      metadata: {
        buyer: req.user.id,
        sellerId: String(sellerId),
        sellerIds: JSON.stringify(sellerIds),
        products: JSON.stringify(
          productDetailsArr.map((p) => ({
            product: String(p.product._id),
            quantity: p.quantity,
            price: p.finalPricePerUnit, // ✅ per-unit paid price
          })),
        ),
        shippingAddress: JSON.stringify(shippingAddress),
        shippingMethod: shippingMethod || "standard",
        promoDiscount: promoDiscount.toString(),
        adminDiscount: adminDiscount.toString(),
        taxAmount: taxAmount.toString(),
        shippingCost: shippingCost.toString(),
        platformFeeAmount: platformFeeAmount.toString(),
        platformFeeType: platformFeeConfig?.type || "none",
        paymentType: hasStripeConnect ? "direct_charge" : "platform",
        promoCodeId: promoCodeId || "",
      },
    };

    // ✅ Settlement logic changed: We now hold the commission and settle every Wednesday.
    // Immediate transfer to seller is disabled.
    /*
    if (hasStripeConnect) {
      paymentIntentConfig.transfer_data = {
        destination: seller.sellerProfile.stripeAccountId,
      };
  
      if (platformFeeAmount > 0) {
        paymentIntentConfig.application_fee_amount = Math.round(
          platformFeeAmount * 100,
        );
      }
    }
    */

    const paymentIntent =
      await stripe.paymentIntents.create(paymentIntentConfig);

    // 🔹 Local Development: Skip webhook and directly create purchase
    const isDevelopment = process.env.NODE_ENV === "development";
    const shouldSkipWebhook = skipWebhook === true || isDevelopment;

    if (shouldSkipWebhook) {
      try {
        const mockPaymentIntent = {
          id: paymentIntent.id,
          amount: paymentIntent.amount,
          metadata: paymentIntent.metadata,
        };

        await createPurchaseFromPaymentIntent(mockPaymentIntent);

        const createdPurchase = await Purchase.findOne({
          paymentIntentId: paymentIntent.id,
        });

        return res.status(200).json({
          status: "success",
          clientSecret: paymentIntent.client_secret,
          breakdown: {
            subtotal: Math.round(subtotal * 100) / 100,
            promoDiscount: Math.round(promoDiscount * 100) / 100,
            adminDiscount: Math.round(adminDiscount * 100) / 100,
            shippingCost: Math.round(shippingCost * 100) / 100,
            taxAmount: Math.round(taxAmount * 100) / 100,
            platformFee: Math.round(platformFeeAmount * 100) / 100, // ✅ Include platform fee
            totalAmount: Math.round(totalAmount * 100) / 100,
            sellerReceives:
              Math.round((totalAmount - platformFeeAmount) * 100) / 100, // ✅ What seller gets
          },
          message: "Payment completed (webhook skipped for local development)",
          orderCreated: true,
          orderId: createdPurchase?.orderId || null,
          paymentIntentId: paymentIntent.id,
        });
      } catch (err) {
        console.error("⚠️ Failed to create purchase directly:", err);
      }
    }

    res.status(200).json({
      status: "success",
      clientSecret: paymentIntent.client_secret,
      breakdown: {
        subtotal: Math.round(subtotal * 100) / 100,
        promoDiscount: Math.round(promoDiscount * 100) / 100,
        adminDiscount: Math.round(adminDiscount * 100) / 100,
        shippingCost: Math.round(shippingCost * 100) / 100,
        taxAmount: Math.round(taxAmount * 100) / 100,
        platformFee: Math.round(platformFeeAmount * 100) / 100,
        totalAmount: Math.round(totalAmount * 100) / 100,
        sellerReceives: breakdown.sellerReceives,
      },
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

// ✅ Webhook + retry logic + atomic stock update
export const webhookPayment = async (req, res, next) => {
  // // 🔹 Skip webhook in development mode (local testing)
  // if (process.env.NODE_ENV === "development") {
  //   console.log("⚠️ Webhook skipped in development mode");
  //   return res.status(200).json({
  //     received: true,
  //     message: "Webhook skipped in development mode",
  //   });
  // }

  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("❌ Webhook verification failed:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // Handle PaymentIntent success
  if (
    event.type === "payment_intent.succeeded" ||
    event.type === "charge.succeeded"
  ) {
    try {
      await createPurchaseFromPaymentIntent(event.data.object);
    } catch (err) {
      console.error("⚠️ Failed to save purchase:", err);
    }
  }

  // Handle Stripe Connect Account Updates
  if (event.type === "account.updated") {
    try {
      const account = event.data.object;
      const { updateAccountStatus } =
        await import("../sellers/stripeConnectController.js");
      await updateAccountStatus(account.id, account);
      console.log("✅ Account status updated:", account.id);
    } catch (err) {
      console.error("⚠️ Failed to update account status:", err);
    }
  }

  // Handle Checkout Session completion
  if (event.type === "checkout.session.completed") {
    try {
      const session = event.data.object;

      // Retrieve the full session to get line items
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["line_items"],
      });

      // Create purchase from checkout session
      const metadata = session.metadata || {};
      const buyer = metadata.buyer;
      const products = metadata.products ? JSON.parse(metadata.products) : [];
      let shippingAddress = metadata.shippingAddress
        ? JSON.parse(metadata.shippingAddress)
        : {};

      const platformFeeAmount = metadata.platformFeeAmount
        ? Number(metadata.platformFeeAmount)
        : 0;

      // Add taxAmount and shippingCost to shippingAddress for invoice display
      const taxAmount = metadata.taxAmount ? Number(metadata.taxAmount) : 0;
      const shippingCost = metadata.shippingCost
        ? Number(metadata.shippingCost)
        : 0;

      shippingAddress.taxAmount = taxAmount;
      shippingAddress.shippingCost = shippingCost;

      if (!buyer || !products.length) {
        console.error("Missing buyer or products in checkout session metadata");
        return;
      }

      // Create purchase similar to payment intent flow
      const purchaseProducts = [];
      for (const item of products) {
        const product = await Product.findById(item.product);
        if (!product) continue;

        // Update stock
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stockQuantity: -item.quantity },
        });

        // Purchase model expects seller as String, so convert to String
        const finalSellerId = String(product.createdBy || product.seller);

        purchaseProducts.push({
          product: product._id,
          quantity: item.quantity,
          price: product.price,
          seller: finalSellerId, // Store as String (Purchase schema expects String)
          timeline: [
            {
              event: "Order Confirmed",
              timestamp: new Date(),
              location: "Seller",
            },
          ],
        });
      }

      const totalAmount = session.amount_total / 100;
      const orderId = generateUniqueOrderId();
      const trackingNumber = `TRK-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      // Ensure buyer is stored as String (Purchase schema expects String)
      const buyerString = String(buyer);
      console.log(
        "📦 Webhook: Creating order with buyer:",
        buyerString,
        "Type:",
        typeof buyerString,
      );

      const purchase = await Purchase.create({
        orderId,
        buyer: buyerString, // Convert to string
        products: purchaseProducts,
        shippingAddress,
        totalAmount,
        platformFeeAmount,
        paymentStatus: "paid",
        status: "new",
        paymentIntentId: session.payment_intent,
        checkoutSessionId: session.id,
        trackingNumber,
        orderTimeline: [
          {
            event: "Order Confirmed",
            timestamp: new Date(),
            location: "Seller",
          },
        ],
      });

      // ✅ Create SellerSettlement records for ALL sellers in this order
      const orderDate = new Date();
      const maturityDate = new Date(orderDate);
      maturityDate.setDate(maturityDate.getDate() + 3); // 3 Days Buffer
      const scheduledSettlementDate = calculateSettlementDate(maturityDate);

      // Group products by seller to create per-seller settlement records
      const sellerProductsMap = {};
      for (const pp of purchaseProducts) {
        const sId = String(pp.seller);
        if (!sellerProductsMap[sId]) sellerProductsMap[sId] = [];
        sellerProductsMap[sId].push(pp);
      }

      const orderSubtotal = purchaseProducts.reduce(
        (sum, pp) => sum + pp.price * pp.quantity,
        0,
      );

      for (const sId of Object.keys(sellerProductsMap)) {
        const sellerItems = sellerProductsMap[sId];
        const sellerSubtotal = sellerItems.reduce(
          (sum, pp) => sum + pp.price * pp.quantity,
          0,
        );
        // Proportional platform fee based on seller's share of the order
        const proportion =
          orderSubtotal > 0 ? sellerSubtotal / orderSubtotal : 0;
        const sellerPlatformFee =
          Math.round(platformFeeAmount * proportion * 100) / 100;
        const sellerCommission =
          Math.round((sellerSubtotal - sellerPlatformFee) * 100) / 100;

        await SellerSettlement.create({
          sellerId: sId,
          purchaseId: purchase._id,
          products: sellerItems.map((pp) => ({
            product: String(pp.product),
            quantity: pp.quantity,
            price: pp.price,
          })),
          totalOrderAmount: sellerSubtotal,
          commissionAmount: sellerCommission,
          platformFee: sellerPlatformFee,
          status: "pending",
          scheduledSettlementDate,
        });
        console.log(
          `✅ SellerSettlement created for seller ${sId} ($${sellerCommission}), scheduled for ${scheduledSettlementDate}`,
        );
      }

      // ✅ Clear cart after successful order
      try {
        const { Cart } = await import("../../models/customers/cart.js");
        await Cart.deleteMany({ user: buyer });
        console.log("✅ Cart cleared for user:", buyer);
      } catch (cartError) {
        console.error("⚠️ Failed to clear cart:", cartError);
        // Don't fail the order if cart clearing fails
      }

      // ✅ Add loyalty points for purchase
      try {
        const userOrderCount = await Purchase.countDocuments({
          buyer: buyer,
          paymentStatus: "paid",
        });

        console.log(`💎 Loyalty Points Processing for user ${buyer}:`);
        console.log(`   - User order count: ${userOrderCount}`);
        console.log(`   - Metadata:`, metadata);

        if (userOrderCount >= 3) {
          const pointsEarned = Math.floor(totalAmount / 10);
          if (pointsEarned > 0) {
            await LoyaltyPoint.create({
              user: buyer,
              points: pointsEarned,
              type: "earn",
              reason: "purchase",
              referenceId: orderId,
            });
            console.log(`✅ Awarded ${pointsEarned} loyalty points to user ${buyer}`);
          }
        } else {
          console.log(
            `ℹ️ Loyalty points not awarded: User ${buyer} has ${userOrderCount} orders (minimum 3 required).`,
          );
        }

        // ✅ Deduct loyalty points if used
        const useLoyaltyPoints = metadata.useLoyaltyPoints === "true";
        const loyaltyPointsUsed = Number(metadata.loyaltyPointsUsed || 0);

        console.log(`💎 Checking loyalty points deduction:`);
        console.log(`   - useLoyaltyPoints flag: ${useLoyaltyPoints} (type: ${typeof metadata.useLoyaltyPoints})`);
        console.log(`   - loyaltyPointsUsed: ${loyaltyPointsUsed}`);
        console.log(`   - Raw metadata.useLoyaltyPoints: "${metadata.useLoyaltyPoints}"`);
        console.log(`   - Raw metadata.loyaltyPointsUsed: "${metadata.loyaltyPointsUsed}"`);

        if (useLoyaltyPoints && loyaltyPointsUsed > 0) {
          console.log(`💎 Creating redeem record...`);
          await LoyaltyPoint.create({
            user: buyer,
            points: Math.abs(loyaltyPointsUsed), // Store as positive number
            type: "redeem",
            reason: "purchase",
            referenceId: orderId,
          });
          console.log(
            `✅ Deducted ${loyaltyPointsUsed} loyalty points from user ${buyer}`,
          );
        } else {
          console.log(`⚠️ Loyalty points NOT deducted - condition not met`);
        }
      } catch (pointsError) {
        console.error("⚠️ Failed to process loyalty points:", pointsError);
      }

      // Record promo code usage if applicable
      const sessionMetadata = session.metadata || {};
      const usedPromoCodeId = sessionMetadata.promoCodeId;

      if (usedPromoCodeId && buyer) {
        try {
          // Record the promo code usage
          await CustomerPromoCodeUse.create({
            user_id: buyer,
            promoCodeId: usedPromoCodeId,
            purchase_id: order._id,
          });

          // Update promo code usage count
          await PromoCode.findByIdAndUpdate(usedPromoCodeId, {
            $inc: { usedCount: 1 },
          });

          console.log(
            `✅ Promo code usage recorded in webhook: User ${buyer} used promo ${usedPromoCodeId}`,
          );
        } catch (promoError) {
          console.error(
            "⚠️ Failed to record promo code usage in webhook:",
            promoError,
          );
          // Don't fail the order if promo code tracking fails
        }
      }

      console.log("✅ Purchase created from checkout session:", orderId);
    } catch (err) {
      console.error("⚠️ Failed to create purchase from checkout session:", err);
    }
  }
  // 🔹 Handle Refunds
  if (event.type === "charge.refunded") {
    try {
      const charge = event.data.object;
      await handleRefund(charge);
      console.log("✅ Refund processed for charge:", charge.id);
    } catch (err) {
      console.error("⚠️ Failed to process refund:", err);
    }
  }

  // 🔹 Handle Dispute Created (Chargeback initiated)
  if (event.type === "charge.dispute.created") {
    try {
      const dispute = event.data.object;
      await handleDisputeCreated(dispute);
      console.log("⚠️ Dispute created for charge:", dispute.charge);
    } catch (err) {
      console.error("⚠️ Failed to handle dispute creation:", err);
    }
  }

  // 🔹 Handle Dispute Updated
  if (event.type === "charge.dispute.updated") {
    try {
      const dispute = event.data.object;
      await handleDisputeUpdated(dispute);
      console.log("✅ Dispute updated for charge:", dispute.charge);
    } catch (err) {
      console.error("⚠️ Failed to handle dispute update:", err);
    }
  }

  // 🔹 Handle Dispute Closed (Chargeback resolved)
  if (event.type === "charge.dispute.closed") {
    try {
      const dispute = event.data.object;
      await handleDisputeClosed(dispute);
      console.log("✅ Dispute closed for charge:", dispute.charge);
    } catch (err) {
      console.error("⚠️ Failed to handle dispute closure:", err);
    }
  }

  res.status(200).json({ received: true });
};

// ✅ Create Stripe Checkout Session (Hosted Payment Page)
export const createCheckoutSession = catchAsync(async (req, res, next) => {
  const {
    products,
    shippingAddress,
    promoCode,
    shippingMethod,
    useLoyaltyPoints,
  } = req.body;

  if (!products || products.length === 0)
    return next(new AppError("No products provided", 400));
  if (!req.user || !req.user.id)
    return next(new AppError("User not authenticated", 401));

  console.log(`\n========== RECEIVED CHECKOUT REQUEST ==========`);
  console.log(`Products count: ${products.length}`);
  console.log(`Shipping method: ${shippingMethod}`);
  console.log(`Use loyalty points: ${useLoyaltyPoints}`);
  products.forEach((p, i) => {
    console.log(
      `Product ${i + 1}: ID=${p.product}, Qty=${p.quantity}, Price=${p.price !== undefined ? "$" + p.price : "NOT PROVIDED"}`,
    );
  });
  console.log(`=============================================\n`);
  const lineItems = [];
  try {
    const breakdown = await calculateOrderBreakdown(
      products,
      shippingMethod,
      promoCode,
      req.user,
      useLoyaltyPoints,
    );

    const {
      subtotal,
      promoDiscount,
      adminDiscount,
      loyaltyDiscount,
      pointsToUse,
      shippingCost,
      taxAmount,
      totalAmount,
      platformFeeAmount,
      promoCodeId,
      sellerId,
      sellerIds,
      productDetailsArr,
      hasStripeConnect,
      platformFeeConfig,
      activeTax,
    } = breakdown;

    // Validate loyalty points if requested
    if (useLoyaltyPoints && pointsToUse === 0) {
      return next(new AppError("Insufficient loyalty points", 400));
    }

    const seller = await User.findById(sellerId);
    const lineItems = [];

    // 💡 Step 2: Build line items from breakdown data
    for (const pData of productDetailsArr) {
      const { product, basePrice, quantity, finalPricePerUnit } = pData;

      const productName =
        product.name?.trim().substring(0, 500) || `Product ${product._id}`;

      let productDescription = null;
      if (product.description && typeof product.description === "string") {
        const trimmed = product.description.trim().substring(0, 500);
        if (trimmed.length > 0) productDescription = trimmed;
      }

      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: productName,
            ...(productDescription ? { description: productDescription } : {}),
            images:
              product.productImages?.length > 0
                ? [String(product.productImages[0])]
                : [],
          },
          unit_amount: Math.round(finalPricePerUnit * 100),
        },
        quantity,
      });
    }

    // Add shipping as line item
    if (shippingCost > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: `Shipping (${shippingMethod || "standard"})`,
          },
          unit_amount: Math.round(shippingCost * 100),
        },
        quantity: 1,
      });
    }

    // Add tax as line item
    if (taxAmount > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Tax",
          },
          unit_amount: Math.round(taxAmount * 100),
        },
        quantity: 1,
      });
    }

    // Add admin discount as a negative line item if applicable (Stripe doesn't like negative prices,
    // but the helper already distributed discounts into finalPricePerUnit of products.
    // Wait, if there's an admin discount NOT included in promoDiscount, it's also distributed.
    // So products already reflect the TOTAL discount.

    // 💡 Step 5: Create metadata for order creation
    const productsMetadata = productDetailsArr.map((p) => ({
      product: String(p.product._id),
      quantity: p.quantity,
      price: p.finalPricePerUnit,
    }));

    const userId = String(req.user._id || req.user.id);

    const metadata = {
      buyer: userId,
      products: JSON.stringify(productsMetadata),
      shippingAddress: JSON.stringify(shippingAddress),
      shippingMethod: shippingMethod || "standard",
      shippingCost: shippingCost.toString(),
      taxAmount: taxAmount.toString(),
      platformFeeAmount: platformFeeAmount.toString(),
      platformFeeType: platformFeeConfig?.type || "none",
      sellerIds: JSON.stringify(sellerIds),
      promoCodeId: promoCodeId || null,
      useLoyaltyPoints: useLoyaltyPoints ? "true" : "false",
      loyaltyPointsUsed: pointsToUse.toString(),
      loyaltyDiscount: loyaltyDiscount.toString(),
    };

    console.log("📦 Metadata buyer ID:", userId);
    console.log("💰 Metadata platform fee:", platformFeeAmount);
    console.log("🎁 Loyalty points used:", pointsToUse);
    console.log("💵 Loyalty discount:", loyaltyDiscount);

    // 💡 Step 6: Validate line items before creating session
    if (lineItems.length === 0) {
      return next(new AppError("No valid line items to process", 400));
    }

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      if (
        !item.price_data?.product_data?.name ||
        typeof item.price_data.product_data.name !== "string" ||
        item.price_data.product_data.name.trim().length === 0
      ) {
        console.error(`Line item ${i} missing or invalid product name:`, item);
        return next(
          new AppError(`Line item ${i + 1} is missing product name`, 400),
        );
      }
      if (!item.price_data?.unit_amount || item.price_data.unit_amount <= 0) {
        console.error(`Line item ${i} has invalid price:`, item);
        return next(new AppError(`Line item ${i + 1} has invalid price`, 400));
      }
    }

    console.log(
      `Creating Stripe Checkout Session with ${lineItems.length} line items`,
    );

    // 💡 Step 7: Find or create Stripe customer by email
    const customerEmail = shippingAddress?.email || req.user.email;
    let stripeCustomerId = null;

    if (customerEmail) {
      try {
        const existingCustomers = await stripe.customers.list({
          email: customerEmail,
          limit: 1,
        });

        if (existingCustomers.data.length > 0) {
          stripeCustomerId = existingCustomers.data[0].id;
          console.log(
            `✅ Found existing Stripe customer: ${stripeCustomerId} for email: ${customerEmail}`,
          );
        } else {
          const newCustomer = await stripe.customers.create({
            email: customerEmail,
            name: req.user.name || shippingAddress?.name,
            metadata: {
              userId: String(req.user._id || req.user.id),
            },
          });
          stripeCustomerId = newCustomer.id;
          console.log(
            `✅ Created new Stripe customer: ${stripeCustomerId} for email: ${customerEmail}`,
          );
        }
      } catch (error) {
        console.error("❌ Error finding/creating Stripe customer:", error);
      }
    }

    // 💡 Step 8: Create Stripe Checkout Session
    const getFrontendUrl = () => {
      if (process.env.FRONTEND_URL) {
        return process.env.FRONTEND_URL;
      }

      const origin = req.headers.origin || req.headers.referer;
      if (origin) {
        try {
          const url = new URL(origin);
          if (
            !url.hostname.includes("localhost") &&
            !url.hostname.includes("127.0.0.1")
          ) {
            return `${url.protocol}//${url.host}`;
          }
        } catch (e) {
          console.warn("Could not parse origin:", origin);
        }
      }

      return "http://localhost:3000";
    };

    const frontendUrl = getFrontendUrl();
    console.log("🌐 Frontend URL for Stripe redirect:", frontendUrl);

    const sessionConfig = {
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: `${frontendUrl}/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/order-cancel`,
      metadata: metadata,
    };

    // ✅ Add Stripe Connect configuration if seller has connected account
    // ✅ Settlement logic changed: We now hold the commission and settle every Wednesday.
    // Immediate transfer to seller is disabled.
    /*
    if (hasStripeConnect && platformFeeAmount > 0) {
      sessionConfig.payment_intent_data = {
        application_fee_amount: Math.round(platformFeeAmount * 100), // ✅ Platform fee in cents
        transfer_data: {
          destination: seller.sellerProfile.stripeAccountId, // ✅ Transfer to seller's account
        },
      };
  
      console.log(`✅ Stripe Connect configured:`);
      console.log(`   Destination: ${seller.sellerProfile.stripeAccountId}`);
      console.log(
        `   Application Fee: ${Math.round(platformFeeAmount * 100)} cents`,
      );
    }
    */

    if (stripeCustomerId) {
      sessionConfig.customer = stripeCustomerId;
    } else {
      sessionConfig.customer_email = customerEmail;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.status(200).json({
      status: "success",
      sessionId: session.id,
      url: session.url,
      breakdown: {
        productsSubtotal: subtotal,
        promoDiscount: promoDiscount,
        adminDiscount: adminDiscount,
        loyaltyDiscount: loyaltyDiscount,
        shippingCost: shippingCost,
        taxAmount: taxAmount,
        platformFee: platformFeeAmount,
        total: totalAmount,
        sellerReceives: breakdown.sellerReceives,
      },
    });
  } catch (error) {
    console.log(error, "SSSS==>");

    return next(new AppError(error.message, 400));
  }
});

// ✅ Create Order Immediately After Payment (called from frontend after payment success)
export const createOrderImmediately = catchAsync(async (req, res, next) => {
  const { sessionId } = req.body;
  const buyer = req.user._id || req.user.id;

  if (!sessionId) {
    return next(new AppError("Session ID is required", 400));
  }

  // Retrieve Stripe session to verify payment first
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error("❌ Failed to retrieve Stripe session:", err);
    return next(new AppError("Invalid session ID", 400));
  }

  // Verify payment was successful
  if (session.payment_status !== "paid") {
    console.error("❌ Payment not completed. Status:", session.payment_status);
    return next(new AppError("Payment not completed", 400));
  }

  // Get metadata from session
  const metadata = session.metadata || {};
  const metadataBuyer = metadata.buyer;

  console.log("\n========== CREATE ORDER IMMEDIATELY ==========");
  console.log("📦 Session ID:", sessionId);
  console.log("📦 Metadata buyer from session:", metadataBuyer);
  console.log("📦 Current user ID:", buyer);
  console.log("📦 User ID formats:", { _id: req.user._id, id: req.user.id });
  console.log("📦 Payment status:", session.payment_status);
  console.log("📦 Amount total:", session.amount_total);

  // Use metadata buyer if available, otherwise use current user
  // Purchase model expects buyer as String, so convert to string
  const finalBuyerString = metadataBuyer
    ? String(metadataBuyer)
    : String(buyer);

  // Verify buyer matches (for security) - log warning but proceed
  const buyerStr = String(buyer);
  const metadataBuyerStr = String(metadataBuyer || "");
  if (
    metadataBuyer &&
    buyerStr !== metadataBuyerStr &&
    req.user._id &&
    String(req.user._id) !== metadataBuyerStr &&
    req.user.id &&
    String(req.user.id) !== metadataBuyerStr
  ) {
    console.warn("⚠️ Buyer ID mismatch detected!");
    console.warn("   Metadata buyer:", metadataBuyerStr);
    console.warn("   Current user:", buyerStr);
    console.warn("   Using metadata buyer for order creation");
  }

  console.log("📦 Final buyer ID to use (as string):", finalBuyerString);
  console.log("==============================================\n");

  // Check if order already exists by sessionId OR paymentIntentId
  const existingOrder = await Purchase.findOne({
    $or: [
      { checkoutSessionId: sessionId },
      { paymentIntentId: session.payment_intent }
    ]
  });

  // Also check by buyer if order found
  if (existingOrder) {
    const orderBuyer = String(existingOrder.buyer);
    const currentBuyer = finalBuyerString;

    // If order exists and buyer matches (or session ID matches), return it
    if (
      orderBuyer === currentBuyer ||
      orderBuyer === buyerStr ||
      orderBuyer === String(req.user._id) ||
      orderBuyer === String(req.user.id) ||
      existingOrder.checkoutSessionId === sessionId
    ) {
      console.log("✅ Order already exists for this session, returning it");

      // Populate and format the existing order
      const populatedExisting = await Purchase.findById(existingOrder._id)
        .populate({
          path: "products.product",
          select: "title slug _id name",
        })
        .lean();

      // Format order to match expected format
      const products = (
        populatedExisting?.products || existingOrder.products
      ).map((p) => ({
        _id: p._id,
        quantity: p.quantity,
        price: p.price,
        seller: p.seller,
        product: {
          _id: p.product?._id || null,
          title: p.product?.title || p.product?.name || null,
          slug: p.product?.slug || null,
        },
      }));

      const totalItems = products.reduce((sum, p) => sum + p.quantity, 0);

      const formattedExistingOrder = {
        _id: existingOrder._id,
        orderId: existingOrder.orderId,
        trackingNumber: existingOrder.trackingNumber,
        totalItems,
        products,
        totalAmount: existingOrder.totalAmount,
        platformFee: existingOrder.platformFeeAmount || 0, // ✅ Include platform fee
        paymentStatus: existingOrder.paymentStatus,
        status: existingOrder.status,
        shippingAddress: existingOrder.shippingAddress,
        createdAt: existingOrder.createdAt,
        updatedAt: existingOrder.updatedAt,
      };

      return res.status(200).json({
        status: "success",
        message: "Order already exists",
        order: formattedExistingOrder,
      });
    }
  }

  let products = [];
  try {
    products = metadata.products ? JSON.parse(metadata.products) : [];
  } catch (parseError) {
    console.error("Failed to parse products from metadata:", parseError);
    return next(new AppError("Invalid products data in session", 400));
  }

  let shippingAddress = {};
  try {
    shippingAddress = metadata.shippingAddress
      ? JSON.parse(metadata.shippingAddress)
      : {};
  } catch (parseError) {
    console.error(
      "Failed to parse shipping address from metadata:",
      parseError,
    );
    // Continue with empty address if parsing fails
  }

  // ✅ Extract platform fee from metadata
  const platformFeeAmount = metadata.platformFeeAmount
    ? Number(metadata.platformFeeAmount)
    : 0;

  // Add taxAmount and shippingCost to shippingAddress for invoice display
  const taxAmount = metadata.taxAmount ? Number(metadata.taxAmount) : 0;
  const shippingCost = metadata.shippingCost
    ? Number(metadata.shippingCost)
    : 0;

  shippingAddress.taxAmount = taxAmount;
  shippingAddress.shippingCost = shippingCost;

  console.log("📦 Creating order with products:", products.length);
  console.log("📦 Products data:", JSON.stringify(products, null, 2));
  console.log("💰 Platform fee amount:", platformFeeAmount); // ✅ Log platform fee

  if (!products.length) {
    console.error("❌ No products found in metadata");
    return next(new AppError("No products in order", 400));
  }

  // Create purchase products
  const purchaseProducts = [];
  for (const item of products) {
    if (!item.product || !item.quantity) {
      console.error("Invalid product item:", item);
      continue;
    }

    const product = await Product.findById(item.product);
    if (!product) {
      console.error(`Product not found: ${item.product}`);
      continue;
    }

    // Use price from item if available (from cart), otherwise use product price
    let itemPrice = item.price ? Number(item.price) : Number(product.price);

    // If no price in item, calculate from product with discount
    if (!item.price) {
      itemPrice = Number(product.price);
      if (
        product.discount &&
        (!product.discountExpires ||
          new Date(product.discountExpires) >= new Date())
      ) {
        if (product.discountType === "fixed") itemPrice -= product.discount;
        else if (product.discountType === "percentage")
          itemPrice -= (itemPrice * product.discount) / 100;
        if (itemPrice < 0) itemPrice = 0;
      }
    }

    // Ensure seller ID is properly set
    const sellerId = product.createdBy || product.seller;
    console.log(
      `✅ Adding product: ${product.name || product.title}, Price: $${itemPrice}, Qty: ${item.quantity}`,
    );
    console.log(`   Seller ID: ${sellerId} (Type: ${typeof sellerId})`);

    // Update stock
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stockQuantity: -item.quantity },
    });

    // Purchase model expects seller as String, so convert to String
    const finalSellerId = String(sellerId);
    console.log(
      `   Final Seller ID (String): ${finalSellerId} (Type: ${typeof finalSellerId})`,
    );

    purchaseProducts.push({
      product: product._id,
      quantity: item.quantity,
      price: itemPrice,
      seller: finalSellerId, // Store as String (Purchase schema expects String)
      timeline: [
        {
          event: "Order Confirmed",
          timestamp: new Date(),
          location: "Seller",
        },
      ],
    });
  }

  if (purchaseProducts.length === 0) {
    console.error("❌ No valid products to create order");
    return next(new AppError("No valid products found to create order", 400));
  }

  const totalAmount = session.amount_total / 100;
  const orderId = generateUniqueOrderId();
  const trackingNumber = `TRK-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  // Create order immediately using finalBuyerString (from metadata, as string)
  let order;
  try {
    console.log("📦 Creating order with buyer (string):", finalBuyerString);
    console.log("💰 Platform fee to store:", platformFeeAmount); // ✅ Log before creation

    order = await Purchase.create({
      orderId,
      buyer: finalBuyerString, // Store as string (Purchase schema expects String)
      products: purchaseProducts,
      shippingAddress,
      totalAmount,
      platformFeeAmount, // ✅ Store platform fee
      paymentStatus: "paid",
      status: "new",
      paymentIntentId: session.payment_intent,
      checkoutSessionId: session.id,
      trackingNumber,
      orderTimeline: [
        {
          event: "Order Confirmed",
          timestamp: new Date(),
          location: "Seller",
        },
      ],
    });
    console.log(
      "✅ Order created successfully:",
      orderId,
      "Buyer (string):",
      finalBuyerString,
    );
    console.log("💰 Platform fee stored:", order.platformFeeAmount || 0); // ✅ Confirm storage

    // Record promo code usage if applicable
    const sessionMetadata = session.metadata || {};
    const usedPromoCodeId = sessionMetadata.promoCodeId || metadata.promoCodeId;

    if (usedPromoCodeId && finalBuyerString) {
      try {
        // Record the promo code usage
        await CustomerPromoCodeUse.create({
          user_id: finalBuyerString,
          promoCodeId: usedPromoCodeId,
          purchase_id: order._id,
        });

        // Update promo code usage count
        await PromoCode.findByIdAndUpdate(usedPromoCodeId, {
          $inc: { usedCount: 1 },
        });

        console.log(
          `✅ Promo code usage recorded: User ${finalBuyerString} used promo ${usedPromoCodeId}`,
        );
      } catch (promoError) {
        console.error("⚠️ Failed to record promo code usage:", promoError);
        // Don't fail the order if promo code tracking fails
      }
    }
  } catch (createError) {
    console.error("❌ Failed to create order:", createError);
    console.error("❌ Error details:", JSON.stringify(createError, null, 2));
    return next(
      new AppError(`Failed to create order: ${createError.message}`, 500),
    );
  }

  // ✅ Create SellerSettlement records for ALL sellers in this order
  try {
    const orderDate = new Date();
    const maturityDate = new Date(orderDate);
    maturityDate.setDate(maturityDate.getDate() + 3); // 3 Days Buffer
    const scheduledSettlementDate = calculateSettlementDate(maturityDate);

    // Group products by seller to create per-seller settlement records
    const sellerProductsMap = {};
    for (const pp of purchaseProducts) {
      const sId = String(pp.seller);
      if (!sellerProductsMap[sId]) sellerProductsMap[sId] = [];
      sellerProductsMap[sId].push(pp);
    }

    const orderSubtotal = purchaseProducts.reduce(
      (sum, pp) => sum + pp.price * pp.quantity,
      0,
    );

    for (const sId of Object.keys(sellerProductsMap)) {
      const sellerItems = sellerProductsMap[sId];
      const sellerSubtotal = sellerItems.reduce(
        (sum, pp) => sum + pp.price * pp.quantity,
        0,
      );
      // Proportional platform fee based on seller's share of the order
      const proportion = orderSubtotal > 0 ? sellerSubtotal / orderSubtotal : 0;
      const sellerPlatformFee =
        Math.round(platformFeeAmount * proportion * 100) / 100;
      const sellerCommission =
        Math.round((sellerSubtotal - sellerPlatformFee) * 100) / 100;

      await SellerSettlement.create({
        sellerId: sId,
        purchaseId: order._id,
        products: sellerItems.map((pp) => ({
          product: String(pp.product),
          quantity: pp.quantity,
          price: pp.price,
        })),
        totalOrderAmount: sellerSubtotal,
        commissionAmount: sellerCommission,
        platformFee: sellerPlatformFee,
        status: "pending",
        scheduledSettlementDate,
      });
      console.log(
        `✅ SellerSettlement created for seller ${sId} ($${sellerCommission}), scheduled for ${scheduledSettlementDate}`,
      );
    }
  } catch (settlementError) {
    console.error("⚠️ Failed to create seller settlements:", settlementError);
    // Don't fail the order if settlement creation fails
  }

  // Clear cart (use finalBuyerString)
  try {
    const { Cart } = await import("../../models/customers/cart.js");
    await Cart.deleteMany({
      $or: [
        { user: finalBuyerString },
        { user: buyer },
        { user: req.user._id },
        { user: req.user.id },
      ],
    });
    console.log("✅ Cart cleared for user:", finalBuyerString);
  } catch (cartError) {
    console.error("⚠️ Failed to clear cart:", cartError);
  }

  // Add loyalty points (use finalBuyerString)
  try {
    // Check if user has at least 3 orders before giving points
    const userOrderCount = await Purchase.countDocuments({
      buyer: finalBuyerString,
      paymentStatus: "paid",
    });

    console.log(`💎 Loyalty Points Processing for user ${finalBuyerString}:`);
    console.log(`   - User order count: ${userOrderCount}`);
    console.log(`   - Metadata:`, metadata);

    if (userOrderCount >= 3) {
      // 1 point per $10 spent (customize as needed)
      const pointsEarned = Math.floor(totalAmount / 10);
      if (pointsEarned > 0) {
        await LoyaltyPoint.create({
          user: finalBuyerString,
          points: pointsEarned,
          type: "earn",
          reason: "purchase",
          referenceId: orderId,
        });
        console.log(`✅ Awarded ${pointsEarned} loyalty points to user ${finalBuyerString}`);
      }
    } else {
      console.log(
        `Loyalty points not awarded: User ${finalBuyerString} has ${userOrderCount} orders (minimum 3 required).`,
      );
    }

    // Deduct loyalty points if used
    const useLoyaltyPoints = metadata.useLoyaltyPoints === "true";
    const loyaltyPointsUsed = Number(metadata.loyaltyPointsUsed || 0);

    console.log(`💎 Checking loyalty points deduction:`);
    console.log(`   - useLoyaltyPoints flag: ${useLoyaltyPoints} (type: ${typeof metadata.useLoyaltyPoints})`);
    console.log(`   - loyaltyPointsUsed: ${loyaltyPointsUsed}`);
    console.log(`   - Raw metadata.useLoyaltyPoints: "${metadata.useLoyaltyPoints}"`);
    console.log(`   - Raw metadata.loyaltyPointsUsed: "${metadata.loyaltyPointsUsed}"`);

    if (useLoyaltyPoints && loyaltyPointsUsed > 0) {
      console.log(`💎 Creating redeem record...`);
      await LoyaltyPoint.create({
        user: finalBuyerString,
        points: Math.abs(loyaltyPointsUsed), // Store as positive number
        type: "redeem",
        reason: "purchase",
        referenceId: orderId,
      });
      console.log(
        `✅ Deducted ${loyaltyPointsUsed} loyalty points from user ${finalBuyerString}`,
      );
    } else {
      console.log(`⚠️ Loyalty points NOT deducted - condition not met`);
    }
  } catch (pointsError) {
    console.error("⚠️ Failed to add loyalty points:", pointsError);
  }

  // ✅ Send notifications to sellers about new order
  try {
    const { Notification } =
      await import("../../models/common/notification.js");
    const { User } = await import("../../models/users.js");

    // Get unique seller IDs from purchaseProducts
    const uniqueSellerIds = [...new Set(purchaseProducts.map((p) => p.seller))];

    // Create notification for each seller
    const notificationPromises = uniqueSellerIds.map(async (sellerId) => {
      try {
        const seller = await User.findById(sellerId);
        if (seller) {
          // ✅ Calculate seller's portion (after platform fee if applicable)
          const sellerProducts = purchaseProducts.filter(
            (p) => p.seller === sellerId,
          );
          const sellerSubtotal = sellerProducts.reduce(
            (sum, p) => sum + p.price * p.quantity,
            0,
          );

          // If this is a Stripe Connect payment, mention net amount
          let amountMessage = `Total: $${sellerSubtotal.toFixed(2)}`;
          if (platformFeeAmount > 0) {
            // Calculate proportional platform fee for this seller
            const sellerProportion = sellerSubtotal / totalAmount;
            const sellerPlatformFee = platformFeeAmount * sellerProportion;
            const sellerNetAmount = sellerSubtotal - sellerPlatformFee;
            amountMessage = `Subtotal: $${sellerSubtotal.toFixed(2)} (You receive: $${sellerNetAmount.toFixed(2)} after platform fee)`;
          }

          await Notification.create({
            user: String(sellerId),
            type: "order_placed",
            title: "New Order Received",
            message: `You have received a new order (${orderId}) with ${sellerProducts.length} product(s). ${amountMessage}`,
            orderId: orderId,
            order: String(order._id),
            metadata: {
              totalAmount: sellerSubtotal,
              platformFee:
                platformFeeAmount > 0
                  ? platformFeeAmount * (sellerSubtotal / totalAmount)
                  : 0,
              productCount: sellerProducts.length,
            },
          });
        }
      } catch (notifError) {
        console.error(
          `⚠️ Failed to create notification for seller ${sellerId}:`,
          notifError,
        );
      }
    });

    await Promise.all(notificationPromises);
    console.log("✅ Notifications sent to sellers");
  } catch (notifError) {
    console.error("⚠️ Failed to send notifications:", notifError);
  }

  // Populate order with product details for response
  const populatedOrder = await Purchase.findById(order._id)
    .populate({
      path: "products.product",
      select: "title slug _id name",
    })
    .lean();

  // Format order to match getOrderBySessionId format
  const formattedProducts = (populatedOrder?.products || order.products).map(
    (p) => ({
      _id: p._id,
      quantity: p.quantity,
      price: p.price,
      seller: p.seller,
      product: {
        _id: p.product?._id || null,
        title: p.product?.title || p.product?.name || null,
        slug: p.product?.slug || null,
      },
    }),
  );

  const totalItems = formattedProducts.reduce((sum, p) => sum + p.quantity, 0);

  const formattedOrder = {
    _id: order._id,
    orderId: order.orderId,
    trackingNumber: order.trackingNumber,
    totalItems,
    products: formattedProducts,
    totalAmount: order.totalAmount,
    platformFee: platformFeeAmount, // ✅ Include platform fee in response
    sellerReceives: totalAmount - platformFeeAmount, // ✅ What seller gets
    paymentStatus: order.paymentStatus,
    status: order.status,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };

  console.log("✅ Order created and formatted:", formattedOrder.orderId);
  console.log("💰 Platform fee:", platformFeeAmount);
  console.log("💰 Seller receives:", totalAmount - platformFeeAmount);

  res.status(201).json({
    status: "success",
    message: "Order created successfully",
    order: formattedOrder,
  });
});

// ✅ Webhook + retry + ProductPerformance update
const MAX_RETRIES = 3;

const createPurchaseFromPaymentIntent = async (paymentIntent) => {
  let attempt = 0;
  let success = false;

  while (!success && attempt < 3) {
    let session = await mongoose.startSession();
    session.startTransaction();

    try {
      let metadata = paymentIntent.metadata || {};
      if (!metadata.buyer) {
        console.log(
          "⚠️ No metadata on payment intent, fetching checkout session...",
        );

        const sessions = await stripe.checkout.sessions.list({
          payment_intent: paymentIntent.id,
          limit: 1,
        });

        if (!sessions.data.length) {
          throw new Error(
            "No checkout session found for payment intent: " + paymentIntent.id,
          );
        }

        metadata = sessions.data[0].metadata || {};
        console.log("✅ Metadata fetched from checkout session:", metadata);
      }
      const buyer = metadata.buyer;
      const products = metadata.products ? JSON.parse(metadata.products) : [];
      const shippingAddress = metadata.shippingAddress
        ? JSON.parse(metadata.shippingAddress)
        : {};

      if (!buyer || !products.length)
        throw new Error("Missing buyer or products info");

      // ✅ Check duplicate purchase
      const existingPurchase = await Purchase.findOne({
        paymentIntentId: paymentIntent.id,
      }).session(session);
      if (existingPurchase) {
        console.log("Purchase already exists, skipping creation");
        await session.commitTransaction();
        session.endSession();
        return;
      }

      const purchaseProducts = [];

      for (const item of products) {
        const product = await Product.findOneAndUpdate(
          { _id: item.product, stockQuantity: { $gte: item.quantity } },
          { $inc: { stockQuantity: -item.quantity } },
          { new: true, session },
        );

        if (!product)
          throw new Error(
            `Insufficient stock or write conflict for ${item.product}`,
          );

        // ✅ Update ProductPerformance with final paid price
        const perf = await ProductPerformance.findOne({
          product: product._id,
        }).session(session);
        if (perf) {
          perf.currentStock -= item.quantity;
          perf.totalSales += item.quantity * item.price; // paid price
          perf.totalQuantitySold += item.quantity;
          await perf.save({ session });
        }

        // ✅ Add individual product timeline
        purchaseProducts.push({
          product: product._id,
          quantity: item.quantity,
          price: item.price,
          seller: String(product.createdBy), // Store as String (Purchase schema expects String)
          timeline: [
            {
              event: "Order Confirmed",
              timestamp: new Date(),
              location: "Seller",
            },
          ],
        });
      }

      const totalAmount = Number(paymentIntent.amount) / 100;
      const orderId = generateUniqueOrderId();

      // 🟩 Tracking Number
      const randomHex = crypto.randomBytes(4).toString("hex").toUpperCase();
      const trackingNumber = `TRK-${Date.now()}-${randomHex}`;

      const purchase = await Purchase.create(
        [
          {
            orderId,
            buyer,
            products: purchaseProducts,
            shippingAddress,
            totalAmount,
            paymentStatus: "paid",
            status: "new",
            paymentIntentId: paymentIntent.id,
            trackingNumber,
            platformFeeAmount: Number(metadata.platformFeeAmount) || 0,
            orderTimeline: [
              {
                event: "Order Confirmed",
                timestamp: new Date(),
                location: "Seller",
              },
            ],
          },
        ],
        { session },
      );

      // ✅ Create SellerSettlement records for ALL sellers in this order
      const platformFeeAmount = Number(metadata.platformFeeAmount) || 0;

      const orderDate = new Date();
      const maturityDate = new Date(orderDate);
      maturityDate.setDate(maturityDate.getDate() + 3); // 3 Days Buffer
      const scheduledSettlementDate = calculateSettlementDate(maturityDate);

      // Group products by seller to create per-seller settlement records
      const sellerProductsMap = {};
      for (const pp of purchaseProducts) {
        const sId = String(pp.seller);
        if (!sellerProductsMap[sId]) sellerProductsMap[sId] = [];
        sellerProductsMap[sId].push(pp);
      }

      const orderSubtotal = purchaseProducts.reduce(
        (sum, pp) => sum + pp.price * pp.quantity,
        0,
      );

      for (const sId of Object.keys(sellerProductsMap)) {
        const sellerItems = sellerProductsMap[sId];
        const sellerSubtotal = sellerItems.reduce(
          (sum, pp) => sum + pp.price * pp.quantity,
          0,
        );
        // Proportional platform fee based on seller's share of the order
        const proportion =
          orderSubtotal > 0 ? sellerSubtotal / orderSubtotal : 0;
        const sellerPlatformFee =
          Math.round(platformFeeAmount * proportion * 100) / 100;
        const sellerCommission =
          Math.round((sellerSubtotal - sellerPlatformFee) * 100) / 100;

        await SellerSettlement.create(
          [
            {
              sellerId: sId,
              purchaseId: purchase[0]._id,
              products: sellerItems.map((pp) => ({
                product: String(pp.product),
                quantity: pp.quantity,
                price: pp.price,
              })),
              totalOrderAmount: sellerSubtotal,
              commissionAmount: sellerCommission,
              platformFee: sellerPlatformFee,
              status: "pending",
              scheduledSettlementDate,
            },
          ],
          { session },
        );
        console.log(
          `✅ SellerSettlement created for seller ${sId} ($${sellerCommission}), scheduled for ${scheduledSettlementDate}`,
        );
      }

      // ✅ Add Loyalty Points AFTER purchase creation
      try {
        const userOrderCount = await Purchase.countDocuments({
          buyer: buyer,
          paymentStatus: "paid",
        }).session(session);

        console.log(`💎 Loyalty Points Processing for user ${buyer}:`);
        console.log(`   - User order count: ${userOrderCount}`);
        console.log(`   - Metadata:`, metadata);

        if (userOrderCount >= 3) {
          const pointsEarned = Math.floor(totalAmount / 10); // $10 spent = 1 point
          if (pointsEarned > 0) {
            await LoyaltyPoint.create(
              [
                {
                  user: buyer,
                  points: pointsEarned,
                  type: "earn",
                  reason: "purchase",
                  referenceId: orderId,
                },
              ],
              { session },
            );
            console.log(`✅ Awarded ${pointsEarned} loyalty points to user ${buyer}`);
          }
        } else {
          console.log(
            `ℹ️ Loyalty points not awarded: User ${buyer} has ${userOrderCount} orders (minimum 3 required).`,
          );
        }

        // Deduct loyalty points if used
        const useLoyaltyPoints = metadata.useLoyaltyPoints === "true";
        const loyaltyPointsUsed = Number(metadata.loyaltyPointsUsed || 0);

        console.log(`💎 Checking loyalty points deduction:`);
        console.log(`   - useLoyaltyPoints flag: ${useLoyaltyPoints} (type: ${typeof metadata.useLoyaltyPoints})`);
        console.log(`   - loyaltyPointsUsed: ${loyaltyPointsUsed}`);
        console.log(`   - Raw metadata.useLoyaltyPoints: "${metadata.useLoyaltyPoints}"`);
        console.log(`   - Raw metadata.loyaltyPointsUsed: "${metadata.loyaltyPointsUsed}"`);

        if (useLoyaltyPoints && loyaltyPointsUsed > 0) {
          console.log(`💎 Creating redeem record...`);
          await LoyaltyPoint.create(
            [
              {
                user: buyer,
                points: Math.abs(loyaltyPointsUsed), // Store as positive number
                type: "redeem",
                reason: "purchase",
                referenceId: orderId,
              },
            ],
            { session },
          );
          console.log(
            `✅ Deducted ${loyaltyPointsUsed} loyalty points from user ${buyer}`,
          );
        } else {
          console.log(`⚠️ Loyalty points NOT deducted - condition not met`);
        }
      } catch (pointsError) {
        console.error("⚠️ Failed to add loyalty points:", pointsError);
      }

      // ✅ Clear cart after successful order
      try {
        const { Cart } = await import("../../models/customers/cart.js");
        await Cart.deleteMany({ user: buyer }).session(session);
        console.log("✅ Cart cleared for user:", buyer);
      } catch (cartError) {
        console.error("⚠️ Failed to clear cart:", cartError);
        // Don't fail the order if cart clearing fails
      }

      // Record promo code usage if applicable
      const usedPromoCodeId = metadata.promoCodeId;
      if (usedPromoCodeId && buyer) {
        try {
          // Record the promo code usage
          await CustomerPromoCodeUse.create(
            [
              {
                user_id: buyer,
                promoCodeId: usedPromoCodeId,
                purchase_id: orderId, // We'll update this with the actual purchase ID after creation
              },
            ],
            { session },
          );

          // Update promo code usage count
          await PromoCode.findByIdAndUpdate(
            usedPromoCodeId,
            { $inc: { usedCount: 1 } },
            { session },
          );

          console.log(
            `✅ Promo code usage recorded in payment intent: User ${buyer} used promo ${usedPromoCodeId}`,
          );
        } catch (promoError) {
          console.error(
            "⚠️ Failed to record promo code usage in payment intent:",
            promoError,
          );
          // Don't fail the order if promo code tracking fails
        }
      }

      await session.commitTransaction();
      session.endSession();
      success = true;
      console.log(
        "✅ Purchase saved successfully & loyalty points added & cart cleared!",
      );
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      attempt++;
      if (attempt >= 3) throw err;
      console.log(`⚠️ Transaction conflict, retrying... Attempt ${attempt}`);
    }
  }
};
// 🔹 Handle Full or Partial Refund
const handleRefund = async (charge) => {
  try {
    const paymentIntentId = charge.payment_intent;

    // Find the purchase by payment intent
    const purchase = await Purchase.findOne({ paymentIntentId });

    if (!purchase) {
      console.error("❌ Purchase not found for charge:", charge.id);
      return;
    }

    // Calculate refund amount
    const refundAmount = charge.amount_refunded / 100;
    const isFullRefund = charge.refunded; // true if fully refunded

    // ✅ Get platform fee from metadata
    const platformFeeAmount = purchase.platformFeeAmount || 0;
    const hasPlatformFee = platformFeeAmount > 0;

    // ✅ Calculate application fee refund
    let platformFeeRefunded = 0;
    if (hasPlatformFee) {
      if (isFullRefund) {
        platformFeeRefunded = platformFeeAmount;
      } else {
        const refundPercentage = refundAmount / purchase.totalAmount;
        platformFeeRefunded = platformFeeAmount * refundPercentage;
        platformFeeRefunded = Math.round(platformFeeRefunded * 100) / 100;
      }
    }

    // Add refund timeline event at order level
    purchase.orderTimeline.push({
      event: isFullRefund ? "Full Refund Issued" : "Partial Refund Issued",
      timestamp: new Date(),
      location: "System",
      notes: `Refund amount: $${refundAmount.toFixed(2)}${hasPlatformFee ? `, Platform fee reversed: $${platformFeeRefunded.toFixed(2)}` : ""}`,
    });

    // If full refund, restore stock for all products
    if (isFullRefund) {
      for (const item of purchase.products) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stockQuantity: item.quantity },
        });

        item.timeline.push({
          event: "Stock Restored (Refund)",
          timestamp: new Date(),
          location: "System",
        });
      }

      purchase.status = "refunded";
    }

    await purchase.save();

    // ✅ Check refund metadata for seller/product information
    const refundMetadata = charge.refunds?.data?.[0]?.metadata || {};
    const refundProductId = refundMetadata.productId || null;
    const refundSellerId = refundMetadata.sellerId || null;

    // ✅ Get all settlements for this purchase
    const settlements = await SellerSettlement.find({
      purchaseId: purchase._id,
    });

    // ✅ CASE 1: Refund includes specific product/seller info (from createRefund with productId)
    if (refundProductId && refundSellerId) {
      console.log(
        `📦 Processing seller-specific refund: Product ${refundProductId}, Seller ${refundSellerId}`,
      );

      // Find the specific seller's settlement
      const sellerSettlement = settlements.find(
        (s) => String(s.sellerId) === String(refundSellerId),
      );

      if (sellerSettlement) {
        // Find the specific product in this settlement
        const settlementProduct = sellerSettlement.products.find(
          (p) => String(p.product) === String(refundProductId),
        );

        if (settlementProduct) {
          // Mark ONLY this product as refunded
          settlementProduct.refundStatus = "refunded";
          settlementProduct.refundAmount = refundAmount;
          settlementProduct.refundedAt = new Date();

          // Update settlement refund tracking
          sellerSettlement.refundDeductions =
            (sellerSettlement.refundDeductions || 0) + refundAmount;

          // Calculate commission deduction
          const commissionDeduction =
            sellerSettlement.commissionAmount *
            (refundAmount / sellerSettlement.totalOrderAmount);
          sellerSettlement.commissionAmount -= commissionDeduction;

          // Update settlement overall refund status - check THIS seller's products only
          const allProductsRefunded = sellerSettlement.products.every(
            (p) => p.refundStatus === "refunded",
          );
          const anyProductsRefunded = sellerSettlement.products.some(
            (p) => p.refundStatus === "refunded",
          );

          // Set refundStatus based on this seller's completion
          sellerSettlement.refundStatus = allProductsRefunded
            ? "full"
            : anyProductsRefunded
              ? "partial"
              : "none";

          // Update settlement status when all seller products are refunded
          if (allProductsRefunded) {
            sellerSettlement.status = "refunded";
          }

          await sellerSettlement.save();
          console.log(
            `✅ SellerSettlement updated for seller ${refundSellerId}: refundStatus="${sellerSettlement.refundStatus}", status="${sellerSettlement.status}", allProductsRefunded=${allProductsRefunded}, totalProducts=${sellerSettlement.products.length}`,
          );
        } else {
          console.error(
            `❌ Product ${refundProductId} not found in settlement for seller ${refundSellerId}`,
          );
        }
      } else {
        console.error(`❌ Settlement not found for seller ${refundSellerId}`);
      }
    }
    // ✅ CASE 2: Full order refund (all sellers)
    else if (isFullRefund) {
      console.log(`📦 Processing FULL order refund - updating ALL sellers`);

      for (const settlement of settlements) {
        // Calculate this seller's proportion of the order
        const sellerProportion =
          settlement.totalOrderAmount / purchase.totalAmount;
        const sellerRefundAmount = refundAmount * sellerProportion;

        // Update each product in this settlement proportionally
        for (const product of settlement.products) {
          const productValue = product.price * product.quantity;
          const productProportion =
            settlement.totalOrderAmount > 0
              ? productValue / settlement.totalOrderAmount
              : 0;
          const productRefundAmount = sellerRefundAmount * productProportion;

          product.refundAmount =
            (product.refundAmount || 0) + productRefundAmount;
          product.refundStatus = "refunded";
          product.refundedAt = new Date();
        }

        // Update settlement refund tracking
        settlement.refundDeductions += sellerRefundAmount;

        // Calculate commission deduction
        const commissionDeduction =
          settlement.commissionAmount *
          (sellerRefundAmount / settlement.totalOrderAmount);
        settlement.commissionAmount -= commissionDeduction;

        // Update settlement overall refund status
        settlement.refundStatus = "full";
        settlement.status = "refunded";

        await settlement.save();
        console.log(
          `✅ SellerSettlement updated for seller ${settlement.sellerId} (full refund): Deducted $${commissionDeduction}`,
        );
      }
    }
    // ✅ CASE 3: Partial refund without product info (legacy/platform refund)
    // This happens when customer initiates refund from Stripe dashboard without product details
    // We distribute proportionally but DON'T mark products as fully refunded
    else {
      console.log(
        `📦 Processing PARTIAL refund without product info - distributing proportionally`,
      );

      for (const settlement of settlements) {
        const sellerProportion =
          settlement.totalOrderAmount / purchase.totalAmount;
        const sellerRefundAmount = refundAmount * sellerProportion;

        // Add to refund deductions but DON'T change product refundStatus
        // This tracks the money deducted without marking products as refunded
        settlement.refundDeductions =
          (settlement.refundDeductions || 0) + sellerRefundAmount;

        const commissionDeduction =
          settlement.commissionAmount *
          (sellerRefundAmount / settlement.totalOrderAmount);
        settlement.commissionAmount -= commissionDeduction;

        // Mark as partial if there's any refund
        if (sellerRefundAmount > 0 && settlement.refundStatus !== "full") {
          settlement.refundStatus = "partial";
        }

        await settlement.save();
        console.log(
          `✅ SellerSettlement updated for seller ${settlement.sellerId} (partial refund): Deducted $${commissionDeduction}`,
        );
      }
    }

    // ✅ Update purchase payment status based on all settlements
    await updatePurchasePaymentStatus(purchase._id);

    console.log(
      `✅ ${isFullRefund ? "Full" : "Partial"} refund processed for order:`,
      purchase.orderId,
    );
    if (hasPlatformFee) {
      console.log(
        `   Platform fee reversed: $${platformFeeRefunded.toFixed(2)}`,
      );
    }
  } catch (err) {
    console.error("❌ Error handling refund:", err);
    throw err;
  }
};

// 🔹 Handle Dispute/Chargeback Created
const handleDisputeCreated = async (dispute) => {
  try {
    const chargeId = dispute.charge;

    // Find purchase by charge ID or payment intent
    const purchase = await Purchase.findOne({
      $or: [{ chargeId }, { paymentIntentId: dispute.payment_intent }],
    });

    if (!purchase) {
      console.error("❌ Purchase not found for dispute:", dispute.id);
      return;
    }

    // ✅ Get platform fee information
    const platformFeeAmount = purchase.platformFeeAmount || 0;

    // Update purchase with dispute information
    purchase.disputeStatus = "under_review";
    purchase.disputeId = dispute.id;
    purchase.disputeReason = dispute.reason;
    purchase.disputeAmount = dispute.amount / 100;
    purchase.disputeCreatedAt = new Date(dispute.created * 1000);

    // Add dispute timeline event
    purchase.orderTimeline.push({
      event: "Chargeback Dispute Created",
      timestamp: new Date(),
      location: "System",
      notes: `Reason: ${dispute.reason}, Amount: $${(dispute.amount / 100).toFixed(2)}${platformFeeAmount > 0 ? `, Platform fee at risk: $${platformFeeAmount.toFixed(2)}` : ""}`,
    });

    // Mark payment status as disputed
    purchase.paymentStatus = "disputed";

    await purchase.save();

    console.log("⚠️ Dispute created for order:", purchase.orderId);
    if (platformFeeAmount > 0) {
      console.log(
        `   ⚠️ Platform fee at risk: $${platformFeeAmount.toFixed(2)}`,
      );
    }

    // TODO: Send email notification to seller about dispute
    // await sendDisputeNotificationToSeller(purchase);
  } catch (err) {
    console.error("❌ Error handling dispute creation:", err);
    throw err;
  }
};

// 🔹 Handle Dispute Updated
const handleDisputeUpdated = async (dispute) => {
  try {
    const purchase = await Purchase.findOne({ disputeId: dispute.id });

    if (!purchase) {
      console.error("❌ Purchase not found for dispute:", dispute.id);
      return;
    }

    // Update dispute status
    purchase.disputeStatus = dispute.status;

    // Add timeline event
    purchase.orderTimeline.push({
      event: "Dispute Status Updated",
      timestamp: new Date(),
      location: "System",
      notes: `New status: ${dispute.status}`,
    });

    await purchase.save();

    console.log("✅ Dispute updated for order:", purchase.orderId);
  } catch (err) {
    console.error("❌ Error handling dispute update:", err);
    throw err;
  }
};

// 🔹 Handle Dispute Closed
const handleDisputeClosed = async (dispute) => {
  try {
    const purchase = await Purchase.findOne({ disputeId: dispute.id });

    if (!purchase) {
      console.error("❌ Purchase not found for dispute:", dispute.id);
      return;
    }

    // ✅ Get platform fee information
    const platformFeeAmount = purchase.platformFeeAmount || 0;
    const hasPlatformFee = platformFeeAmount > 0;

    // Update dispute status
    purchase.disputeStatus = dispute.status; // 'won', 'lost', or 'warning_closed'
    purchase.disputeClosedAt = new Date();

    // Handle based on outcome
    if (dispute.status === "lost") {
      // Seller lost the dispute - treat as refund
      purchase.paymentStatus = "refunded";
      purchase.status = "refunded";
      purchase.refundAmount = dispute.amount / 100;
      purchase.refundedAt = new Date();

      // ✅ Platform fee is reversed when dispute is lost
      if (hasPlatformFee) {
        purchase.platformFeeRefunded = platformFeeAmount;
      }

      // Restore stock
      for (const item of purchase.products) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stockQuantity: item.quantity },
        });

        item.timeline.push({
          event: "Stock Restored (Dispute Lost)",
          timestamp: new Date(),
          location: "System",
        });
      }

      purchase.orderTimeline.push({
        event: "Dispute Lost - Refund Issued",
        timestamp: new Date(),
        location: "System",
        notes: `Chargeback amount: $${(dispute.amount / 100).toFixed(2)}${hasPlatformFee ? `, Platform fee reversed: $${platformFeeAmount.toFixed(2)}` : ""}`,
      });

      console.log(
        `❌ Dispute lost for order ${purchase.orderId}. Chargeback: $${(dispute.amount / 100).toFixed(2)}`,
      );
      if (hasPlatformFee) {
        console.log(
          `   Platform fee reversed: $${platformFeeAmount.toFixed(2)}`,
        );
      }
    } else if (dispute.status === "won") {
      // Seller won the dispute - platform fee retained
      purchase.paymentStatus = "paid";

      purchase.orderTimeline.push({
        event: "Dispute Won",
        timestamp: new Date(),
        location: "System",
        notes: `Payment retained${hasPlatformFee ? `, Platform fee retained: $${platformFeeAmount.toFixed(2)}` : ""}`,
      });

      console.log(`✅ Dispute won for order ${purchase.orderId}`);
      if (hasPlatformFee) {
        console.log(
          `   Platform fee retained: $${platformFeeAmount.toFixed(2)}`,
        );
      }
    } else {
      // Warning closed or other status
      purchase.orderTimeline.push({
        event: "Dispute Closed",
        timestamp: new Date(),
        location: "System",
        notes: `Status: ${dispute.status}`,
      });
    }

    await purchase.save();

    // ✅ Update SellerSettlement for settlement/chargeback (ALL sellers in this order)
    const settlements = await SellerSettlement.find({
      purchaseId: purchase._id,
      status: "pending",
    });

    if (dispute.status === "lost") {
      const lostAmount = dispute.amount / 100;

      for (const settlement of settlements) {
        // Proportional deduction based on seller's share of the order
        const sellerProportion =
          settlement.totalOrderAmount / purchase.totalAmount;
        const sellerLostAmount = lostAmount * sellerProportion;
        const refundPercentage = Math.min(
          1,
          sellerLostAmount / settlement.totalOrderAmount,
        );
        const commissionDeduction =
          settlement.commissionAmount * refundPercentage;

        settlement.commissionAmount -= commissionDeduction;
        settlement.refundDeductions += sellerLostAmount;

        if (refundPercentage >= 1) {
          settlement.status = "refunded";
        }

        await settlement.save();
        console.log(
          `✅ SellerSettlement updated for lost dispute (seller ${settlement.sellerId}): Deducted $${commissionDeduction.toFixed(2)} from commission`,
        );
      }
    }

    console.log(
      `✅ Dispute closed (${dispute.status}) for order:`,
      purchase.orderId,
    );

    // TODO: Send email notification about dispute resolution
    // await sendDisputeResolutionEmail(purchase, dispute.status);
  } catch (err) {
    console.error("❌ Error handling dispute closure:", err);
    throw err;
  }
};

// ✅ Customer Requests a Refund (Does NOT move money, just updates status)
export const requestRefundByCustomer = catchAsync(async (req, res, next) => {
  const { orderId, amount, reason } = req.body;
  const userId = req.user.id; // From auth middleware

  // 1. Find the order and ensure it belongs to this user
  const purchase = await Purchase.findOne({ orderId, buyer: userId });

  if (!purchase) {
    return next(new AppError("Order not found or access denied", 404));
  }

  // 2. Validate Status
  if (purchase.status !== "delivered") {
    return next(new AppError("Only delivered orders can be refunded", 400));
  }
  if (
    purchase.paymentStatus === "refunded" ||
    purchase.paymentStatus === "return_requested"
  ) {
    return next(new AppError("Refund already requested or processed", 400));
  }

  // 3. Check 3-Day Buffer (Server-side validation matches your settlement logic)
  const orderDate = new Date(purchase.createdAt);
  const deadline = new Date(orderDate);
  deadline.setDate(deadline.getDate() + 3); // 3 Days

  if (new Date() > deadline) {
    return next(new AppError("Refund window has expired (3 days)", 400));
  }

  // 4. Update Order Status
  // We use a specific status so the Seller knows an action is required
  purchase.status = "return_requested";

  // We can store the requested info in the refundReason field temporarily
  // or add new fields like 'returnRequestReason' to your schema if you prefer.
  purchase.refundReason = reason;
  purchase.refundAmount = amount; // Storing requested amount (not refunded yet)

  // Add to Timeline
  purchase.orderTimeline.push({
    event: "Return Requested",
    timestamp: new Date(),
    location: "Customer",
    notes: `Reason: ${reason}, Amount: $${amount}`,
  });

  await purchase.save();

  // 5. Notify Seller (Crucial Step)
  try {
    const { Notification } =
      await import("../../models/common/notification.js");

    // Get unique sellers involved
    const sellerIds = [...new Set(purchase.products.map((p) => p.seller))];

    for (const sellerId of sellerIds) {
      await Notification.create({
        user: sellerId,
        type: "return_request",
        title: "Return Requested",
        message: `Customer has requested a return for Order #${orderId}. Reason: ${reason}`,
        orderId: orderId,
        order: purchase._id,
      });
    }
  } catch (err) {
    console.error("Failed to send return notification:", err);
  }

  res.status(200).json({
    status: "success",
    message: "Refund request submitted. The seller will review your request.",
    order: purchase,
  });
});

// 🔹 Manual Refund Controller (for admin/seller initiated refunds)
export const createRefund = catchAsync(async (req, res, next) => {
  const { orderId, amount, reason, action, productId, sellerId } = req.body;

  // 1. Find the purchase
  const purchase = await Purchase.findOne({ orderId });

  // Handle Refund/Return Rejection
  if (action === "reject") {
    if (!purchase) {
      return next(new AppError("Order not found", 404));
    }

    // If productId provided, reject at settlement level
    if (productId) {
      const product = purchase.products.find(
        (p) => String(p.product) === String(productId),
      );
      if (product) {
        const productSellerId = String(product.seller || sellerId);
        // Update settlement instead of purchase
        const settlement = await SellerSettlement.findOne({
          purchaseId: purchase._id,
          sellerId: productSellerId,
        });
        if (settlement) {
          const settlementProduct = settlement.products.find(
            (p) => String(p.product) === String(productId),
          );
          if (settlementProduct) {
            settlementProduct.refundStatus = "rejected";
            settlementProduct.refundReason = reason || "Refund rejected";
            await settlement.save();
          }
        }
      }
      await purchase.save();
    } else {
      if (purchase.status !== "return_requested") {
        return next(
          new AppError("Order is not in return_requested status", 400),
        );
      }

      purchase.status = "return_rejected";
      purchase.orderTimeline.push({
        event: "Return Rejected",
        timestamp: new Date(),
        location: "Admin/Seller",
        notes: `Reason: ${reason || "Refund rejected"}`,
      });

      await purchase.save();
    }

    // Notify Customer about rejection
    try {
      const { Notification } =
        await import("../../models/common/notification.js");

      await Notification.create({
        user: purchase.buyer,
        type: "return_rejected",
        title: "Return Request Rejected",
        message: `Your return request for Order #${orderId} has been rejected. Reason: ${reason || "Refund rejected"}`,
        orderId: orderId,
        order: purchase._id,
      });
    } catch (err) {
      console.error("Failed to send rejection notification:", err);
    }

    return res.status(200).json({
      success: true,
      message: "Return request rejected successfully",
      order: purchase,
    });
  }

  if (!purchase) {
    return next(new AppError("Order not found", 404));
  }

  if (!purchase.paymentIntentId) {
    return next(new AppError("No payment intent found for this order", 400));
  }

  // 2. Handle product-specific refund (multi-seller scenario)
  if (productId) {
    // Find the specific product in the order
    const product = purchase.products.find(
      (p) => String(p.product) === String(productId),
    );

    if (!product) {
      return next(new AppError("Product not found in order", 404));
    }

    // Determine the seller for this product
    const productSellerId = String(product.seller || sellerId);
    if (!productSellerId) {
      return next(
        new AppError("Seller information not found for this product", 400),
      );
    }

    // Check if already refunded in settlement
    const settlement = await SellerSettlement.findOne({
      purchaseId: purchase._id,
      sellerId: productSellerId,
    });

    if (settlement) {
      const settlementProduct = settlement.products.find(
        (p) => String(p.product) === String(productId),
      );
      if (settlementProduct && settlementProduct.refundStatus === "refunded") {
        return next(new AppError("This product is already refunded", 400));
      }
    }

    // Calculate refund amount (default to product price * quantity)
    const productRefundAmount = amount || product.price * product.quantity;
    const isFullProductRefund =
      productRefundAmount >= product.price * product.quantity;

    // Get platform fee information
    const platformFeeAmount = purchase.platformFeeAmount || 0;
    const productProportion =
      purchase.totalAmount > 0
        ? (product.price * product.quantity) / purchase.totalAmount
        : 0;
    const platformFeeRefund = platformFeeAmount * productProportion;

    // 3. Create refund in Stripe
    const refundConfig = {
      payment_intent: purchase.paymentIntentId,
      amount: Math.round(productRefundAmount * 100),
      reason: "requested_by_customer",
      metadata: {
        orderId: purchase.orderId,
        productId: String(product.product),
        sellerId: productSellerId,
        refundType: isFullProductRefund ? "full_product" : "partial_product",
        platformFeeRefunded: platformFeeRefund.toString(),
      },
    };

    const refund = await stripe.refunds.create(refundConfig);

    // 4. Update the specific seller's settlement (NOT purchase products)
    if (settlement) {
      const settlementProduct = settlement.products.find(
        (p) => String(p.product) === String(product.product),
      );

      if (settlementProduct) {
        settlementProduct.refundStatus = "refunded";
        settlementProduct.refundAmount = productRefundAmount;
        settlementProduct.refundedAt = new Date();
        settlementProduct.refundReason = reason || "Manual refund";
      }

      // Update settlement refund tracking
      settlement.refundDeductions =
        (settlement.refundDeductions || 0) + productRefundAmount;

      // Calculate commission deduction
      const commissionDeduction =
        settlement.commissionAmount *
        (productRefundAmount / settlement.totalOrderAmount);
      settlement.commissionAmount -= commissionDeduction;

      // Update settlement overall refund status - check THIS seller's products only
      const allProductsRefunded = settlement.products.every(
        (p) => p.refundStatus === "refunded",
      );
      const anyProductsRefunded = settlement.products.some(
        (p) => p.refundStatus === "refunded",
      );

      // Set refundStatus based on this seller's completion
      settlement.refundStatus = allProductsRefunded
        ? "full"
        : anyProductsRefunded
          ? "partial"
          : "none";

      // Update settlement status when all seller products are refunded
      if (allProductsRefunded) {
        settlement.status = "refunded";
      }

      await settlement.save();

      console.log(
        `✅ SellerSettlement updated for seller ${productSellerId}: refundStatus="${settlement.refundStatus}", status="${settlement.status}", allProductsRefunded=${allProductsRefunded}, totalProducts=${settlement.products.length}`,
      );
    }

    // 5. Update purchase timeline
    purchase.orderTimeline.push({
      event: isFullProductRefund
        ? "Product Refund Approved"
        : "Partial Product Refund Approved",
      timestamp: new Date(),
      location: "Admin/Seller",
      notes: `Reason: ${reason || "Manual Refund"}, Product: ${String(product.product)}, Amount: $${productRefundAmount.toFixed(2)}`,
    });

    // 6. Update overall purchase payment status based on all settlements
    await updatePurchasePaymentStatus(purchase._id);

    await purchase.save();

    return res.status(200).json({
      success: true,
      message: `${isFullProductRefund ? "Full" : "Partial"} refund for product processed successfully`,
      refund: {
        id: refund.id,
        amount: productRefundAmount,
        productId: String(product.product),
        sellerId: productSellerId,
        platformFeeRefunded: platformFeeRefund,
        status: refund.status,
      },
      order: purchase,
    });
  }
  // 8. Handle full order refund (legacy behavior - all products, all sellers)
  // Check if already fully refunded
  if (purchase.paymentStatus === "refunded") {
    return next(new AppError("Order already refunded", 400));
  }

  const refundAmount = amount || purchase.totalAmount;
  const isPartial = amount && amount < purchase.totalAmount;

  // Get platform fee information
  const platformFeeAmount = purchase.platformFeeAmount || 0;

  // Calculate platform fee refund
  let platformFeeRefund = 0;
  if (platformFeeAmount > 0) {
    if (isPartial) {
      const refundPercentage = refundAmount / purchase.totalAmount;
      platformFeeRefund = platformFeeAmount * refundPercentage;
      platformFeeRefund = Math.round(platformFeeRefund * 100) / 100;
    } else {
      platformFeeRefund = platformFeeAmount;
    }
  }

  // Create refund in Stripe
  const refundConfig = {
    payment_intent: purchase.paymentIntentId,
    amount: Math.round(refundAmount * 100),
    reason: "requested_by_customer",
    metadata: {
      orderId: purchase.orderId,
      refundType: isPartial ? "partial" : "full",
      platformFeeRefunded: platformFeeRefund.toString(),
    },
  };

  const refund = await stripe.refunds.create(refundConfig);

  // Update all settlements (NOT purchase products)
  const settlements = await SellerSettlement.find({ purchaseId: purchase._id });
  for (const settlement of settlements) {
    const sellerProportion = settlement.totalOrderAmount / purchase.totalAmount;
    const sellerRefundAmount = refundAmount * sellerProportion;

    for (const product of settlement.products) {
      product.refundStatus = "refunded";
      product.refundAmount =
        sellerRefundAmount *
        ((product.price * product.quantity) / settlement.totalOrderAmount);
      product.refundedAt = new Date();
    }

    settlement.refundDeductions =
      (settlement.refundDeductions || 0) + sellerRefundAmount;
    const commissionDeduction =
      settlement.commissionAmount *
      (sellerRefundAmount / settlement.totalOrderAmount);
    settlement.commissionAmount -= commissionDeduction;
    settlement.refundStatus = "full";
    settlement.status = "refunded";

    await settlement.save();
  }

  // Update Purchase Record
  purchase.paymentStatus = isPartial ? "partially_refunded" : "refunded";
  purchase.refundedAt = new Date();
  purchase.platformFeeRefunded =
    (purchase.platformFeeRefunded || 0) + platformFeeRefund;

  purchase.orderTimeline.push({
    event: isPartial ? "Partial Refund Approved" : "Full Refund Approved",
    timestamp: new Date(),
    location: "Admin/Seller",
    notes: `Reason: ${reason || "Manual Refund"}, Amount: $${refundAmount.toFixed(2)}`,
  });

  await purchase.save();

  res.status(200).json({
    success: true,
    message: `${isPartial ? "Partial" : "Full"} refund processed successfully`,
    refund: {
      id: refund.id,
      amount: refundAmount,
      platformFeeRefunded: platformFeeRefund,
      status: refund.status,
    },
  });
});

// 🔹 Get Dispute Details
export const getDisputeDetails = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;

  const purchase = await Purchase.findOne({ orderId })
    .populate("buyer", "name email")
    .populate("products.product", "name price");

  if (!purchase) {
    return next(new AppError("Order not found", 404));
  }

  if (!purchase.disputeId) {
    return next(new AppError("No dispute found for this order", 404));
  }

  // Fetch latest dispute info from Stripe
  const dispute = await stripe.disputes.retrieve(purchase.disputeId);

  res.status(200).json({
    success: true,
    dispute: {
      id: dispute.id,
      amount: dispute.amount / 100,
      status: dispute.status,
      reason: dispute.reason,
      created: new Date(dispute.created * 1000),
      evidence_due_by: dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000)
        : null,
    },
    order: {
      orderId: purchase.orderId,
      totalAmount: purchase.totalAmount,
      disputeStatus: purchase.disputeStatus,
      timeline: purchase.orderTimeline,
    },
  });
});

// 🔹 Submit Evidence for Dispute
export const submitDisputeEvidence = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const {
    customerName,
    shippingTrackingNumber,
    customerEmailAddress,
    evidence,
  } = req.body;

  const purchase = await Purchase.findOne({ orderId });

  if (!purchase || !purchase.disputeId) {
    return next(new AppError("Dispute not found", 404));
  }

  // Submit evidence to Stripe
  const dispute = await stripe.disputes.update(purchase.disputeId, {
    evidence: {
      customer_name: customerName || purchase.shippingAddress?.name,
      shipping_tracking_number:
        shippingTrackingNumber || purchase.trackingNumber,
      customer_email_address: customerEmailAddress,
      ...evidence,
    },
  });

  // Update purchase timeline
  purchase.orderTimeline.push({
    event: "Dispute Evidence Submitted",
    timestamp: new Date(),
    location: "Seller",
    notes: "Evidence submitted to Stripe",
  });

  await purchase.save();

  res.status(200).json({
    success: true,
    message: "Evidence submitted successfully",
    dispute: {
      id: dispute.id,
      status: dispute.status,
    },
  });
});

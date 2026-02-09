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

// ✅ Create PaymentIntent
export const createPaymentIntent = catchAsync(async (req, res, next) => {
  const { products, shippingAddress, promoCode, skipWebhook } = req.body;

  if (!products || products.length === 0)
    return next(new AppError("No products provided", 400));
  if (!req.user || !req.user.id)
    return next(new AppError("User not authenticated", 401));

  let sellerId = null;
  const productDetailsArr = [];

  // 💡 Step 1: fetch products & calculate basePrice (product-level discount)
  for (const item of products) {
    const product = await Product.findById(item.product);
    if (!product) return next(new AppError("Product not found", 404));

    if (!sellerId) sellerId = product.createdBy;

    let basePrice = Number(product.price);
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

    productDetailsArr.push({
      product,
      basePrice,
      quantity: item.quantity,
    });
  }

  // 💡 Step 2: Calculate subtotal
  const subtotal = productDetailsArr.reduce(
    (sum, p) => sum + p.basePrice * p.quantity,
    0,
  );

  const seller = await User.findById(sellerId);
  if (!seller) return next(new AppError("Seller not found", 404));

  // 💡 Step 3: Shipping
  let shippingCost = seller.sellerProfile.shippingCharges || 0;
  if (
    seller.sellerProfile.freeShippingThreshold &&
    subtotal >= seller.sellerProfile.freeShippingThreshold
  )
    shippingCost = 0;

  // 💡 Step 4: Promo code discount (using new PromoCode model)
  let promoDiscount = 0;
  let promoCodeId = null;

  if (promoCode) {
    try {
      // Find promo code in the new PromoCode collection
      const matchedPromo = await PromoCode.findOne({
        code: promoCode,
        sellerId: sellerId,
        isActive: true,
      });

      if (matchedPromo) {
        const now = new Date();

        // Check expiration
        const notExpired =
          !matchedPromo.expiresAt || new Date(matchedPromo.expiresAt) >= now;

        // Check minimum order amount
        const meetsMinAmount = subtotal >= (matchedPromo.minOrderAmount || 0);

        // Check total usage limit
        const withinUsageLimit =
          !matchedPromo.usageLimit ||
          matchedPromo.usedCount < matchedPromo.usageLimit;

        // Check per-user limit (if user is authenticated)
        let withinUserLimit = true;
        if (req.user && req.user.id) {
          const userUsageCount = await CustomerPromoCodeUse.countDocuments({
            user_id: req.user.id,
            promoCodeId: matchedPromo._id,
          });
          withinUserLimit = userUsageCount < (matchedPromo.perUserLimit || 1);
        }

        if (
          notExpired &&
          meetsMinAmount &&
          withinUsageLimit &&
          withinUserLimit
        ) {
          // Calculate discount
          promoDiscount =
            matchedPromo.type === "fixed"
              ? matchedPromo.discount
              : (subtotal * matchedPromo.discount) / 100;

          promoCodeId = matchedPromo._id;

          console.log(
            `✅ Valid promo code applied: ${promoCode}, Discount: $${promoDiscount.toFixed(2)}`,
          );
        } else {
          console.log(`⚠️ Promo code validation failed:`);
          console.log(`   - Expired: ${!notExpired}`);
          console.log(`   - Min amount met: ${meetsMinAmount}`);
          console.log(`   - Within usage limit: ${withinUsageLimit}`);
          console.log(`   - Within user limit: ${withinUserLimit}`);
        }
      } else {
        console.log(`⚠️ Promo code not found or inactive: ${promoCode}`);
      }
    } catch (error) {
      console.error("❌ Error validating promo code:", error);
      // Continue without promo code if validation fails
    }
  }

  // 💡 Step 5: Limited Time Offer (admin)
  const activeTax = await TaxConfig.findOne({ active: true });
  let adminDiscount = 0;
  if (activeTax && activeTax.limitedTimeOffer?.active) {
    const offer = activeTax.limitedTimeOffer;
    const now = new Date();
    const offerValid = !offer.expiresAt || new Date(offer.expiresAt) >= now;
    if (offerValid && subtotal >= offer.minSpend) {
      adminDiscount = (subtotal * offer.discountPercent) / 100;
    }
  }

  const totalDiscount = promoDiscount + adminDiscount;

  // 💡 Step 6: Proportional discount per product + rounding
  const totalBasePrice = productDetailsArr.reduce(
    (sum, p) => sum + p.basePrice * p.quantity,
    0,
  );

  productDetailsArr.forEach((p) => {
    const proportion = (p.basePrice * p.quantity) / totalBasePrice;
    const discountShare = totalDiscount * proportion;
    const finalUnitPrice = p.basePrice - discountShare / p.quantity;
    p.finalPricePerUnit = Math.round(finalUnitPrice * 100) / 100; // 2 decimals
  });

  // 💡 Step 7: Recalculate total after discounts
  const totalAfterDiscount = productDetailsArr.reduce(
    (sum, p) => sum + p.finalPricePerUnit * p.quantity,
    0,
  );

  // 💡 Step 8: Tax calculation
  let taxAmount = 0;
  if (activeTax)
    taxAmount = (totalAfterDiscount + shippingCost) * (activeTax.rate / 100);
  taxAmount = Math.round(taxAmount * 100) / 100;

  // 💡 Step 9: Total amount
  const totalAmount =
    Math.round((totalAfterDiscount + shippingCost + taxAmount) * 100) / 100;

  // ✅ Step 10: Check if seller has connected Stripe account
  const hasStripeConnect =
    seller.sellerProfile?.stripeAccountId &&
    seller.sellerProfile?.stripeAccountStatus === "active";

  // ✅ Step 10.5: Fetch and calculate platform fee
  const platformFeeConfig = await PlatformFee.findOne();
  let platformFeeAmount = 0;

  if (platformFeeConfig && hasStripeConnect) {
    if (platformFeeConfig.type === "fixed") {
      platformFeeAmount = platformFeeConfig.fee;
    } else if (platformFeeConfig.type === "percentage") {
      // Calculate percentage of total amount
      platformFeeAmount = (totalAmount * platformFeeConfig.fee) / 100;
    }
    // Round to 2 decimals
    platformFeeAmount = Math.round(platformFeeAmount * 100) / 100;

    console.log(
      `💰 Platform fee calculated: $${platformFeeAmount.toFixed(2)} (${platformFeeConfig.type})`,
    );
  }

  // ✅ Step 11: Create Stripe PaymentIntent
  const paymentIntentConfig = {
    amount: Math.round(totalAmount * 100),
    currency: "usd",
    metadata: {
      buyer: req.user.id,
      sellerId: sellerId,
      products: JSON.stringify(
        productDetailsArr.map((p) => ({
          product: p.product._id,
          quantity: p.quantity,
          price: p.finalPricePerUnit, // ✅ per-unit paid price
        })),
      ),
      shippingAddress: JSON.stringify(shippingAddress),
      promoDiscount: promoDiscount.toString(),
      adminDiscount: adminDiscount.toString(),
      taxAmount: taxAmount.toString(),
      shippingCost: shippingCost.toString(),
      platformFeeAmount: platformFeeAmount.toString(), // ✅ Store for refund/chargeback handling
      platformFeeType: platformFeeConfig?.type || "none", // ✅ Store fee type
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

  const paymentIntent = await stripe.paymentIntents.create(paymentIntentConfig);

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
      platformFee: Math.round(platformFeeAmount * 100) / 100, // ✅ Include platform fee
      totalAmount: Math.round(totalAmount * 100) / 100,
      sellerReceives: Math.round((totalAmount - platformFeeAmount) * 100) / 100, // ✅ What seller gets
    },
  });
});

// ✅ Webhook + retry logic + atomic stock update
export const webhookPayment = async (req, res, next) => {
  // 🔹 Skip webhook in development mode (local testing)
  if (process.env.NODE_ENV === "development") {
    console.log("⚠️ Webhook skipped in development mode");
    return res.status(200).json({
      received: true,
      message: "Webhook skipped in development mode",
    });
  }

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

      // ✅ Create SellerSettlement record
      const commissionAmount = totalAmount - platformFeeAmount;
      const scheduledSettlementDate = calculateSettlementDate(new Date());

      // Get seller from first product
      const sellerId = purchaseProducts[0]?.seller;

      if (sellerId) {
        await SellerSettlement.create({
          sellerId,
          purchaseId: purchase._id,
          totalOrderAmount: totalAmount,
          commissionAmount: commissionAmount,
          platformFee: platformFeeAmount,
          status: "pending",
          scheduledSettlementDate,
        });
        console.log(
          `✅ SellerSettlement created for seller ${sellerId}, scheduled for ${scheduledSettlementDate}`,
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
  const { products, shippingAddress, promoCode, shippingMethod } = req.body;

  if (!products || products.length === 0)
    return next(new AppError("No products provided", 400));
  if (!req.user || !req.user.id)
    return next(new AppError("User not authenticated", 401));

  console.log(`\n========== RECEIVED CHECKOUT REQUEST ==========`);
  console.log(`Products count: ${products.length}`);
  console.log(`Shipping method: ${shippingMethod}`);
  products.forEach((p, i) => {
    console.log(
      `Product ${i + 1}: ID=${p.product}, Qty=${p.quantity}, Price=${p.price !== undefined ? "$" + p.price : "NOT PROVIDED"}`,
    );
  });
  console.log(`=============================================\n`);

  let sellerId = null;
  const lineItems = [];

  // Initialize promo code variables
  let promoDiscount = 0;
  let promoCodeId = null;

  // 💡 Step 1: Fetch products & collect for later processing
  const productDataList = [];
  for (const item of products) {
    const product = await Product.findById(item.product);
    if (!product) return next(new AppError("Product not found", 404));

    if (!sellerId) sellerId = product.createdBy;

    // ALWAYS use price from request (from cart) - this ensures frontend and backend match
    let basePrice = item.price ? Number(item.price) : Number(product.price);

    // If price from cart is provided, use it directly (cart already has correct discounted price)
    if (item.price) {
      basePrice = Number(item.price);
      console.log(
        `Using price from cart for product ${product._id}: $${basePrice} (DB price: $${product.price})`,
      );
    } else {
      // Fallback: calculate from product if price not provided
      console.log(
        `Price not provided from cart for product ${product._id}, using DB price: $${product.price}`,
      );
      basePrice = Number(product.price);

      // Apply discount if needed
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
    }

    // Ensure price is valid
    if (!basePrice || basePrice <= 0) {
      console.warn(
        `Invalid price for product ${product._id}, using DB price as fallback`,
      );
      basePrice = Number(product.price) || 0;
    }

    productDataList.push({
      product,
      basePrice,
      quantity: item.quantity,
      originalItem: item,
    });
  }

  // Calculate subtotal for promo code validation
  const productsSubtotal = productDataList.reduce(
    (sum, pData) => sum + pData.basePrice * pData.quantity,
    0,
  );

  const seller = await User.findById(sellerId);
  if (!seller) return next(new AppError("Seller not found", 404));

  // 💡 Promo code validation (using new PromoCode model) - added after sellerId and subtotal are established
  // Variables promoDiscount and promoCodeId already declared earlier in function

  if (promoCode && sellerId) {
    // Only validate if we have a seller
    try {
      // Find promo code in the new PromoCode collection
      const matchedPromo = await PromoCode.findOne({
        code: promoCode,
        sellerId: sellerId, // Match promo code to seller
        isActive: true,
      });

      if (matchedPromo) {
        const now = new Date();

        // Check expiration
        const notExpired =
          !matchedPromo.expiresAt || new Date(matchedPromo.expiresAt) >= now;

        // Check total usage limit
        const withinUsageLimit =
          !matchedPromo.usageLimit ||
          matchedPromo.usedCount < matchedPromo.usageLimit;

        // Check per-user limit (if user is authenticated)
        let withinUserLimit = true;
        if (req.user && req.user.id) {
          const userUsageCount = await CustomerPromoCodeUse.countDocuments({
            user_id: req.user.id,
            promoCodeId: matchedPromo._id,
          });
          withinUserLimit = userUsageCount < (matchedPromo.perUserLimit || 1);
        }

        // Check minimum order amount
        const meetsMinAmount =
          productsSubtotal >= (matchedPromo.minOrderAmount || 0);

        if (
          notExpired &&
          withinUsageLimit &&
          withinUserLimit &&
          meetsMinAmount
        ) {
          // Calculate the actual discount based on subtotal
          promoDiscount =
            matchedPromo.type === "fixed"
              ? matchedPromo.discount
              : (productsSubtotal * matchedPromo.discount) / 100;

          promoCodeId = matchedPromo._id;
          console.log(
            `✅ Valid promo code applied: ${promoCode}, Discount: $${promoDiscount.toFixed(2)}`,
          );
        } else {
          console.log(`⚠️ Promo code validation failed:`);
          console.log(`   - Expired: ${!notExpired}`);
          console.log(`   - Within usage limit: ${withinUsageLimit}`);
          console.log(`   - Within user limit: ${withinUserLimit}`);
          console.log(`   - Meets minimum amount: ${meetsMinAmount}`);
          if (!meetsMinAmount) {
            console.log(
              `   - Subtotal: $${productsSubtotal}, Min required: $${matchedPromo.minOrderAmount || 0}`,
            );
          }
        }
      } else {
        console.log(
          `⚠️ Promo code not found or inactive for seller: ${promoCode}`,
        );
      }
    } catch (error) {
      console.error("❌ Error validating promo code:", error);
      // Continue without promo code if validation fails
    }
  }

  // 💡 Step 2: Apply proportional discount to each product and build line items
  const totalBasePrice = productDataList.reduce(
    (sum, pData) => sum + pData.basePrice * pData.quantity,
    0,
  );

  // Apply proportional discount to each product and build line items
  for (const pData of productDataList) {
    const { product, basePrice, quantity, originalItem } = pData;

    // Calculate proportional discount for this product
    let finalUnitPrice = basePrice;
    if (promoDiscount > 0 && totalBasePrice > 0) {
      const proportion = (basePrice * quantity) / totalBasePrice;
      const discountShare = promoDiscount * proportion;
      finalUnitPrice = basePrice - discountShare / quantity;
      finalUnitPrice = Math.max(0, Math.round(finalUnitPrice * 100) / 100); // 2 decimals, ensure non-negative
    }

    // Ensure product name is not empty (Stripe requirement)
    const productName =
      product.name && typeof product.name === "string" && product.name.trim()
        ? product.name.trim()
        : `Product ${String(product._id)}`;

    // Ensure description is valid (max 500 chars for Stripe)
    let productDescription = "";
    if (product.description && typeof product.description === "string") {
      productDescription = product.description.trim().substring(0, 500);
    }

    // Validate product name length (Stripe requires 1-500 chars)
    if (productName.length < 1 || productName.length > 500) {
      console.error(
        `Invalid product name length for product ${product._id}: ${productName.length}`,
      );
      return next(
        new AppError(
          `Product name validation failed for product ${product._id}`,
          400,
        ),
      );
    }

    console.log(
      `Adding product to line items: ${productName}, Original Price: ${basePrice}, Final Price: ${finalUnitPrice}, Qty: ${quantity}`,
    );

    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: productName,
          description: productDescription,
          images:
            product.productImages &&
            Array.isArray(product.productImages) &&
            product.productImages.length > 0
              ? [String(product.productImages[0])]
              : [],
        },
        unit_amount: Math.round(finalUnitPrice * 100), // Convert to cents with discount applied
      },
      quantity: quantity,
    });
  }

  // Recalculate subtotal with discounts applied to line items
  const productsSubtotalWithDiscount =
    lineItems.reduce(
      (sum, item) => sum + item.price_data.unit_amount * item.quantity,
      0,
    ) / 100;

  // 💡 Step 3: Shipping cost based on method (must match frontend calculation)
  let shippingCost = 0;
  if (shippingMethod === "express") {
    shippingCost = 12.99;
  } else if (shippingMethod === "overnight") {
    shippingCost = 24.99;
  } else {
    // Standard shipping - match frontend logic: free if subtotal > 50, else 5.99
    if (productsSubtotalWithDiscount > 50) {
      shippingCost = 0;
    } else {
      // Check seller's free shipping threshold first, then fallback to 5.99
      if (
        seller.sellerProfile.freeShippingThreshold &&
        productsSubtotalWithDiscount >=
          seller.sellerProfile.freeShippingThreshold
      ) {
        shippingCost = 0;
      } else {
        shippingCost = seller.sellerProfile.shippingCharges || 5.99;
      }
    }
  }

  console.log(
    `Shipping calculation: Method=${shippingMethod}, Subtotal=$${productsSubtotalWithDiscount.toFixed(2)}, Shipping=$${shippingCost.toFixed(2)}`,
  );

  // Add shipping as line item if > 0
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

  // 💡 Step 4: Calculate tax
  const taxConfig = await TaxConfig.findOne({ isActive: true });
  let taxAmount = 0;
  let taxRate = 0.08;

  if (taxConfig && taxConfig.rate) {
    taxRate = taxConfig.rate / 100;
  }

  const taxableAmount = productsSubtotalWithDiscount;
  taxAmount = taxableAmount * taxRate;
  taxAmount = Math.round(taxAmount * 100) / 100;

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

  // Calculate final total
  const totalAfterDiscount = productsSubtotalWithDiscount;
  const finalTotal = totalAfterDiscount + shippingCost + taxAmount;

  // ✅ Step 4.5: Calculate Platform Fee
  const hasStripeConnect =
    seller.sellerProfile?.stripeAccountId &&
    seller.sellerProfile?.stripeAccountStatus === "active";

  let platformFeeAmount = 0;
  const platformFeeConfig = await PlatformFee.findOne();
  console.log("Platform fee 0==>");

  // if (platformFeeConfig && hasStripeConnect) {
  console.log("Platform fee 1==>");

  if (platformFeeConfig.type === "fixed") {
    console.log("Platform fee 2==>");

    platformFeeAmount = platformFeeConfig.fee;
  } else if (platformFeeConfig.type === "percentage") {
    platformFeeAmount = (finalTotal * platformFeeConfig.fee) / 100;
  }
  platformFeeAmount = Math.round(platformFeeAmount * 100) / 100;
  console.log("Platform fee 3==>", platformFeeAmount);

  console.log(
    `💰 Platform fee calculated: $${platformFeeAmount.toFixed(2)} (${platformFeeConfig.type})`,
  );
  // } else {
  //   console.log(
  //     `💰 No platform fee (Stripe Connect not enabled for seller or no fee config)`,
  //   );
  // }

  console.log(`\n========== CHECKOUT SESSION CALCULATION ==========`);
  console.log(`Products Subtotal: $${productsSubtotalWithDiscount.toFixed(2)}`);
  if (promoDiscount > 0) {
    console.log(`Promo Discount: -$${promoDiscount.toFixed(2)}`);
  }
  console.log(`Shipping (${shippingMethod}): $${shippingCost.toFixed(2)}`);
  console.log(
    `Tax (${(taxRate * 100).toFixed(2)}% on discounted total): $${taxAmount.toFixed(2)}`,
  );
  console.log(`Platform Fee: $${platformFeeAmount.toFixed(2)}`); // ✅ Log platform fee
  console.log(`TOTAL: $${finalTotal.toFixed(2)}`);
  console.log(
    `Seller Receives: $${(finalTotal - platformFeeAmount).toFixed(2)}`,
  ); // ✅ Log seller amount
  console.log(`================================================`);

  // 💡 Step 5: Create metadata for order creation
  const productsWithPrices = [];
  for (const item of products) {
    const product = await Product.findById(item.product);
    if (!product) continue;

    let itemPrice = item.price ? Number(item.price) : Number(product.price);

    if (
      !item.price &&
      product.discount &&
      (!product.discountExpires ||
        new Date(product.discountExpires) >= new Date())
    ) {
      if (product.discountType === "fixed") itemPrice -= product.discount;
      else if (product.discountType === "percentage")
        itemPrice -= (itemPrice * product.discount) / 100;
      if (itemPrice < 0) itemPrice = 0;
    }

    if (!itemPrice || itemPrice <= 0) {
      itemPrice = Number(product.price) || 0;
    }

    productsWithPrices.push({
      product: String(item.product),
      quantity: Number(item.quantity),
      price: Number(itemPrice),
    });
  }

  console.log(
    "📦 Metadata products:",
    JSON.stringify(productsWithPrices, null, 2),
  );

  const userId = String(req.user._id || req.user.id);

  const metadata = {
    buyer: userId,
    products: JSON.stringify(productsWithPrices),
    shippingAddress: JSON.stringify(shippingAddress),
    shippingMethod: shippingMethod || "standard",
    shippingCost: shippingCost.toString(),
    taxAmount: taxAmount.toString(),
    platformFeeAmount: platformFeeAmount.toString(), // ✅ Add platform fee to metadata
    platformFeeType: platformFeeConfig?.type || "none", // ✅ Store fee type
    promoCodeId: promoCodeId || null,
  };

  console.log("📦 Metadata buyer ID:", userId);
  console.log("💰 Metadata platform fee:", platformFeeAmount); // ✅ Log

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
      productsSubtotal: productsSubtotal,
      shippingCost: shippingCost,
      taxAmount: taxAmount,
      platformFee: platformFeeAmount, // ✅ Include platform fee in response
      total: finalTotal,
      sellerReceives: finalTotal - platformFeeAmount, // ✅ What seller receives
    },
  });
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

  // Check if order already exists (try multiple buyer ID formats)
  const existingOrder = await Purchase.findOne({
    checkoutSessionId: sessionId,
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
    const pointsEarned = Math.floor(totalAmount / 10);
    if (pointsEarned > 0) {
      await LoyaltyPoint.create({
        user: finalBuyerString,
        points: pointsEarned,
        type: "earn",
        reason: "purchase",
        referenceId: orderId,
      });
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
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const metadata = paymentIntent.metadata || {};
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

      // ✅ Create SellerSettlement record
      const platformFeeAmount = Number(metadata.platformFeeAmount) || 0;
      const commissionAmount = totalAmount - platformFeeAmount;
      const scheduledSettlementDate = calculateSettlementDate(new Date());

      // Get seller from first product (assuming single seller per order as per existing logic)
      const sellerId = purchaseProducts[0]?.seller;

      if (sellerId) {
        await SellerSettlement.create(
          [
            {
              sellerId,
              purchaseId: purchase[0]._id,
              totalOrderAmount: totalAmount,
              commissionAmount: commissionAmount,
              platformFee: platformFeeAmount,
              status: "pending",
              scheduledSettlementDate,
            },
          ],
          { session },
        );
        console.log(
          `✅ SellerSettlement created for seller ${sellerId}, scheduled for ${scheduledSettlementDate}`,
        );
      }

      // ✅ Add Loyalty Points AFTER purchase creation
      // Example: 1 point per $1 spent (customize as needed)
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
    // When refunding with Stripe Connect, the application fee is automatically handled
    // But we need to track it for our records
    let platformFeeRefunded = 0;
    if (hasPlatformFee) {
      if (isFullRefund) {
        // Full refund = full platform fee reversal
        platformFeeRefunded = platformFeeAmount;
      } else {
        // Partial refund = proportional platform fee reversal
        const refundPercentage = refundAmount / purchase.totalAmount;
        platformFeeRefunded = platformFeeAmount * refundPercentage;
        platformFeeRefunded = Math.round(platformFeeRefunded * 100) / 100;
      }
    }

    // Update purchase status
    purchase.paymentStatus = isFullRefund ? "refunded" : "partially_refunded";
    purchase.refundAmount = refundAmount;
    purchase.refundedAt = new Date();
    purchase.platformFeeRefunded = platformFeeRefunded; // ✅ Track platform fee refund

    // Add refund timeline event
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

        // Update product timeline
        item.timeline.push({
          event: "Stock Restored (Refund)",
          timestamp: new Date(),
          location: "System",
        });
      }

      purchase.status = "refunded";
    }

    await purchase.save();

    // ✅ Update SellerSettlement for refunds
    const settlement = await SellerSettlement.findOne({
      purchaseId: purchase._id,
    });
    if (settlement && settlement.status === "pending") {
      // Calculate how much to deduct from seller's commission
      const refundPercentage = refundAmount / purchase.totalAmount;
      const commissionDeduction =
        settlement.commissionAmount * refundPercentage;

      settlement.commissionAmount -= commissionDeduction;
      settlement.refundDeductions += refundAmount;

      if (isFullRefund) {
        settlement.status = "refunded";
      }

      await settlement.save();
      console.log(
        `✅ SellerSettlement updated for refund: Deducted $${commissionDeduction.toFixed(2)} from commission`,
      );
    }

    console.log(
      `✅ ${isFullRefund ? "Full" : "Partial"} refund processed for order:`,
      purchase.orderId,
    );
    if (hasPlatformFee) {
      console.log(
        `   Platform fee reversed: $${platformFeeRefunded.toFixed(2)}`,
      );
    }

    // TODO: Send email notification to buyer about refund
    // await sendRefundEmail(purchase);
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

    // ✅ Update SellerSettlement for settlement/chargeback
    const settlement = await SellerSettlement.findOne({
      purchaseId: purchase._id,
    });
    if (settlement && settlement.status === "pending") {
      if (dispute.status === "lost") {
        // If dispute is lost, the entire commission is likely gone (or proportional)
        const lostAmount = dispute.amount / 100;
        const refundPercentage = Math.min(1, lostAmount / purchase.totalAmount);
        const commissionDeduction =
          settlement.commissionAmount * refundPercentage;

        settlement.commissionAmount -= commissionDeduction;
        settlement.refundDeductions += lostAmount;

        if (refundPercentage >= 1) {
          settlement.status = "refunded";
        }

        await settlement.save();
        console.log(
          `✅ SellerSettlement updated for lost dispute: Deducted $${commissionDeduction.toFixed(2)} from commission`,
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

// 🔹 Manual Refund Controller (for admin/seller initiated refunds)
export const createRefund = catchAsync(async (req, res, next) => {
  const { orderId, amount, reason } = req.body;

  // Find the purchase
  const purchase = await Purchase.findOne({ orderId });

  if (!purchase) {
    return next(new AppError("Order not found", 404));
  }

  if (!purchase.paymentIntentId) {
    return next(new AppError("No payment intent found for this order", 400));
  }

  // Check if already refunded
  if (purchase.paymentStatus === "refunded") {
    return next(new AppError("Order already refunded", 400));
  }

  // Calculate refund amount
  const refundAmount = amount || purchase.totalAmount;
  const isPartial = amount && amount < purchase.totalAmount;

  // ✅ Get platform fee information
  const platformFeeAmount = purchase.platformFeeAmount || 0;
  const hasPlatformFee = platformFeeAmount > 0;

  // ✅ Calculate platform fee refund
  let platformFeeRefund = 0;
  if (hasPlatformFee) {
    if (isPartial) {
      // Proportional platform fee reversal
      const refundPercentage = refundAmount / purchase.totalAmount;
      platformFeeRefund = platformFeeAmount * refundPercentage;
      platformFeeRefund = Math.round(platformFeeRefund * 100) / 100;
    } else {
      // Full platform fee reversal
      platformFeeRefund = platformFeeAmount;
    }
  }

  // ✅ Create refund in Stripe with fee reversal
  const refundConfig = {
    payment_intent: purchase.paymentIntentId,
    amount: Math.round(refundAmount * 100), // Convert to cents
    reason: reason || "requested_by_customer",
    metadata: {
      orderId: purchase.orderId,
      refundType: isPartial ? "partial" : "full",
      platformFeeRefunded: platformFeeRefund.toString(),
    },
  };

  // ✅ If there's a platform fee and this is a Stripe Connect payment, reverse it
  if (hasPlatformFee && platformFeeRefund > 0) {
    refundConfig.reverse_transfer = false; // Don't reverse transfer (seller keeps their portion)
    refundConfig.refund_application_fee = true; // But refund the platform fee
  }

  const refund = await stripe.refunds.create(refundConfig);

  // Update will be handled by webhook (charge.refunded event)
  // But we can update immediately here as well
  purchase.paymentStatus = isPartial ? "partially_refunded" : "refunded";
  purchase.refundAmount = refundAmount;
  purchase.refundedAt = new Date();
  purchase.platformFeeRefunded =
    (purchase.platformFeeRefunded || 0) + platformFeeRefund; // ✅ Track cumulative platform fee refund

  purchase.orderTimeline.push({
    event: isPartial ? "Partial Refund Initiated" : "Full Refund Initiated",
    timestamp: new Date(),
    location: "Admin/Seller",
    notes: `Reason: ${reason || "Customer request"}, Amount: $${refundAmount.toFixed(2)}${hasPlatformFee ? `, Platform fee reversed: $${platformFeeRefund.toFixed(2)}` : ""}`,
  });

  if (!isPartial) {
    purchase.status = "refunded";

    // Restore stock
    for (const item of purchase.products) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stockQuantity: item.quantity },
      });
    }
  }

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

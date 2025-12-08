import Stripe from "stripe";
import mongoose from "mongoose";
import crypto from "crypto";

import { Product } from "../../models/seller/product.js";
import { Purchase } from "../../models/customers/purchase.js";
import { User } from "../../models/users.js";
import { TaxConfig } from "../../models/super-admin/taxWithAdminDiscountConfig.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { LoyaltyPoint } from "./../../models/customers/loyaltyPoints.js";

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function generateUniqueOrderId() {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(3).toString("hex");
  return `ORD-${timestamp}-${randomBytes}`;
}

// ✅ Create PaymentIntent
export const createPaymentIntent = catchAsync(async (req, res, next) => {
  const { products, shippingAddress, promoCode } = req.body;

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
    0
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

  // 💡 Step 4: Promo code discount
  let promoDiscount = 0;
  if (promoCode) {
    const matchedPromo = seller.sellerProfile.promoCodes.find(
      (p) => p.code === promoCode
    );
    if (matchedPromo) {
      const now = new Date();
      const notExpired =
        !matchedPromo.expiresAt || new Date(matchedPromo.expiresAt) >= now;
      if (notExpired && subtotal >= (matchedPromo.minOrderAmount || 0)) {
        promoDiscount =
          matchedPromo.type === "fixed"
            ? matchedPromo.discount
            : (subtotal * matchedPromo.discount) / 100;
      }
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
    0
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
    0
  );

  // 💡 Step 8: Tax calculation
  let taxAmount = 0;
  if (activeTax)
    taxAmount = (totalAfterDiscount + shippingCost) * (activeTax.rate / 100);
  taxAmount = Math.round(taxAmount * 100) / 100;

  // 💡 Step 9: Total amount
  const totalAmount =
    Math.round((totalAfterDiscount + shippingCost + taxAmount) * 100) / 100;

  // ✅ Step 10: Create Stripe PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(totalAmount * 100),
    currency: "usd",
    metadata: {
      buyer: req.user.id,
      products: JSON.stringify(
        productDetailsArr.map((p) => ({
          product: p.product._id,
          quantity: p.quantity,
          price: p.finalPricePerUnit, // ✅ per-unit paid price
        }))
      ),
      shippingAddress: JSON.stringify(shippingAddress),
      promoDiscount,
      adminDiscount,
      taxAmount,
      shippingCost,
    },
  });

  res.status(200).json({
    status: "success",
    clientSecret: paymentIntent.client_secret,
    breakdown: {
      subtotal,
      promoDiscount,
      adminDiscount,
      shippingCost,
      taxAmount,
      totalAmount,
    },
  });
});

// ✅ Webhook + retry logic + atomic stock update
export const webhookPayment = async (req, res) => {
  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook verification failed:", err.message);
    return next(new AppError(`Webhook error: ${err.message}`, 400));
  }

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

  res.status(200).json({ received: true });
};

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
          { new: true, session }
        );

        if (!product)
          throw new Error(
            `Insufficient stock or write conflict for ${item.product}`
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
          seller: product.createdBy,
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

      // ✅ Create Purchase with overall orderTimeline
      await Purchase.create(
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
            orderTimeline: [
              {
                event: "Order Confirmed",
                timestamp: new Date(),
                location: "Seller",
              },
            ],
          },
        ],
        { session }
      );

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
          { session }
        );
      }

      await session.commitTransaction();
      session.endSession();
      success = true;
      console.log("✅ Purchase saved successfully & loyalty points added!");
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      attempt++;
      if (attempt >= 3) throw err;
      console.log(`⚠️ Transaction conflict, retrying... Attempt ${attempt}`);
    }
  }
};

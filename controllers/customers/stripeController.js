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

  // 🔹 Local Development: Skip webhook and directly create purchase
  const isDevelopment = process.env.NODE_ENV === "development";
  const shouldSkipWebhook = skipWebhook === true || isDevelopment;

  if (shouldSkipWebhook) {
    try {
      // Simulate successful payment for local development
      const mockPaymentIntent = {
        id: paymentIntent.id,
        amount: paymentIntent.amount,
        metadata: paymentIntent.metadata,
      };

      // Directly create purchase (skip webhook)
      await createPurchaseFromPaymentIntent(mockPaymentIntent);

      // Fetch the created purchase to get orderId
      const createdPurchase = await Purchase.findOne({
        paymentIntentId: paymentIntent.id,
      });

      return res.status(200).json({
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
        message: "Payment completed (webhook skipped for local development)",
        orderCreated: true,
        orderId: createdPurchase?.orderId || null,
        paymentIntentId: paymentIntent.id,
      });
    } catch (err) {
      console.error("⚠️ Failed to create purchase directly:", err);
      // Continue with normal flow even if direct creation fails
    }
  }

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
export const webhookPayment = async (req, res, next) => {
  // 🔹 Skip webhook in development mode (local testing)
  if (process.env.NODE_ENV === "development") {
    console.log("⚠️ Webhook skipped in development mode");
    return res.status(200).json({ 
      received: true, 
      message: "Webhook skipped in development mode" 
    });
  }

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

  // Handle Checkout Session completion
  if (event.type === "checkout.session.completed") {
    try {
      const session = event.data.object;
      
      // Retrieve the full session to get line items
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items'],
      });

      // Create purchase from checkout session
      const metadata = session.metadata || {};
      const buyer = metadata.buyer;
      const products = metadata.products ? JSON.parse(metadata.products) : [];
      const shippingAddress = metadata.shippingAddress
        ? JSON.parse(metadata.shippingAddress)
        : {};

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
        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stockQuantity: -item.quantity } }
        );

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
      console.log("📦 Webhook: Creating order with buyer:", buyerString, "Type:", typeof buyerString);
      
      await Purchase.create({
        orderId,
        buyer: buyerString, // Convert to string
        products: purchaseProducts,
        shippingAddress,
        totalAmount,
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

      // ✅ Clear cart after successful order
      try {
        const { Cart } = await import("../../models/customers/cart.js");
        await Cart.deleteMany({ user: buyer });
        console.log("✅ Cart cleared for user:", buyer);
      } catch (cartError) {
        console.error("⚠️ Failed to clear cart:", cartError);
        // Don't fail the order if cart clearing fails
      }

      console.log("✅ Purchase created from checkout session:", orderId);
    } catch (err) {
      console.error("⚠️ Failed to create purchase from checkout session:", err);
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
    console.log(`Product ${i + 1}: ID=${p.product}, Qty=${p.quantity}, Price=${p.price !== undefined ? '$' + p.price : 'NOT PROVIDED'}`);
  });
  console.log(`=============================================\n`);

  let sellerId = null;
  const lineItems = [];

  // 💡 Step 1: Fetch products & build line items
  for (const item of products) {
    const product = await Product.findById(item.product);
    if (!product) return next(new AppError("Product not found", 404));

    if (!sellerId) sellerId = product.createdBy;

    // ALWAYS use price from request (from cart) - this ensures frontend and backend match
    let basePrice = item.price ? Number(item.price) : Number(product.price);
    
    // If price from cart is provided, use it directly (cart already has correct discounted price)
    if (item.price) {
      basePrice = Number(item.price);
      console.log(`Using price from cart for product ${product._id}: $${basePrice} (DB price: $${product.price})`);
    } else {
      // Fallback: calculate from product if price not provided
      console.log(`Price not provided from cart for product ${product._id}, using DB price: $${product.price}`);
      basePrice = Number(product.price);
      
      // Apply discount if needed
      if (product.discount &&
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
      console.warn(`Invalid price for product ${product._id}, using DB price as fallback`);
      basePrice = Number(product.price) || 0;
    }

    // Ensure product name is not empty (Stripe requirement)
    const productName = (product.name && typeof product.name === 'string' && product.name.trim()) 
      ? product.name.trim() 
      : `Product ${String(product._id)}`;
    
    // Ensure description is valid (max 500 chars for Stripe)
    let productDescription = "";
    if (product.description && typeof product.description === 'string') {
      productDescription = product.description.trim().substring(0, 500);
    }

    // Validate product name length (Stripe requires 1-500 chars)
    if (productName.length < 1 || productName.length > 500) {
      console.error(`Invalid product name length for product ${product._id}: ${productName.length}`);
      return next(new AppError(`Product name validation failed for product ${product._id}`, 400));
    }

    console.log(`Adding product to line items: ${productName}, Price: ${basePrice}, Qty: ${item.quantity}`);

    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: productName,
          description: productDescription,
          images: product.productImages && Array.isArray(product.productImages) && product.productImages.length > 0 
            ? [String(product.productImages[0])] 
            : [],
        },
        unit_amount: Math.round(basePrice * 100), // Convert to cents
      },
      quantity: item.quantity,
    });
  }

  // 💡 Step 2: Calculate subtotal (products only, before shipping and tax)
  const productsSubtotal = lineItems.reduce(
    (sum, item) => sum + (item.price_data.unit_amount * item.quantity),
    0
  ) / 100;

  const seller = await User.findById(sellerId);
  if (!seller) return next(new AppError("Seller not found", 404));

  // 💡 Step 3: Shipping cost based on method (must match frontend calculation)
  let shippingCost = 0;
  if (shippingMethod === 'express') {
    shippingCost = 12.99;
  } else if (shippingMethod === 'overnight') {
    shippingCost = 24.99;
  } else {
    // Standard shipping - match frontend logic: free if subtotal > 50, else 5.99
    if (productsSubtotal > 50) {
      shippingCost = 0;
    } else {
      // Check seller's free shipping threshold first, then fallback to 5.99
      if (seller.sellerProfile.freeShippingThreshold && productsSubtotal >= seller.sellerProfile.freeShippingThreshold) {
        shippingCost = 0;
      } else {
        shippingCost = seller.sellerProfile.shippingCharges || 5.99;
      }
    }
  }
  
  console.log(`Shipping calculation: Method=${shippingMethod}, Subtotal=$${productsSubtotal.toFixed(2)}, Shipping=$${shippingCost.toFixed(2)}`);

  // Add shipping as line item if > 0
  if (shippingCost > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: `Shipping (${shippingMethod || 'standard'})`,
        },
        unit_amount: Math.round(shippingCost * 100),
      },
      quantity: 1,
    });
  }

  // 💡 Step 4: Calculate tax (on products subtotal only, before shipping)
  const taxConfig = await TaxConfig.findOne({ isActive: true });
  let taxAmount = 0;
  let taxRate = 0.08; // Default 8% if no tax config
  
  if (taxConfig && taxConfig.rate) {
    taxRate = taxConfig.rate / 100;
  }
  
  // Calculate tax on products subtotal only (not including shipping)
  taxAmount = productsSubtotal * taxRate;
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

  // Calculate final total for logging
  const finalTotal = productsSubtotal + shippingCost + taxAmount;
  console.log(`\n========== CHECKOUT SESSION CALCULATION ==========`);
  console.log(`Products Subtotal: $${productsSubtotal.toFixed(2)}`);
  console.log(`Shipping (${shippingMethod}): $${shippingCost.toFixed(2)}`);
  console.log(`Tax (${(taxRate * 100).toFixed(2)}% on products): $${taxAmount.toFixed(2)}`);
  console.log(`TOTAL: $${finalTotal.toFixed(2)}`);
  console.log(`================================================\n`);

  // 💡 Step 5: Create metadata for order creation
  // Build products with prices for metadata (use same prices as line items)
  const productsWithPrices = [];
  // We already calculated basePrice in the loop above, so we need to store it
  // Let's rebuild with the same logic
  for (const item of products) {
    const product = await Product.findById(item.product);
    if (!product) continue;
    
    // Use same price calculation as line items
    let itemPrice = item.price ? Number(item.price) : Number(product.price);
    
    // Apply discount if price not provided from cart
    if (!item.price && product.discount &&
      (!product.discountExpires || new Date(product.discountExpires) >= new Date())
    ) {
      if (product.discountType === "fixed") itemPrice -= product.discount;
      else if (product.discountType === "percentage")
        itemPrice -= (itemPrice * product.discount) / 100;
      if (itemPrice < 0) itemPrice = 0;
    }
    
    // Ensure price is valid
    if (!itemPrice || itemPrice <= 0) {
      itemPrice = Number(product.price) || 0;
    }
    
    productsWithPrices.push({
      product: String(item.product),
      quantity: Number(item.quantity),
      price: Number(itemPrice),
    });
  }
  
  console.log("📦 Metadata products:", JSON.stringify(productsWithPrices, null, 2));
  
  // Use consistent user ID format
  const userId = String(req.user._id || req.user.id);
  
  const metadata = {
    buyer: userId,
    products: JSON.stringify(productsWithPrices),
    shippingAddress: JSON.stringify(shippingAddress),
    shippingMethod: shippingMethod || 'standard',
    shippingCost: shippingCost.toString(),
    taxAmount: taxAmount.toString(),
  };
  
  console.log("📦 Metadata buyer ID:", userId);

  // 💡 Step 6: Validate line items before creating session
  if (lineItems.length === 0) {
    return next(new AppError("No valid line items to process", 400));
  }

  // Validate all line items have required fields
  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    if (!item.price_data?.product_data?.name || 
        typeof item.price_data.product_data.name !== 'string' ||
        item.price_data.product_data.name.trim().length === 0) {
      console.error(`Line item ${i} missing or invalid product name:`, item);
      return next(new AppError(`Line item ${i + 1} is missing product name`, 400));
    }
    if (!item.price_data?.unit_amount || item.price_data.unit_amount <= 0) {
      console.error(`Line item ${i} has invalid price:`, item);
      return next(new AppError(`Line item ${i + 1} has invalid price`, 400));
    }
  }

  console.log(`Creating Stripe Checkout Session with ${lineItems.length} line items`);

  // 💡 Step 7: Create Stripe Checkout Session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: lineItems,
    mode: "payment",
    success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/order-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/order-cancel`,
    customer_email: shippingAddress?.email || req.user.email,
    metadata: metadata,
    // Removed shipping_address_collection - shipping address is already collected before Stripe
  });

  res.status(200).json({
    status: "success",
    sessionId: session.id,
    url: session.url,
    breakdown: {
      productsSubtotal: productsSubtotal,
      shippingCost: shippingCost,
      taxAmount: taxAmount,
      total: finalTotal,
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
  const finalBuyerString = metadataBuyer ? String(metadataBuyer) : String(buyer);
  
  // Verify buyer matches (for security) - log warning but proceed
  const buyerStr = String(buyer);
  const metadataBuyerStr = String(metadataBuyer || '');
  if (metadataBuyer && buyerStr !== metadataBuyerStr && 
      req.user._id && String(req.user._id) !== metadataBuyerStr && 
      req.user.id && String(req.user.id) !== metadataBuyerStr) {
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
    if (orderBuyer === currentBuyer || orderBuyer === buyerStr || 
        orderBuyer === String(req.user._id) || orderBuyer === String(req.user.id) ||
        existingOrder.checkoutSessionId === sessionId) {
      console.log("✅ Order already exists for this session, returning it");
      
      // Populate and format the existing order
      const populatedExisting = await Purchase.findById(existingOrder._id)
        .populate({
          path: "products.product",
          select: "title slug _id name",
        })
        .lean();
      
      // Format order to match expected format
      const products = (populatedExisting?.products || existingOrder.products).map((p) => ({
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
    console.error("Failed to parse shipping address from metadata:", parseError);
    // Continue with empty address if parsing fails
  }

  console.log("📦 Creating order with products:", products.length);
  console.log("📦 Products data:", JSON.stringify(products, null, 2));

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
      if (product.discount &&
        (!product.discountExpires || new Date(product.discountExpires) >= new Date())
      ) {
        if (product.discountType === "fixed") itemPrice -= product.discount;
        else if (product.discountType === "percentage")
          itemPrice -= (itemPrice * product.discount) / 100;
        if (itemPrice < 0) itemPrice = 0;
      }
    }

    // Ensure seller ID is properly set
    const sellerId = product.createdBy || product.seller;
    console.log(`✅ Adding product: ${product.name || product.title}, Price: $${itemPrice}, Qty: ${item.quantity}`);
    console.log(`   Seller ID: ${sellerId} (Type: ${typeof sellerId})`);

    // Update stock
    await Product.findByIdAndUpdate(
      item.product,
      { $inc: { stockQuantity: -item.quantity } }
    );

    // Purchase model expects seller as String, so convert to String
    const finalSellerId = String(sellerId);
    console.log(`   Final Seller ID (String): ${finalSellerId} (Type: ${typeof finalSellerId})`);
    
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
    order = await Purchase.create({
      orderId,
      buyer: finalBuyerString, // Store as string (Purchase schema expects String)
      products: purchaseProducts,
      shippingAddress,
      totalAmount,
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
    console.log("✅ Order created successfully:", orderId, "Buyer (string):", finalBuyerString);
  } catch (createError) {
    console.error("❌ Failed to create order:", createError);
    console.error("❌ Error details:", JSON.stringify(createError, null, 2));
    return next(new AppError(`Failed to create order: ${createError.message}`, 500));
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
      ]
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
    const { Notification } = await import("../../models/common/notification.js");
    const { User } = await import("../../models/users.js");
    
    // Get unique seller IDs from purchaseProducts
    const uniqueSellerIds = [...new Set(purchaseProducts.map(p => p.seller))];
    
    // Create notification for each seller
    const notificationPromises = uniqueSellerIds.map(async (sellerId) => {
      try {
        const seller = await User.findById(sellerId);
        if (seller) {
          await Notification.create({
            user: String(sellerId),
            type: "order_placed",
            title: "New Order Received",
            message: `You have received a new order (${orderId}) with ${purchaseProducts.filter(p => p.seller === sellerId).length} product(s). Total: $${purchaseProducts.filter(p => p.seller === sellerId).reduce((sum, p) => sum + (p.price * p.quantity), 0).toFixed(2)}`,
            orderId: orderId,
            order: String(order._id),
            metadata: {
              totalAmount: purchaseProducts.filter(p => p.seller === sellerId).reduce((sum, p) => sum + (p.price * p.quantity), 0),
              productCount: purchaseProducts.filter(p => p.seller === sellerId).length,
            },
          });
        }
      } catch (notifError) {
        console.error(`⚠️ Failed to create notification for seller ${sellerId}:`, notifError);
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
  const formattedProducts = (populatedOrder?.products || order.products).map((p) => ({
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

  const totalItems = formattedProducts.reduce((sum, p) => sum + p.quantity, 0);

  const formattedOrder = {
    _id: order._id,
    orderId: order.orderId,
    trackingNumber: order.trackingNumber,
    totalItems,
    products: formattedProducts,
    totalAmount: order.totalAmount,
    paymentStatus: order.paymentStatus,
    status: order.status,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };

  console.log("✅ Order created and formatted:", formattedOrder.orderId);

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

      // ✅ Clear cart after successful order
      try {
        const { Cart } = await import("../../models/customers/cart.js");
        await Cart.deleteMany({ user: buyer }).session(session);
        console.log("✅ Cart cleared for user:", buyer);
      } catch (cartError) {
        console.error("⚠️ Failed to clear cart:", cartError);
        // Don't fail the order if cart clearing fails
      }

      await session.commitTransaction();
      session.endSession();
      success = true;
      console.log("✅ Purchase saved successfully & loyalty points added & cart cleared!");
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      attempt++;
      if (attempt >= 3) throw err;
      console.log(`⚠️ Transaction conflict, retrying... Attempt ${attempt}`);
    }
  }
};

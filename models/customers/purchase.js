import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const purchaseSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    orderId: {
      type: String,
      unique: true,
      required: true,
    },
    buyer: {
      type: String,
      ref: "User",
      required: true,
      index: true,
    },

    // ✅ Products with individual status and timeline
    products: [
      {
        product: { type: String, ref: "Product", required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        seller: { type: String, ref: "User", required: true },
        // Individual product status - seller can update independently
        status: {
          type: String,
          enum: [
            "new",
            "processing",
            "shipped",
            "in_transit",
            "delivered",
            "cancelled",
            "refunded",
            "return_requested",
            "return_approved",
            "return_rejected",
          ],
          default: "new",
        },
        timeline: [
          {
            event: { type: String, required: true }, // e.g., "Order Confirmed"
            timestamp: { type: Date, default: Date.now },
            location: String, // e.g., Farm, Hub, Distribution Center
          },
        ],
      },
    ],

    // ✅ Shipping info
    shippingAddress: {
      firstName: String,
      lastName: String,
      email: String,
      phone: String,
      address: String,
      apartment: String,
      city: String,
      state: String,
      zip: String,
      country: String,
      shippingMethod: String,
      shippingCost: Number,
      deliveryTime: String, // estimated delivery (ISO string or display text)
      deliveryDate: Date,
    },

    // ✅ Total amount & payment
    totalAmount: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: [
        "pending",
        "paid",
        "failed",
        "refunded",
        "partially_refunded",
        "disputed",
      ],
      default: "pending",
    },
    paymentIntentId: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },
    /** Set when known (e.g. from Stripe charge) — optional lookup for disputes/webhooks */
    chargeId: {
      type: String,
      index: true,
      sparse: true,
    },
    checkoutSessionId: {
      type: String,
      index: true,
      sparse: true,
    },
    paymentMethod: { type: String, default: "Credit Card" },

    // ✅ Order-level status (aggregated from line items; must include in_transit for seller updates)
    status: {
      type: String,
      enum: [
        "new",
        "processing",
        "shipped",
        "in_transit",
        "delivered",
        "cancelled",
        "refunded",
        "return_requested",
        "return_approved",
        "return_rejected",
      ],
      default: "new",
    },
    trackingNumber: {
      type: String,
      required: true,
      unique: true,
    },

    // ✅ Farm details per product
    farmDetails: [
      {
        seller: { type: String, ref: "User", required: true },
        farmName: String,
        distance: Number,
      },
    ],

    // ✅ Overall order timeline
    orderTimeline: [
      {
        event: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        location: String,
        notes: String,
        seller: { type: String, ref: "User" },
        product: { type: String, ref: "Product" },
        note: String, // legacy alias used in some controllers
      },
    ],
    refundAmount: {
      type: Number,
      default: 0,
    },
    refundReason: {
      type: String,
      default: null,
    },
    refundRequestedAt: {
      type: Date,
    },
    refundRejectReason: {
      type: String,
      default: null,
    },

    refundedAt: {
      type: Date,
    },

    disputeId: {
      type: String,
      default: null,
    },
    // Stripe sends many values (needs_response, under_review, won, lost, …) — keep as string
    disputeStatus: {
      type: String,
      default: "none",
    },
    disputeReason: {
      type: String,
    },
    disputeAmount: {
      type: Number,
      default: 0,
    },
    disputeCreatedAt: {
      type: Date,
    },
    disputeClosedAt: {
      type: Date,
    },

    platformFeeAmount: {
      type: Number,
      default: 0,
    },
    platformFeeRefunded: {
      type: Number,
      default: 0,
    },
    /** Cumulative charge.amount_refunded (USD) last applied in handleRefund — avoids double-applying webhooks */
    stripeRefundSyncedTotal: {
      type: Number,
      default: 0,
    },
    /** Stripe refund ids (re_…) recorded when handling refund.created — idempotent webhook retries */
    processedStripeRefundIds: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

export const Purchase = mongoose.model("Purchase", purchaseSchema);

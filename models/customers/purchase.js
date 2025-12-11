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

    // ✅ Products with individual timeline
    products: [
      {
        product: { type: String, ref: "Product", required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        seller: { type: String, ref: "User", required: true },
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
      deliveryTime: String, // estimated delivery
      deliveryDate: Date,
      // deliveryTime: {
      //   type: Date,
      //   default: () => {
      //     const now = new Date();
      //     now.setDate(now.getDate() + 2); // 2 দিন add
      //     return now;
      //   },
      // },
    },

    // ✅ Total amount & payment
    totalAmount: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    paymentIntentId: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },
    checkoutSessionId: {
      type: String,
      index: true,
      sparse: true,
    },
    paymentMethod: { type: String, default: "Credit Card" },

    // ✅ Order status & tracking
    status: {
      type: String,
      enum: [
        "new",
        "processing",
        "shipped",
        "in_transit",
        "delivered",
        "cancelled",
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

    // ✅ Overall order timeline (optional summary)
    orderTimeline: [
      {
        event: { type: String, required: true }, // e.g., "Order Confirmed"
        timestamp: { type: Date, default: Date.now },
        location: String,
      },
    ],
  },
  { timestamps: true }
);

export const Purchase = mongoose.model("Purchase", purchaseSchema);

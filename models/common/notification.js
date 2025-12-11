import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const notificationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    user: {
      type: String, // User ID (buyer or seller)
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "order_placed", // Seller gets when order is placed
        "order_status_updated", // Buyer gets when seller updates status
        "payment_received", // Seller gets when payment is received
        "order_delivered", // Buyer gets when order is delivered
        "order_cancelled", // Both get when order is cancelled
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    orderId: {
      type: String, // Order ID reference
      ref: "Purchase",
      required: false,
    },
    order: {
      type: String, // Purchase _id
      ref: "Purchase",
      required: false,
    },
    productId: {
      type: String, // Product ID (optional)
      required: false,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      required: false,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed, // Store additional data like status, amount, etc.
      required: false,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, createdAt: -1 });

export const Notification = mongoose.model("Notification", notificationSchema);


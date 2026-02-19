import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const sellerSettlementSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    sellerId: {
      type: String,
      ref: "User",
      required: true,
      index: true,
    },
    purchaseId: {
      type: String,
      ref: "Purchase",
      required: true,
      index: true,
    },
    // Products that belong to this seller in this order
    products: [
      {
        product: { type: String, ref: "Product" },
        quantity: { type: Number },
        price: { type: Number },
      },
    ],
    totalOrderAmount: {
      type: Number,
      required: true,
    },
    commissionAmount: {
      type: Number,
      required: true,
    },
    platformFee: {
      type: Number,
      required: true,
    },
    refundDeductions: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "settled", "cancelled", "refunded"],
      default: "pending",
      index: true,
    },
    scheduledSettlementDate: {
      type: Date,
      required: true,
      index: true,
    },
    actualSettlementDate: {
      type: Date,
    },
    stripeTransferId: {
      type: String,
    },
  },
  { timestamps: true },
);

export const SellerSettlement = mongoose.model(
  "SellerSettlement",
  sellerSettlementSchema,
);

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const promoCodeSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    code: { type: String, trim: true },
    discount: { type: Number, default: 0 },
    expiresAt: Date,
    minOrderAmount: { type: Number, default: 0 },
    type: {
      type: String,
      enum: ["fixed", "percentage"],
      required: true,
      default: "fixed",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sellerId: { type: String, ref: "User", required: true, index: true },
    usageLimit: {  // Maximum total uses
      type: Number,
      default: null,  // null = unlimited
    },
    perUserLimit: {  // Maximum uses per user
      type: Number,
      default: 1,  // Default: each user can use once
    },
    usedCount: {  // Total times used
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

// Add indexes for better performance
promoCodeSchema.index({ code: 1, sellerId: 1 }, { unique: true });
promoCodeSchema.index({ isActive: 1, expiresAt: 1 });
export const PromoCode = mongoose.model("PromoCode", promoCodeSchema);

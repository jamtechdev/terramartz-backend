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
  },
  { timestamps: true },
);
export const PromoCode = mongoose.model("PromoCode", promoCodeSchema);

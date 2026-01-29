import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const customerPromoCodeUseSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    user_id: {
      type: String,
      ref: "User",
      required: true,
      index: true,
    },
    promoCodeId: {
      type: String,
      ref: "PromoCode",
      required: true,
      index: true,
    },
    purchase_id: {
      type: String, // Purchase _id
      ref: "Purchase",
      required: false,
    },
  },
  { timestamps: true }
);

// Add compound index for faster queries
customerPromoCodeUseSchema.index({ user_id: 1, promoCodeId: 1 });

export const CustomerPromoCodeUse = mongoose.model("CustomerPromoCodeUse", customerPromoCodeUseSchema);
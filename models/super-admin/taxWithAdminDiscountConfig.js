import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const taxWithDiscountConfigSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    rate: { type: Number, required: true, default: 0.0 },
    active: { type: Boolean, default: true },

    // 🆕 Limited Time Offer
    limitedTimeOffer: {
      active: { type: Boolean, default: false },
      minSpend: { type: Number, default: 0 },
      discountPercent: { type: Number, default: 0 },
      // appliesTo: {
      //   type: String,
      //   enum: ["best_sellers"],
      //   default: "best_sellers",
      // },
      expiresAt: Date,
    },
  },
  { timestamps: true }
);

export const TaxConfig = mongoose.model(
  "TaxWithAdminDiscountConfig",
  taxWithDiscountConfigSchema
);

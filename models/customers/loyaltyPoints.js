import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const loyaltyPointSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    user: { type: String, ref: "User", required: true },
    points: { type: Number, required: true },
    type: { type: String, enum: ["earn", "redeem"], default: "earn" },
    reason: { type: String },
    referenceId: { type: String },
  },
  { timestamps: true }
);

export const LoyaltyPoint = mongoose.model("LoyaltyPoint", loyaltyPointSchema);

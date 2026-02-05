import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const platformFeeSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    fee: { type: Number, default: 0 },
    type: {
      type: String,
      enum: ["fixed", "percentage"],
      required: true,
      default: "fixed",
    },
  },
  { timestamps: true },
);

export const PlatformFee = mongoose.model("PlatformFee", platformFeeSchema);

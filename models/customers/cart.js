import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const cartSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    product: {
      type: String,
      ref: "Product",
      required: true,
    },
    user: {
      type: String,
      ref: "User",
      required: true,
      index: true,
    },
    quantity: {
      type: Number,
      default: 1,
      min: [1, "Quantity must be at least 1"],
    },
    sellerId: {
      type: String,
      ref: "User",
      index: true,
    },
  },
  { timestamps: true }
);

cartSchema.index({ product: 1, user: 1 }, { unique: true }); // এক user এক product শুধুমাত্র একবার রাখতে পারবে

export const Cart = mongoose.model("Cart", cartSchema);

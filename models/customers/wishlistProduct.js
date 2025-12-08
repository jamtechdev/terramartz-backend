import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const wishlistProductSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    user: {
      type: String,
      ref: "User",
      required: true,
      index: true,
    },
    product: {
      type: String,
      ref: "Product",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Prevent duplicate wishlist entries per user
wishlistProductSchema.index({ user: 1, product: 1 }, { unique: true });

export const WishlistProduct = mongoose.model(
  "WishlistProduct",
  wishlistProductSchema
);

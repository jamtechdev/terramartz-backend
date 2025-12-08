import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const reviewSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },

    product: {
      type: String,
      ref: "Product",
      required: [true, "Review must be for a product."],
    },

    user: {
      type: String,
      ref: "User",
      required: [true, "Review must have a user."],
    },

    rating: {
      type: Number,
      min: [1, "Rating must be at least 1."],
      max: [5, "Rating cannot be more than 5."],
      required: [true, "Rating is required."],
    },

    message: {
      type: String,
      trim: true,
      maxlength: 500, // optional message
    },

    sellerReply: {
      type: String,
      trim: true,
      maxlength: 500, // seller optional reply
    },
  },
  { timestamps: true }
);

export const Review = mongoose.model("Review", reviewSchema);

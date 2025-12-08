import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const productPerformanceSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    product: {
      type: String,
      ref: "Product",
      required: true,
      unique: true, // 1:1 relationship with Product
    },
    totalSales: {
      type: Number,
      default: 0,
    },
    totalQuantitySold: {
      type: Number,
      default: 0,
    },

    views: {
      type: Number,
      default: 0,
    },
    rating: {
      type: Number,
      default: 0,
    },
    currentStock: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export const ProductPerformance = mongoose.model(
  "ProductPerformance",
  productPerformanceSchema
);

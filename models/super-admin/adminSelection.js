import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const adminSelectionSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    productId: { type: String, ref: "Product", required: true },
    adminId: { type: String, ref: "User", required: true }, // optional, কে select করল
  },
  { timestamps: true }
);

export const AdminSelection = mongoose.model(
  "AdminSelection",
  adminSelectionSchema
);

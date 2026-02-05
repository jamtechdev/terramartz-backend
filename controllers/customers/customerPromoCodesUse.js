import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import slugify from "slugify";

const userPromoCodeUse = new mongoose.Schema(
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
    promoCode: {
      type: String,
      required: true,
    },
    purchase_id: {
      type: String, // Purchase _id
      ref: "Purchase",
      required: false,
    },
  },
  { timestamps: true },
);

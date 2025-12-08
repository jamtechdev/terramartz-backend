import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const verifySchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    phoneNumber: {
      type: String,
      required: false,
      trim: true,
      validate: {
        validator: function (v) {
          return !v || /^\+?\d{10,15}$/.test(v); // Validate phone number only if provided
        },
        message: "Invalid phone number format!",
      },
    },
    phoneOtp: {
      type: Number,
    },
    phoneOtpExpiresAt: {
      type: Date,
    },
    email: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); // Validate email only if provided
        },
        message: "Invalid email format!",
      },
    },
    emailOtp: {
      type: Number,
    },
    emailOtpExpiresAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

export const Verify = mongoose.model("Verify", verifySchema);

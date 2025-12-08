import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const profileUpdateVerificationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    user: {
      type: String,
      ref: "User",
      required: true,
      unique: true, // ⭐ ensure one active verification per user
    },
    pendingData: {
      firstName: String,
      lastName: String,
      email: String,
      phoneNumber: String,
      bio: String,
    },
    emailOtp: String,
    emailOtpExpiresAt: Date,
    phoneOtp: String,
    phoneOtpExpiresAt: Date,
    step: {
      type: String,
      enum: ["emailPending", "phonePending", "completed"],
      default: "emailPending",
    },

    // ---------- new fields for resend / rate-limit ----------
    resendCount: {
      type: Number,
      default: 0,
    },
    firstSentAt: Date, // when the first OTP for this verification was sent
    lastSentAt: Date, // last time an OTP was sent (email or phone)
    otpAttempts: {
      type: Number,
      default: 0, // how many times user attempted OTP input (optional)
    },
    // --------------------------------------------------------
  },
  { timestamps: true }
);

export const ProfileUpdateVerification = mongoose.model(
  "ProfileUpdateVerification",
  profileUpdateVerificationSchema
);

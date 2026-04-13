import crypto from "crypto";
import { Verify } from "../models/verify.js";
import { User } from "../models/users.js";
import AppError from "../utils/apperror.js";
import Email from "../utils/vefiryEmail.js";

/** Skip sending another email if the same address requested OTP within this window (duplicate client calls, etc.). Explicit resend sets body.resend=true. */
const SEND_EMAIL_OTP_COOLDOWN_MS = 90_000;

export const sendEmailVerificationOtp = async (req, res, next) => {
  try {
    const { email, resend, forceResend } = req.body;

    if (!email || typeof email !== "string") {
      return next(new AppError("Email is required", 400));
    }

    const normalized = String(email).toLowerCase().trim();
    const allowResend = resend === true || forceResend === true;

    if (!allowResend) {
      const existing = await Verify.findOne({ email: normalized });
      if (existing?.createdAt) {
        const age = Date.now() - new Date(existing.createdAt).getTime();
        if (age >= 0 && age < SEND_EMAIL_OTP_COOLDOWN_MS) {
          return res.status(200).json({
            status: "Success",
            message: "OTP already sent recently",
            deduped: true,
            ...(process.env.NODE_ENV === "development" && {
              emailOtp: existing.emailOtp,
              expiresAt: new Date(existing.emailOtpExpiresAt).toISOString(),
            }),
          });
        }
      }
    }

    await Verify.deleteOne({ email: normalized });
    // create 6 digit otp
    const otp = crypto.randomInt(100000, 1000000).toString();
    // The validity of the OTP is 5 minutes.
    const otpExpiry = Date.now() + 5 * 60 * 1000;

    // Create document
    const verifyDocs = await Verify.create({
      email: normalized,
      emailOtp: otp,
      emailOtpExpiresAt: otpExpiry,
    });

    await new Email(verifyDocs, null, null).sendEmailVerificationOtpFn();
    return res.status(200).json({
      status: "Success",
      message: "OTP sent to email",
      // Show OTP in development mode for testing
      ...(process.env.NODE_ENV === "development" && {
        emailOtp: verifyDocs.emailOtp,
        expiresAt: new Date(verifyDocs.emailOtpExpiresAt).toISOString(),
      }),
    });
  } catch (error) {
    console.error("❌ Email sending error:", error);
    // Show actual error in development, generic in production
    const errorMessage = process.env.NODE_ENV === "development" 
      ? error.message || "There was an error sending the email. Try again later"
      : "There was an error sending the email. Try again later";
    return next(
      new AppError(errorMessage, 500)
    );
  }
};
export const verifyEmail = async (req, res, next) => {
  // Accept emailOtp, emailotp, or otp from clients
  const { email, emailOtp, emailotp, otp: bodyOtp } = req.body;
  const otp = emailOtp || emailotp || bodyOtp;
  
  if (!email || !otp) {
    return next(new AppError("Email and OTP are required", 400));
  }

  try {
    const normalizedEmail = String(email).toLowerCase().trim();
    const verifyDocs = await Verify.findOne({ email: normalizedEmail });

    if (!verifyDocs)
      return res
        .status(404)
        .json({ message: "Email not found. Please check and try again." });

    // Convert both to string for comparison (model stores as Number, but we compare as string)
    const storedOtp = String(verifyDocs.emailOtp).trim();
    const receivedOtp = String(otp).trim();

    // Debug logging
    console.log("🔍 OTP Verification Debug:");
    console.log("   Email:", email);
    console.log("   Received OTP:", receivedOtp, "(type:", typeof receivedOtp + ")");
    console.log("   Stored OTP:", storedOtp, "(type:", typeof storedOtp + ")");
    console.log("   OTP Match:", storedOtp === receivedOtp);
    console.log("   OTP Expires At:", new Date(verifyDocs.emailOtpExpiresAt));
    console.log("   Current Time:", new Date());
    console.log("   Is Expired:", new Date(verifyDocs.emailOtpExpiresAt).getTime() < Date.now());

    // Check if OTP is expired
    const isExpired = new Date(verifyDocs.emailOtpExpiresAt).getTime() < Date.now();
    
    if (isExpired) {
      return next(new AppError("OTP has expired. Please request a new OTP", 400));
    }
    
    // Check if OTP matches (both converted to string)
    if (storedOtp !== receivedOtp) {
      // In development, show helpful message
      if (process.env.NODE_ENV === "development") {
        return next(new AppError(
          `OTP mismatch. You entered: ${otp}, but the current OTP is: ${verifyDocs.emailOtp}. Please use the latest OTP from your email.`,
          400
        ));
      }
      return next(new AppError("Invalid OTP. Please use the latest OTP sent to your email", 400));
    }

    // delete document
    await Verify.findByIdAndDelete(verifyDocs._id);

    await User.updateOne(
      { email: normalizedEmail },
      {
        $set: {
          emailVerified: true,
          isAccountVerified: true,
        },
      },
    );

    res.status(200).json({
      emailVerified: true,
      message: "Your email has been successfully verified! ",
    });
  } catch (err) {
    return next(new AppError(err.message, 401));
  }
};

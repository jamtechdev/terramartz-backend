import crypto from "crypto";
import { Verify } from "../models/verify.js";
import AppError from "../utils/apperror.js";
import Email from "../utils/vefiryEmail.js";

export const sendEmailVerificationOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    // delete previous document
    await Verify.deleteOne({ email });
    // create 6 digit otp
    const otp = crypto.randomInt(100000, 1000000).toString();
    // The validity of the OTP is 5 minutes.
    const otpExpiry = Date.now() + 5 * 60 * 1000;

    // Create document
    const verifyDocs = await Verify.create({
      email: email,
      emailOtp: otp,
      emailOtpExpiresAt: otpExpiry,
    });

    await new Email(verifyDocs, null, null).sendEmailVerificationOtpFn();
    return res.status(200).json({
      status: "Success",
      message: "OTP sent to email",
      // emailOtp: verifyDocs?.emailOtp ? verifyDocs?.emailOtp : "",
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
  const { email, emailOtp } = req.body;
  try {
    const verifyDocs = await Verify.findOne({ email: email });

    if (!verifyDocs)
      return res
        .status(404)
        .json({ message: "Email not found. Please check and try again." });

    if (
      verifyDocs.emailOtp !== emailOtp ||
      new Date(verifyDocs.emailOtpExpiresAt).getTime() < Date.now()
    ) {
      return next(new AppError("Invalid or expired OTP", 400));
    }

    // delete document
    await Verify.findByIdAndDelete(verifyDocs._id);

    //3)if everythings ok
    res.status(200).json({
      emailVerified: true,
      message: "Your email has been successfully verified! ",
    });
  } catch (err) {
    return next(new AppError(err.message, 401));
  }
};

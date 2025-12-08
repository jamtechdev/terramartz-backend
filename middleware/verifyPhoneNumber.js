// please use this otp for every time: 3142
import crypto from "crypto";
import twilio from "twilio";

import { User } from "../models/users.js";
import AppError from "../utils/apperror.js";
import { Verify } from "../models/verify.js";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export const sendPhoneNumberVerificationOtp = async (req, res, next) => {
  try {
    const { phoneNumber } = req.body;

    const findPhoneNumber = await Verify.findOne({ phoneNumber: phoneNumber });

    if (findPhoneNumber) {
      // delete previous document
      await Verify.deleteOne({ phoneNumber }); // testing hoye gale comment tule den
    }

    // create 6 digit otp
    const otp = crypto.randomInt(100000, 1000000).toString();
    // The validity of the OTP is 3 months
    const otpExpiry = Date.now() + 5 * 60 * 1000;

    // Create document
    const verifyDocs = await Verify.create({
      phoneNumber: phoneNumber,
      phoneOtp: otp,
      phoneOtpExpiresAt: otpExpiry,
    });

    try {
      await client.messages.create({
        body: `Your OTP is ${otp}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber,
      });
    } catch (error) {
      console.log("Twilio error:", error);
      return next(new AppError("Failed to send OTP. Try again later", 500));
    }
    return res.status(200).json({
      status: "success",
      message: "OTP sent successfully!",
    });
  } catch (error) {
    return next(new AppError("Failed to send OTP. Try again later", 500));
  }
};

export const verifyPhoneNumber = async (req, res, next) => {
  const { phoneNumber, phoneOtp } = req.body;
  try {
    const verifyDocs = await Verify.findOne({ phoneNumber: phoneNumber });

    if (!verifyDocs)
      return next(
        new AppError("Phone Number not found. Please check and try again.", 404)
      );

    if (
      verifyDocs.phoneOtp !== phoneOtp ||
      new Date(verifyDocs.phoneOtpExpiresAt).getTime() < Date.now()
    ) {
      return next(new AppError("Invalid or expired OTP", 400));
    }

    // delete document
    await Verify.findByIdAndDelete(verifyDocs._id); // testing hoye gale comment tule den....

    //3)if everythings ok
    res.status(200).json({
      phoneNumberVerified: true,
      message: "Your phone Number has been successfully verified! ",
    });
  } catch (err) {
    return next(new AppError(err.message, 401));
  }
};

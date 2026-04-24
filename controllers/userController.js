import crypto from "crypto";
import twilio from "twilio";
import {
  uploadToS3,
  getPresignedUrl,
  deleteFileFromS3,
} from "../utils/awsS3.js";
import sharp from "sharp";

import catchAsync from "../utils/catchasync.js";
import AppError from "../utils/apperror.js";
import Email from "../utils/vefiryEmail.js";

import { User } from "../models/users.js";
import { ProfileUpdateVerification } from "../models/common/ProfileUpdateVerification.js";
import { getSmsPhoneValidationError } from "../utils/phoneSmsValidation.js";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);
// user profile update code end....

// ✅ Get logged-in user information

export const getLoggedInUser = catchAsync(async (req, res, next) => {
  if (!req.user || !req.user.id) {
    return next(new AppError("User not authenticated", 401));
  }

  const user = await User.findById(req.user.id);

  if (!user) {
    return next(new AppError("No User found with that Id", 404));
  }

  // --------- ONLY MODIFYING BELOW THIS LINE ---------

  // Convert mongoose document to plain object
  const userObj = user.toObject();

  // Apply presigned URL to profilePicture (if exists)
  if (userObj.profilePicture) {
    userObj.profilePicture = await getPresignedUrl(
      `profilePicture/${userObj.profilePicture}`,
    );
  }

  // Apply presigned URL to sellerProfile.shopPicture (if exists)
  if (userObj.sellerProfile && userObj.sellerProfile.shopPicture) {
    userObj.sellerProfile.shopPicture = await getPresignedUrl(
      `shopPicture/${userObj.sellerProfile.shopPicture}`,
    );
  }

  // --------- END OF MODIFICATION ---------

  res.status(200).json({
    status: "success",
    data: userObj, // unchanged response format
  });
});

export const sendPhoneNumberVerificationOtpDirect = async (
  phoneNumber,
  otp,
) => {
  const digitsOnly = String(phoneNumber || "").replace(/\D/g, "");
  const smsErr = getSmsPhoneValidationError(digitsOnly);
  if (smsErr) {
    throw new AppError(smsErr, 400);
  }
  const to = `+${digitsOnly}`;
  try {
    await client.messages.create({
      body: `Your OTP is ${otp}. It is valid for 5 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });

    return { status: "success", message: "OTP sent successfully!" };
  } catch (error) {
    console.log("Twilio error:", error);
    const code = error?.code;
    if (code === 21211 || code === 21614) {
      throw new AppError(
        "This number cannot receive text messages. Use a valid mobile number with country code—for example +1 and a 10-digit US or Canada number.",
        400,
      );
    }
    if (code === 21608) {
      throw new AppError(
        "We could not send a text to this number. Try another mobile number or contact support if it keeps happening.",
        400,
      );
    }
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to send OTP. Try again later", 500);
  }
};

export const startUpdateVerification = catchAsync(async (req, res, next) => {
  const {
    firstName,
    lastName,
    businessName, // For sellers
    email,
    phoneNumber,
    bio,
    emailNotifications,
    pushNotifications,
    marketingEmails,
    notificationFrequency,
    language,
    currency,
    defaultAddress, // { street, city, state, zipCode }
  } = req.body;

  const userId = req.user._id;
  const user = await User.findById(userId);
  if (!user) return next(new AppError("User not found", 404));

  // Check if email or phone changed
  const isEmailNew = email && email !== user.email;
  const isPhoneNew = phoneNumber && phoneNumber !== user.phoneNumber;

  // 🔹 Profile Picture processing - upload immediately if provided
  let profilePictureKey = user.profilePicture || null;
  if (req.files?.profilePicture?.[0]) {
    // Delete previous image from S3 if exists
    if (user.profilePicture) {
      await deleteFileFromS3(`profilePicture/${user.profilePicture}`);
    }

    const buffer = await sharp(req.files.profilePicture[0].buffer)
      .resize({ width: 500, height: 500, fit: "inside" })
      .jpeg({ quality: 90 })
      .toBuffer();

    profilePictureKey = `${userId}-${Date.now()}-profile.jpeg`;
    await uploadToS3(
      buffer,
      `profilePicture/${profilePictureKey}`,
      "image/jpeg",
    );
  }

  if (isPhoneNew) {
    const pd = String(phoneNumber || "").replace(/\D/g, "");
    const smsErr = getSmsPhoneValidationError(pd);
    if (smsErr) return next(new AppError(smsErr, 400));
  }

  if (!isEmailNew && !isPhoneNew) {
    // Update profile picture if changed
    if (profilePictureKey) {
      user.profilePicture = profilePictureKey;
      await user.save();
    }

    const directUpdate = {
      firstName,
      lastName,
      bio,
      emailNotifications,
      pushNotifications,
      marketingEmails,
      notificationFrequency,
      language,
      currency,
      defaultAddress,
    };

    if (user.role === "seller" && businessName) {
      directUpdate["businessDetails.businessName"] = businessName;
      directUpdate["sellerProfile.shopName"] = businessName;
    }

    const updatedUser = await User.findByIdAndUpdate(userId, directUpdate, {
      new: true,
      runValidators: true,
    });

    // Apply presigned URL to profile picture
    const userObj = updatedUser.toObject();
    if (userObj.profilePicture) {
      userObj.profilePicture = await getPresignedUrl(
        `profilePicture/${userObj.profilePicture}`,
      );
    }

    return res.status(200).json({
      status: "success",
      message: "Profile updated successfully",
      data: userObj,
    });
  }

  // OTP generate only if email or phone is new
  const emailOtp = isEmailNew
    ? crypto.randomInt(100000, 999999).toString()
    : null;
  const emailOtpExpiresAt = isEmailNew ? Date.now() + 5 * 60 * 1000 : null;

  const phoneOtp = isPhoneNew
    ? crypto.randomInt(100000, 999999).toString()
    : null;
  const phoneOtpExpiresAt = isPhoneNew ? Date.now() + 5 * 60 * 1000 : null;

  const now = new Date();

  // Build update payload with profile picture info
  const normalizedPendingPhone =
    isPhoneNew && phoneNumber
      ? `+${String(phoneNumber).replace(/\D/g, "")}`
      : phoneNumber;

  const updatePayload = {
    user: userId,
    pendingData: {
      firstName,
      lastName,
      businessName,
      email,
      phoneNumber: normalizedPendingPhone,
      bio,
      emailNotifications,
      pushNotifications,
      marketingEmails,
      notificationFrequency,
      language,
      currency,
      defaultAddress,
      profilePicture: profilePictureKey, // Store profile picture in pending data
    },
    ...(isEmailNew ? { emailOtp, emailOtpExpiresAt } : {}),
    ...(isPhoneNew ? { phoneOtp, phoneOtpExpiresAt } : {}),
    $setOnInsert: {
      resendCount: 0,
      firstSentAt: now,
    },
    lastSentAt: now,
    step: isEmailNew
      ? "emailPending"
      : isPhoneNew
        ? "phonePending"
        : "completed",
  };

  const updatedVerification = await ProfileUpdateVerification.findOneAndUpdate(
    { user: userId },
    {
      $set: {
        pendingData: updatePayload.pendingData,
        ...(isEmailNew ? { emailOtp: updatePayload.emailOtp } : {}),
        ...(isEmailNew
          ? { emailOtpExpiresAt: updatePayload.emailOtpExpiresAt }
          : {}),
        ...(isPhoneNew ? { phoneOtp: updatePayload.phoneOtp } : {}),
        ...(isPhoneNew
          ? { phoneOtpExpiresAt: updatePayload.phoneOtpExpiresAt }
          : {}),
        step: updatePayload.step,
        lastSentAt: updatePayload.lastSentAt,
      },
      $setOnInsert: {
        resendCount: 0,
        firstSentAt: now,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  // Send OTPs if email or phone changed
  if (isEmailNew) {
    await new Email(
      {
        email,
        emailOtp: updatedVerification.emailOtp,
        firstName: user.firstName || firstName, // Include firstName for email template
      },
      null,
      process.env.FRONTEND_URL,
    ).sendEmailVerificationOtpFn();
  }

  if (!isEmailNew && isPhoneNew) {
    try {
      await sendPhoneNumberVerificationOtpDirect(
        normalizedPendingPhone,
        updatedVerification.phoneOtp,
      );
    } catch (error) {
      if (error instanceof AppError) return next(error);
      return next(
        new AppError(
          error?.message
            ? `Failed to send phone OTP: ${error.message}`
            : "Failed to send phone OTP",
          500,
        ),
      );
    }
  }

  res.status(200).json({
    status: "success",
    message: "Verification OTP sent successfully",
    verificationId: updatedVerification._id,
    step: updatedVerification.step,
  });
});

export const resendVerificationOtp = async (req, res, next) => {
  try {
    const { verificationId, type } = req.body;
    if (!verificationId || !type)
      return next(new AppError("Missing verificationId or type", 400));
    if (!["email", "phone"].includes(type))
      return next(new AppError("Invalid type", 400));

    const verification =
      await ProfileUpdateVerification.findById(verificationId);
    if (!verification) return next(new AppError("Verification not found", 404));

    // Simple rate-limit rules
    const MIN_RETRY_INTERVAL_MS = 60 * 1000; // 60 seconds between sends
    const MAX_RESENDS_PER_WINDOW = 5; // e.g., 5 resends per 24 hours
    const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

    const now = Date.now();

    // If lastSentAt exists and too soon, reject
    if (
      verification.lastSentAt &&
      now - verification.lastSentAt.getTime() < MIN_RETRY_INTERVAL_MS
    ) {
      return next(
        new AppError("Please wait before requesting another OTP", 429),
      );
    }

    // Reset window if firstSentAt older than WINDOW_MS
    if (
      !verification.firstSentAt ||
      now - verification.firstSentAt.getTime() > WINDOW_MS
    ) {
      verification.firstSentAt = now;
      verification.resendCount = 0;
    }

    if (verification.resendCount >= MAX_RESENDS_PER_WINDOW) {
      return next(
        new AppError(
          "You have exceeded the maximum resend attempts for today",
          429,
        ),
      );
    }

    // Generate new OTP & expiry for requested type
    if (type === "email") {
      if (!verification.pendingData?.email)
        return next(new AppError("No pending email to send OTP to", 400));
      const newEmailOtp = crypto.randomInt(100000, 999999).toString();
      verification.emailOtp = newEmailOtp;
      verification.emailOtpExpiresAt = Date.now() + 5 * 60 * 1000;
      verification.step = "emailPending";
      // update metadata
      verification.resendCount = (verification.resendCount || 0) + 1;
      verification.lastSentAt = now;
      await verification.save();

      // send email (use your existing Email util)
      try {
        // Get user for firstName
        const user = await User.findById(verification.user);
        await new Email(
          {
            email: verification.pendingData.email,
            emailOtp: newEmailOtp,
            firstName: user?.firstName || verification.pendingData?.firstName,
          },
          null,
          process.env.FRONTEND_URL,
        ).sendEmailVerificationOtpFn();
      } catch (err) {
        return next(
          new AppError("Failed to send email OTP: " + err.message, 500),
        );
      }

      return res.status(200).json({
        status: "success",
        message: "Email OTP resent successfully",
        verificationId: verification._id,
        step: verification.step,
      });
    } else {
      // phone resend
      if (!verification.pendingData?.phoneNumber)
        return next(new AppError("No pending phone to send OTP to", 400));
      const newPhoneOtp = crypto.randomInt(100000, 999999).toString();
      verification.phoneOtp = newPhoneOtp;
      verification.phoneOtpExpiresAt = Date.now() + 5 * 60 * 1000;
      verification.step = "phonePending";
      verification.resendCount = (verification.resendCount || 0) + 1;
      verification.lastSentAt = now;
      await verification.save();

      // send sms via twilio (direct)
      try {
        await sendPhoneNumberVerificationOtpDirect(
          verification.pendingData.phoneNumber,
          newPhoneOtp,
        );
      } catch (err) {
        if (err instanceof AppError) return next(err);
        return next(
          new AppError(
            err?.message
              ? `Failed to send phone OTP: ${err.message}`
              : "Failed to send phone OTP",
            500,
          ),
        );
      }

      return res.status(200).json({
        status: "success",
        message: "Phone OTP resent successfully",
        verificationId: verification._id,
        step: verification.step,
      });
    }
  } catch (err) {
    next(err);
  }
};

// -------------------- VERIFY EMAIL OTP (kept mostly same, minor safety) --------------------
export const verifyEmailOtp = async (req, res, next) => {
  try {
    const { verificationId, emailOtp } = req.body;
    const verification =
      await ProfileUpdateVerification.findById(verificationId);

    if (!verification) return next(new AppError("Verification not found", 404));

    const otpOk =
      verification.emailOtp &&
      String(verification.emailOtp).trim() === String(emailOtp || "").trim();
    if (
      !otpOk ||
      !verification.emailOtpExpiresAt ||
      verification.emailOtpExpiresAt < Date.now()
    ) {
      return next(new AppError("Invalid or expired OTP", 400));
    }

    // Decide next step
    const user = await User.findById(verification.user);

    if (
      verification.pendingData.phoneNumber &&
      verification.pendingData.phoneNumber !== user.phoneNumber
    ) {
      verification.step = "phonePending";
      // Save step before sending OTP
      await verification.save();

      // send phone OTP via direct helper (avoid relying on find inside helper)
      try {
        await sendPhoneNumberVerificationOtpDirect(
          verification.pendingData.phoneNumber,
          verification.phoneOtp,
        );
      } catch (err) {
        if (err instanceof AppError) return next(err);
        return next(
          new AppError(
            err?.message
              ? `Failed to send phone OTP: ${err.message}`
              : "Failed to send phone OTP",
            500,
          ),
        );
      }
    } else {
      verification.step = "completed";

      // Final update to user (user is already fetched above)
      const isSeller = user.role === "seller";

      const updatePayload = {
        email: verification.pendingData.email,
        phoneNumber: verification.pendingData.phoneNumber,
        bio: verification.pendingData.bio,
        emailNotifications: verification.pendingData.emailNotifications,
        pushNotifications: verification.pendingData.pushNotifications,
        marketingEmails: verification.pendingData.marketingEmails,
        notificationFrequency: verification.pendingData.notificationFrequency,
        language: verification.pendingData.language,
        currency: verification.pendingData.currency,
        defaultAddress: verification.pendingData.defaultAddress,
      };

      // Add profile picture if it was updated
      if (verification.pendingData.profilePicture) {
        updatePayload.profilePicture = verification.pendingData.profilePicture;
      }

      if (
        typeof verification.pendingData.firstName === "string" &&
        verification.pendingData.firstName.trim() !== ""
      ) {
        updatePayload.firstName = verification.pendingData.firstName.trim();
      }
      if (
        typeof verification.pendingData.lastName === "string" &&
        verification.pendingData.lastName.trim() !== ""
      ) {
        updatePayload.lastName = verification.pendingData.lastName.trim();
      }

      // Seller shop / business name
      if (isSeller && verification.pendingData.businessName) {
        if (!user.businessDetails) {
          updatePayload.businessDetails = {
            businessName: verification.pendingData.businessName,
          };
        } else {
          updatePayload["businessDetails.businessName"] =
            verification.pendingData.businessName;
        }

        if (!user.sellerProfile) {
          updatePayload.sellerProfile = {
            shopName: verification.pendingData.businessName,
          };
        } else {
          updatePayload["sellerProfile.shopName"] =
            verification.pendingData.businessName;
        }
      }

      updatePayload.emailVerified = true;

      await User.findByIdAndUpdate(verification.user, { $set: updatePayload });

      // Delete verification document after final update
      await ProfileUpdateVerification.findByIdAndDelete(verification._id);
    }

    res.status(200).json({
      status: "success",
      message: "Email verified successfully",
      step: verification.step,
    });
  } catch (err) {
    next(err);
  }
};

// -------------------- VERIFY PHONE OTP (kept mostly same) --------------------
export const verifyPhoneOtp = async (req, res, next) => {
  try {
    const { verificationId, phoneOtp } = req.body;
    const verification =
      await ProfileUpdateVerification.findById(verificationId);

    if (!verification) return next(new AppError("Verification not found", 404));

    const phoneOtpOk =
      verification.phoneOtp &&
      String(verification.phoneOtp).trim() === String(phoneOtp || "").trim();
    if (
      !phoneOtpOk ||
      !verification.phoneOtpExpiresAt ||
      verification.phoneOtpExpiresAt < Date.now()
    ) {
      return next(new AppError("Invalid or expired OTP", 400));
    }

    // Final update to user
    const user = await User.findById(verification.user);
    const isSeller = user.role === "seller";

    const updatePayload = {
      email: verification.pendingData.email,
      phoneNumber: verification.pendingData.phoneNumber,
      bio: verification.pendingData.bio,
      emailNotifications: verification.pendingData.emailNotifications,
      pushNotifications: verification.pendingData.pushNotifications,
      marketingEmails: verification.pendingData.marketingEmails,
      notificationFrequency: verification.pendingData.notificationFrequency,
      language: verification.pendingData.language,
      currency: verification.pendingData.currency,
      defaultAddress: verification.pendingData.defaultAddress,
    };

    // Add profile picture if it was updated
    if (verification.pendingData.profilePicture) {
      updatePayload.profilePicture = verification.pendingData.profilePicture;
    }

    if (
      typeof verification.pendingData.firstName === "string" &&
      verification.pendingData.firstName.trim() !== ""
    ) {
      updatePayload.firstName = verification.pendingData.firstName.trim();
    }
    if (
      typeof verification.pendingData.lastName === "string" &&
      verification.pendingData.lastName.trim() !== ""
    ) {
      updatePayload.lastName = verification.pendingData.lastName.trim();
    }

    if (isSeller && verification.pendingData.businessName) {
      if (!user.businessDetails) {
        updatePayload.businessDetails = {
          businessName: verification.pendingData.businessName,
        };
      } else {
        updatePayload["businessDetails.businessName"] =
          verification.pendingData.businessName;
      }

      if (!user.sellerProfile) {
        updatePayload.sellerProfile = {
          shopName: verification.pendingData.businessName,
        };
      } else {
        updatePayload["sellerProfile.shopName"] =
          verification.pendingData.businessName;
      }
    }

    updatePayload.emailVerified = true;
    updatePayload.phoneVerified = true;

    await User.findByIdAndUpdate(verification.user, { $set: updatePayload });

    verification.step = "completed";
    await verification.save(); // Save step before delete
    // Delete verification document after final update
    await ProfileUpdateVerification.findByIdAndDelete(verification._id);

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully",
    });
  } catch (err) {
    next(err);
  }
};

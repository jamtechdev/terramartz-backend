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

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
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
      `profilePicture/${userObj.profilePicture}`
    );
  }

  // Apply presigned URL to sellerProfile.shopPicture (if exists)
  if (userObj.sellerProfile && userObj.sellerProfile.shopPicture) {
    userObj.sellerProfile.shopPicture = await getPresignedUrl(
      `shopPicture/${userObj.sellerProfile.shopPicture}`
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
  otp
) => {
  try {
    await client.messages.create({
      body: `Your OTP is ${otp}. It is valid for 5 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber,
    });
    return { status: "success", message: "OTP sent successfully!" };
  } catch (error) {
    console.log("Twilio error:", error);
    throw new Error("Failed to send OTP. Try again later");
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

  // Determine if user is a seller
  const isSeller = user.role === "seller";

  // 🔹 Profile Picture processing
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
      "image/jpeg"
    );
  }

  // Check if email or phone changed
  const isEmailNew = email && email !== user.email;
  const isPhoneNew = phoneNumber && phoneNumber !== user.phoneNumber;

  // Direct update without OTP - email/phone bhi direct update hoga, verify button par OTP send hoga
  // Always do direct update, OTP will be sent only when user clicks verify button
  
  // Build update payload based on user role
  const updatePayload = {
    email: email || user.email, // Update email directly
    phoneNumber: phoneNumber || user.phoneNumber, // Update phone directly
    bio,
    emailNotifications,
    pushNotifications,
    marketingEmails,
    notificationFrequency,
    language,
    currency,
    defaultAddress,
    profilePicture: profilePictureKey,
  };

  // Update user document directly (better for nested objects)
  // Update basic fields first
  if (email) user.email = email;
  if (phoneNumber) user.phoneNumber = phoneNumber;
  if (bio !== undefined) user.bio = bio;
  if (emailNotifications !== undefined) user.emailNotifications = emailNotifications;
  if (pushNotifications !== undefined) user.pushNotifications = pushNotifications;
  if (marketingEmails !== undefined) user.marketingEmails = marketingEmails;
  if (notificationFrequency) user.notificationFrequency = notificationFrequency;
  if (language) user.language = language;
  if (currency) user.currency = currency;
  if (defaultAddress) user.defaultAddress = defaultAddress;
  if (profilePictureKey) user.profilePicture = profilePictureKey;

  // Add role-specific fields
  if (isSeller) {
    // For sellers: update businessName in both businessDetails and sellerProfile
    if (businessName !== undefined && businessName !== null && businessName !== "") {
      const trimmedBusinessName = businessName.trim();
      
      // Update businessDetails
      if (!user.businessDetails) {
        user.businessDetails = { businessName: trimmedBusinessName };
      } else {
        user.businessDetails.businessName = trimmedBusinessName;
      }
      
      // Update sellerProfile
      if (!user.sellerProfile) {
        user.sellerProfile = { shopName: trimmedBusinessName };
      } else {
        user.sellerProfile.shopName = trimmedBusinessName;
      }
      
      console.log("🔄 Updating seller business name:", {
        businessName: trimmedBusinessName,
        hasBusinessDetails: !!user.businessDetails,
        hasSellerProfile: !!user.sellerProfile,
        currentBusinessName: user.businessDetails?.businessName,
        currentShopName: user.sellerProfile?.shopName,
      });
    } else {
      console.log("⚠️ Business name is empty/undefined/null, skipping update. Value:", businessName);
    }
  } else if (!isSeller) {
    // For normal users: update firstName and lastName
    if (firstName !== undefined && firstName !== null) user.firstName = firstName.trim();
    if (lastName !== undefined && lastName !== null) user.lastName = lastName.trim();
    console.log("🔄 Updating user name:", { firstName, lastName });
  }

  console.log("📥 Request body businessName:", businessName);
  console.log("📥 User role:", user.role, "isSeller:", isSeller);
  console.log("📥 Current user before save:", {
    businessName: user.businessDetails?.businessName,
    shopName: user.sellerProfile?.shopName,
  });

  // Save the user document
  await user.save();

  console.log("✅ User saved successfully");

  // Re-fetch the user to ensure we have the latest data with all fields
  const freshUser = await User.findById(userId).lean();
  if (!freshUser) {
    return next(new AppError("Failed to fetch updated user", 500));
  }

  // Use lean() result directly (already a plain object)
  const updatedUserObj = freshUser;
  
  console.log("✅ Updated user object (after re-fetch):", {
    businessName: updatedUserObj.businessDetails?.businessName,
    shopName: updatedUserObj.sellerProfile?.shopName,
    firstName: updatedUserObj.firstName,
    lastName: updatedUserObj.lastName,
    hasBusinessDetails: !!updatedUserObj.businessDetails,
    hasSellerProfile: !!updatedUserObj.sellerProfile,
    businessDetailsKeys: updatedUserObj.businessDetails ? Object.keys(updatedUserObj.businessDetails) : [],
    sellerProfileKeys: updatedUserObj.sellerProfile ? Object.keys(updatedUserObj.sellerProfile) : [],
  });
  
  // presigned URL
  if (updatedUserObj.profilePicture) {
    updatedUserObj.profilePicture = await getPresignedUrl(
      `profilePicture/${updatedUserObj.profilePicture}`
    );
  }

  // Apply presigned URL to sellerProfile.shopPicture if exists
  if (updatedUserObj.sellerProfile && updatedUserObj.sellerProfile.shopPicture) {
    updatedUserObj.sellerProfile.shopPicture = await getPresignedUrl(
      `shopPicture/${updatedUserObj.sellerProfile.shopPicture}`
    );
  }

  console.log("📤 Sending response with data:", {
    businessName: updatedUserObj.businessDetails?.businessName,
    shopName: updatedUserObj.sellerProfile?.shopName,
    dataKeys: Object.keys(updatedUserObj),
    dataSize: JSON.stringify(updatedUserObj).length,
  });

  // Ensure data object is not empty
  if (!updatedUserObj || Object.keys(updatedUserObj).length === 0) {
    console.error("❌ ERROR: updatedUserObj is empty!");
    return next(new AppError("Failed to get updated user data", 500));
  }

  const response = {
    status: "success",
    message: "Profile updated successfully",
    data: updatedUserObj,
  };

  console.log("📤 Final response structure:", {
    hasStatus: !!response.status,
    hasMessage: !!response.message,
    hasData: !!response.data,
    dataKeys: response.data ? Object.keys(response.data) : [],
  });

  return res.status(200).json(response);
});
// export const startUpdateVerification = async (req, res, next) => {
//   try {
//     const {
//       firstName,
//       lastName,
//       email,
//       phoneNumber,
//       bio,
//       emailNotifications,
//       pushNotifications,
//       marketingEmails,
//       notificationFrequency,
//       language,
//       currency,
//       defaultAddress, // { street, city, state, zipCode }
//     } = req.body;

//     const userId = req.user._id;
//     const user = await User.findById(userId);
//     if (!user) return next(new AppError("User not found", 404));

//     // Check if email or phone changed
//     const isEmailNew = email && email !== user.email;
//     const isPhoneNew = phoneNumber && phoneNumber !== user.phoneNumber;

//     // যদি শুধু name/bio/preferences update হয় — OTP generate না করে direct update
//     if (!isEmailNew && !isPhoneNew) {
//       const updatedUser = await User.findByIdAndUpdate(
//         userId,
//         {
//           firstName,
//           lastName,
//           bio,
//           emailNotifications,
//           pushNotifications,
//           marketingEmails,
//           notificationFrequency,
//           language,
//           currency,
//           defaultAddress,
//         },
//         { new: true }
//       );

//       return res.status(200).json({
//         status: "success",
//         message: "Profile updated successfully",
//         data: updatedUser,
//       });
//     }

//     // OTP generate only if email or phone is new
//     const emailOtp = isEmailNew
//       ? crypto.randomInt(100000, 999999).toString()
//       : null;
//     const emailOtpExpiresAt = isEmailNew ? Date.now() + 5 * 60 * 1000 : null;

//     const phoneOtp = isPhoneNew
//       ? crypto.randomInt(100000, 999999).toString()
//       : null;
//     const phoneOtpExpiresAt = isPhoneNew ? Date.now() + 5 * 60 * 1000 : null;

//     const now = new Date();

//     // Build update payload
//     const updatePayload = {
//       user: userId,
//       pendingData: {
//         firstName,
//         lastName,
//         email,
//         phoneNumber,
//         bio,
//         emailNotifications,
//         pushNotifications,
//         marketingEmails,
//         notificationFrequency,
//         language,
//         currency,
//         defaultAddress,
//       },
//       ...(isEmailNew ? { emailOtp, emailOtpExpiresAt } : {}),
//       ...(isPhoneNew ? { phoneOtp, phoneOtpExpiresAt } : {}),
//       $setOnInsert: {
//         resendCount: 0,
//         firstSentAt: now,
//       },
//       lastSentAt: now,
//       step: isEmailNew
//         ? "emailPending"
//         : isPhoneNew
//         ? "phonePending"
//         : "completed",
//     };

//     const updatedVerification =
//       await ProfileUpdateVerification.findOneAndUpdate(
//         { user: userId },
//         {
//           $set: {
//             pendingData: updatePayload.pendingData,
//             ...(isEmailNew ? { emailOtp: updatePayload.emailOtp } : {}),
//             ...(isEmailNew
//               ? { emailOtpExpiresAt: updatePayload.emailOtpExpiresAt }
//               : {}),
//             ...(isPhoneNew ? { phoneOtp: updatePayload.phoneOtp } : {}),
//             ...(isPhoneNew
//               ? { phoneOtpExpiresAt: updatePayload.phoneOtpExpiresAt }
//               : {}),
//             step: updatePayload.step,
//             lastSentAt: updatePayload.lastSentAt,
//           },
//           $setOnInsert: {
//             resendCount: 0,
//             firstSentAt: now,
//           },
//         },
//         { new: true, upsert: true, setDefaultsOnInsert: true }
//       );

//     // Send OTPs if email or phone changed
//     if (isEmailNew) {
//       await new Email(
//         { email, emailOtp: updatedVerification.emailOtp },
//         null,
//         process.env.FRONTEND_URL
//       ).sendEmailVerificationOtpFn();
//     }

//     if (!isEmailNew && isPhoneNew) {
//       try {
//         await sendPhoneNumberVerificationOtpDirect(
//           phoneNumber,
//           updatedVerification.phoneOtp
//         );
//       } catch (error) {
//         return next(new AppError(error.message, 500));
//       }
//     }

//     res.status(200).json({
//       status: "success",
//       message: "Verification OTP sent successfully",
//       verificationId: updatedVerification._id,
//       step: updatedVerification.step,
//     });
//   } catch (err) {
//     next(err);
//   }
// };
export const resendVerificationOtp = async (req, res, next) => {
  try {
    const { verificationId, type } = req.body;
    if (!verificationId || !type)
      return next(new AppError("Missing verificationId or type", 400));
    if (!["email", "phone"].includes(type))
      return next(new AppError("Invalid type", 400));

    const verification = await ProfileUpdateVerification.findById(
      verificationId
    );
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
        new AppError("Please wait before requesting another OTP", 429)
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
          429
        )
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
        await new Email(
          { email: verification.pendingData.email, emailOtp: newEmailOtp },
          null,
          process.env.FRONTEND_URL
        ).sendEmailVerificationOtpFn();
      } catch (err) {
        return next(
          new AppError("Failed to send email OTP: " + err.message, 500)
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
          newPhoneOtp
        );
      } catch (err) {
        return next(
          new AppError("Failed to send phone OTP: " + err.message, 500)
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
    const verification = await ProfileUpdateVerification.findById(
      verificationId
    );

    if (!verification) return next(new AppError("Verification not found", 404));

    if (
      !verification.emailOtp ||
      verification.emailOtp !== emailOtp ||
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
          verification.phoneOtp
        );
      } catch (err) {
        return next(
          new AppError("Failed to send phone OTP: " + err.message, 500)
        );
      }
    } else {
      verification.step = "completed";

      // Final update to user (user is already fetched above)
      const isSeller = user.role === "seller";
      
      const updatePayload = {
        email: verification.pendingData.email,
        bio: verification.pendingData.bio,
      };

      // Add role-specific fields
      if (isSeller && verification.pendingData.businessName) {
        // Ensure nested objects exist
        if (!user.businessDetails) {
          updatePayload.businessDetails = { businessName: verification.pendingData.businessName };
        } else {
          updatePayload["businessDetails.businessName"] = verification.pendingData.businessName;
        }
        
        if (!user.sellerProfile) {
          updatePayload.sellerProfile = { shopName: verification.pendingData.businessName };
        } else {
          updatePayload["sellerProfile.shopName"] = verification.pendingData.businessName;
        }
      } else if (!isSeller) {
        updatePayload.firstName = verification.pendingData.firstName;
        updatePayload.lastName = verification.pendingData.lastName;
      }

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
    const verification = await ProfileUpdateVerification.findById(
      verificationId
    );

    if (!verification) return next(new AppError("Verification not found", 404));

    if (
      !verification.phoneOtp ||
      verification.phoneOtp !== phoneOtp ||
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
    };

    // Add role-specific fields
    if (isSeller && verification.pendingData.businessName) {
      // Ensure nested objects exist
      if (!user.businessDetails) {
        updatePayload.businessDetails = { businessName: verification.pendingData.businessName };
      } else {
        updatePayload["businessDetails.businessName"] = verification.pendingData.businessName;
      }
      
      if (!user.sellerProfile) {
        updatePayload.sellerProfile = { shopName: verification.pendingData.businessName };
      } else {
        updatePayload["sellerProfile.shopName"] = verification.pendingData.businessName;
      }
    } else if (!isSeller) {
      updatePayload.firstName = verification.pendingData.firstName;
      updatePayload.lastName = verification.pendingData.lastName;
    }

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

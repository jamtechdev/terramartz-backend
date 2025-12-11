import mongoose from "mongoose";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { promisify } from "util";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { nanoid } from "nanoid";

import catchAsync from "../utils/catchasync.js";
import AppError from "../utils/apperror.js";
import Email from "../utils/vefiryEmail.js";
import { processImage } from "../utils/multerConfig.js";
import { sendPhoneNumberVerificationOtpDirect } from "./userController.js"; // ensure helper exists

import { User } from "../models/users.js";
import { Farm } from "../models/seller/farm.js";

const signToken = ({ _id, role, name, email }) => {
  return jwt.sign({ id: _id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user);
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
  };
  if (process.env.NODE_ENV === "production") cookieOptions.secure = true;
  res.cookie("jwt", token, cookieOptions);
  user.password = undefined;
  res.status(statusCode).json({
    status: "success",
    token,
    data: {
      user,
    },
  });
};
export const signup = catchAsync(async (req, res, next) => {
  // 🔹 Start a MongoDB session
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1️⃣ Check if user already exists
    const user_info = await User.findOne({ email: req.body.email }).session(
      session
    );
    if (user_info) {
      throw new AppError("Email already exists.", 400);
    }
    // 2️⃣ Business Name check (for seller & business account)
    if (req.body.role === "seller" && req.body.accountType === "business") {
      const businessExists = await User.findOne({
        "businessDetails.businessName": req.body.businessDetails.businessName,
      }).session(session);
      if (businessExists) {
        throw new AppError(
          "Business name already exists. Please choose a different one.",
          400
        );
      }
    }

    // 2️⃣ File processing (optional)
    const profilePicture = req?.files?.profilePicture?.[0] || null;
    const shopPicture = req?.files?.shopPicture?.[0] || null;

    let profilePicturePath = null;
    if (profilePicture) {
      profilePicturePath = `profile-${Date.now()}-${crypto
        .randomBytes(8)
        .toString("hex")}.jpeg`;
      const outputFilePath = `public/profilePicture/${profilePicturePath}`;
      await processImage(profilePicture.buffer, outputFilePath);
    }

    let shopPicturePath = null;
    if (shopPicture) {
      shopPicturePath = `shop-${Date.now()}-${crypto
        .randomBytes(8)
        .toString("hex")}.jpeg`;
      const outputFilePath = `public/shopPicture/${shopPicturePath}`;
      await processImage(shopPicture.buffer, outputFilePath);
    }

    const reqBody = {
      ...req.body,
      profilePicture: profilePicturePath,
      // Skip verification - set account as verified by default
      isAccountVerified: true,
    };

    // যদি seller & business account হয়
    if (req.body.role === "seller" && req.body.accountType === "business") {
      const shopId = `shop-${nanoid(16)}`;
      reqBody.sellerProfile = {
        ...req.body.sellerProfile,
        shopId,
        shopPicture: shopPicturePath,
      };
    }

    // 4️⃣ Create the User
    const newUser = await User.create([reqBody], { session });
    const user = newUser[0]; // because create returns an array when using session

    // 5️⃣ If seller, create farm
    if (user.role === "seller" && user.accountType === "business") {
      // Get coordinates from request body, default to [0, 0] if not provided
      let coordinates = [0, 0];
      if (req.body.location && req.body.location.coordinates) {
        coordinates = req.body.location.coordinates;
      } else if (req.body.longitude !== undefined && req.body.latitude !== undefined) {
        // Alternative: accept longitude and latitude as separate fields
        coordinates = [parseFloat(req.body.longitude), parseFloat(req.body.latitude)];
      }

      await Farm.create(
        [
          {
            owner: user._id,
            description: `${user.businessDetails?.businessName || ""}`,
            location: {
              type: "Point",
              coordinates: coordinates, // [longitude, latitude]
            },
            farm_status: "pending",
            product_categories: [],
            certifications: [],
            products: [],
          },
        ],
        { session }
      );
    }

    // ✅ 6️⃣ Commit transaction
    await session.commitTransaction();
    session.endSession();

    // 7️⃣ Send response
    return createSendToken(user, 201, res);
  } catch (err) {
    // ❌ Rollback
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
});

//protect function implementation
export const protect = catchAsync(async (req, res, next) => {
  // Accept token from Authorization header OR cookies ("token" or "jwt")
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies && (req.cookies.token || req.cookies.jwt)) {
    token = req.cookies.token || req.cookies.jwt;
  }

  if (!token) {
    return next(
      new AppError("you are not looged in! please login to get access.", 401)
    );
  }
  //2) Verification token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  //3) Check if user still exists
  const freshUser = await User.findById(decoded.id);
  if (!freshUser) {
    return next(
      new AppError(
        "The user belogging to this token does no longer exist.",
        401
      )
    );
  }
  //Checkif user changed password after the token was issued
  if (freshUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError("User recently changed password Please log in again", 401)
    );
  }
  req.user = freshUser;
  res.locals.user = freshUser;
  return next();
});

// Optional protect - doesn't throw error if no token, but sets req.user if token is valid
export const optionalProtect = catchAsync(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    // No token - allow request to proceed without req.user
    return next();
  }

  try {
    //2) Verification token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    //3) Check if user still exists
    const freshUser = await User.findById(decoded.id);
    if (!freshUser) {
      // User doesn't exist - allow request to proceed without req.user
      return next();
    }
    
    //Check if user changed password after the token was issued
    if (freshUser.changedPasswordAfter(decoded.iat)) {
      // Token invalid - allow request to proceed without req.user
      return next();
    }
    
    req.user = freshUser;
    res.locals.user = freshUser;
  } catch (err) {
    // Token invalid - allow request to proceed without req.user
    // Don't throw error, just continue
  }
  
  return next();
});

export const forgotPassword = catchAsync(async (req, res, next) => {
  //1) Get user based on Posted Email
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    return next(new AppError("There is no user with email address", 404));
  }
  // if account is linked with Google
  if (user?.socialLogin?.googleId && user?.provider === "google") {
    return next(
      new AppError(
        "Your account is linked with Google. Please use Google to log in.",
        403
      )
    );
  }
  // if account is linked with Facebook
  if (user?.socialLogin?.facebookId && user?.provider === "facebook") {
    return next(
      new AppError(
        "Your account is linked with Facebook. Please use Facebook to log in.",
        403
      )
    );
  }

  //2)Generat the random reset token
  const resetToken = user.creatPasswordResetToken();

  await user.save({ validateBeforeSave: false });

  //3) Send it to user's email

  try {
    const resetURL = `${req.protocol}://${req.get(
      "host"
    )}/api/users/resetPassword/${resetToken}`;
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    await new Email(user, resetURL, baseUrl).sendPasswordReset();

    res.status(200).json({
      status: "Success",
      message: "Token sent to email",
      resetURL: resetURL,
    });
  } catch (err) {
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError("There was an error sending the email. Try again later", 500)
    );
  }
});

export const resetPassword = catchAsync(async (req, res, next) => {
  //Get user based on the token

  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  //if token has not expired, and there is user, set the new password
  if (!user) {
    return next(new AppError("Token is invalid or has expired", 400));
  }

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = null;
  user.passwordResetExpires = null;
  await user.save();

  //4)Log the user in,send jwt
  // createSendToken(user, 200, res);

  res.status(200).json({
    message: "Password Reset Successful",
    status: "Success",
  });
});

export const updatePassword = catchAsync(async (req, res, next) => {
  // 1️⃣ Logged in user
  const userId = req.user._id;

  // 2️⃣ Get current, new, confirm password from request
  const { currentPassword, newPassword, passwordConfirm } = req.body;

  if (!currentPassword || !newPassword || !passwordConfirm) {
    return next(new AppError("Please provide all required fields", 400));
  }

  // 3️⃣ Find user and select password
  const user = await User.findById(userId).select("+password");

  // 4️⃣ Check if current password is correct
  const isMatch = await user.correctPassword(currentPassword, user.password);
  if (!isMatch) {
    return next(new AppError("Your current password is incorrect", 401));
  }

  // 5️⃣ Check if newPassword matches confirm
  if (newPassword !== passwordConfirm) {
    return next(
      new AppError("New password and confirm password do not match", 400)
    );
  }

  // 6️⃣ Update password
  user.password = newPassword;
  user.passwordConfirm = passwordConfirm;

  // 7️⃣ Save user (triggers pre save hook to hash password)
  await user.save({ validateBeforeSave: false });

  // 8️⃣ Send new token (optional)
  createSendToken(user, 200, res);
});

// Two-Factor Authentication code start

// ================= LOGIN =================
export const login = catchAsync(async (req, res, next) => {
  const { email, password, googleId, facebookId, appleId, provider } = req.body;

  // ---------------- Social Login ----------------
  // Google
  if (googleId && provider === "google") {
    let user = await User.findOne({ "socialLogin.googleId": googleId });
    if (!user) return next(new AppError("Google user not found", 404));

    return createSendToken(user, 200, res);
  }

  // Facebook
  if (facebookId && provider === "facebook") {
    let user = await User.findOne({ "socialLogin.facebookId": facebookId });
    if (!user) return next(new AppError("Facebook user not found", 404));

    return createSendToken(user, 200, res);
  }

  // Apple
  if (appleId && provider === "apple") {
    let user = await User.findOne({ "socialLogin.appleId": appleId });
    if (!user) return next(new AppError("Apple user not found", 404));
    return createSendToken(user, 200, res);
  }

  // ---------------- Email & Password ----------------
  if (email && password) {
    let user = await User.findOne({ email }).select(
      "+password +twoFactorEnabled +twoFactorMethod +twoFactorSecret"
    );
    if (!user) return next(new AppError("User not found", 404));

    const isMatch = await user.correctPassword(password, user.password);
    if (!isMatch) return next(new AppError("Invalid email or password", 401));

    // ---------------- 2FA Check ----------------
    if (user.twoFactorEnabled) {
      const tempToken = crypto.randomInt(100000, 999999).toString(); // 6-digit OTP
      const expires = Date.now() + 5 * 60 * 1000; // 5 min valid

      user.twoFactorTempToken = tempToken;
      user.twoFactorTempExpires = expires;
      await user.save({ validateBeforeSave: false });

      // Send 2FA code depending on method
      if (user.twoFactorMethod === "email") {
        await new Email({
          email: user.email,
          emailOtp: tempToken,
        }).sendEmailVerificationOtpFn();
      } else if (user.twoFactorMethod === "phone") {
        await sendPhoneNumberVerificationOtpDirect(user.phoneNumber, tempToken);
      }
      // authenticator app -> user uses app to generate code, no send

      return res.status(200).json({
        status: "2fa_required",
        message: "Enter your 2FA code",
        userId: user._id,
      });
    }

    // ---------------- No 2FA ----------------
    return createSendToken(user, 200, res);
  }

  // ---------------- No credentials ----------------

  return next(new AppError("Please provide valid credentials", 400));
});

// ================= VERIFY 2FA =================
export const verifyTwoFactor = catchAsync(async (req, res, next) => {
  const { userId, token } = req.body;
  const user = await User.findById(userId).select(
    "+twoFactorEnabled +twoFactorMethod +twoFactorSecret +twoFactorTempToken +twoFactorTempExpires"
  );
  if (!user) return next(new AppError("User not found", 404));

  if (!user.twoFactorEnabled)
    return next(new AppError("2FA not enabled for this user", 400));

  if (user.twoFactorMethod === "authenticator") {
    // Convert token to string if it's a number
    const tokenString = String(token).trim();
    
    // Verify with window to handle clock skew (accept codes from previous/next time step)
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: tokenString,
      window: 2, // Accept codes from 2 time steps before and after (60 seconds total window)
    });
    
    if (!verified) {
      return next(new AppError("Invalid 2FA code. Please make sure your device time is synchronized.", 401));
    }
  } else {
    if (
      !user.twoFactorTempToken ||
      user.twoFactorTempToken !== token ||
      user.twoFactorTempExpires < Date.now()
    ) {
      return next(new AppError("Invalid or expired 2FA token", 401));
    }
  }

  // Clear temp token
  user.twoFactorTempToken = null;
  user.twoFactorTempExpires = null;
  await user.save({ validateBeforeSave: false });

  // Normal login
  createSendToken(user, 200, res);
});

// ========== Enable Two Factor ================
export const enableTwoFactor = catchAsync(async (req, res, next) => {
  const { method } = req.body;
  const user = await User.findById(req.user._id);

  if (!["email", "phone", "authenticator"].includes(method)) {
    return next(new AppError("Invalid 2FA method", 400));
  }

  user.twoFactorMethod = method;

  if (method === "authenticator") {
    const secret = speakeasy.generateSecret({
      name: `MyApp (${user.email})`,
    });

    user.twoFactorSecret = secret.base32;

    // 🔥 QR Code er otpauth URL create
    const otpauthUrl = secret.otpauth_url;

    // 🔥 QR Code generate
    const qrCodeImageUrl = await qrcode.toDataURL(otpauthUrl);

    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      status: "success",
      message: "Scan the QR code with Google Authenticator",
      secret: user.twoFactorSecret,
      qrCode: qrCodeImageUrl, // 🔥 Postman e dekha jabe
      userId: user._id,
    });
  }

  // if email/phone method (same as before)
  const tempToken = crypto.randomInt(100000, 999999).toString();
  const expires = Date.now() + 5 * 60 * 1000;

  user.twoFactorTempToken = tempToken;
  user.twoFactorTempExpires = expires;

  if (method === "email") {
    await new Email({
      email: user.email,
      emailOtp: tempToken,
    }).sendEmailVerificationOtpFn();
  } else if (method === "phone") {
    await sendPhoneNumberVerificationOtpDirect(user.phoneNumber, tempToken);
  }

  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: "success",
    message: "OTP sent to confirm 2FA setup",
    userId: user._id,
  });
});

export const confirmTwoFactorSetup = catchAsync(async (req, res, next) => {
  const { token } = req.body; // userId আর লাগবে না
  const user = await User.findById(req.user._id).select(
    "+twoFactorMethod +twoFactorSecret +twoFactorTempToken +twoFactorTempExpires +twoFactorEnabled"
  );

  if (!user) return next(new AppError("User not found", 404));

  if (user.twoFactorMethod === "authenticator") {
    // Check if secret exists
    if (!user.twoFactorSecret) {
      return next(new AppError("2FA secret not found. Please enable 2FA again.", 400));
    }
    
    // Convert token to string if it's a number
    const tokenString = String(token).trim();
    
    // Validate token format (should be 6 digits)
    if (!/^\d{6}$/.test(tokenString)) {
      return next(new AppError("Invalid code format. Please enter a 6-digit code.", 400));
    }
    
    // Verify with window to handle clock skew (accept codes from previous/next time step)
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: tokenString,
      window: 2, // Accept codes from 2 time steps before and after (60 seconds total window)
    });
    
    if (!verified) {
      console.error("2FA verification failed:", {
        hasSecret: !!user.twoFactorSecret,
        secretLength: user.twoFactorSecret?.length,
        token: tokenString,
        method: user.twoFactorMethod,
      });
      return next(new AppError("Invalid authenticator code. Please make sure your device time is synchronized and try again.", 401));
    }
  } else {
    if (
      !user.twoFactorTempToken ||
      user.twoFactorTempToken !== token ||
      user.twoFactorTempExpires < Date.now()
    ) {
      return next(new AppError("Invalid or expired OTP", 401));
    }
  }

  // Mark 2FA as permanently enabled
  user.twoFactorEnabled = true;
  user.twoFactorTempToken = null;
  user.twoFactorTempExpires = null;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: "success",
    message: "Two-Factor Authentication successfully enabled",
  });
});

// Disable 2FA
export const disableTwoFactor = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  user.twoFactorEnabled = false;
  user.twoFactorMethod = null;
  user.twoFactorSecret = null;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    status: "success",
    message: "2FA disabled",
  });
});

// Two-Factor Authentication code end

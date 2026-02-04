import slugify from "slugify";
import { Category } from "../../models/super-admin/category.js";
import { Product } from "../../models/seller/product.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { User } from "../../models/users.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { Purchase } from "../../models/customers/purchase.js";

export const getAllUsers = catchAsync(async (req, res) => {
  const { search, status, role, page = 1, limit = 10 } = req.query;

  const pageNum = Number(page);
  const limitNum = Number(limit);
  const skip = (pageNum - 1) * limitNum;

  // ======================
  // BASE MATCH
  // ======================
  const match = {};

  // ======================
  // ROLE FILTER (user / seller)
  // ======================
  if (role) {
    match.role = role;
  } else {
    match.role = { $in: ["user", "seller"] };
  }

  // ======================
  // STATUS FILTER
  // ======================
  if (status) {
    match.status = status;
  }

  // ======================
  // MULTI-WORD SEARCH
  // ======================
  if (search) {
    const words = search.trim().split(/\s+/);

    match.$and = words.map((word) => {
      const regex = new RegExp(word, "i");
      return {
        $or: [
          { firstName: regex },
          { middleName: regex },
          { lastName: regex },
          { email: regex },
          { "sellerProfile.shopName": regex },
          { "businessDetails.businessName": regex },
        ],
      };
    });
  }

  // ======================
  // MAIN QUERY
  // ======================
  const users = await User.find(match)
    .select(
      `
      firstName
      middleName
      lastName
      email
      phoneNumber
      status
      role
      createdAt
      sellerProfile
      businessDetails
      isActive
      isAccountVerified
      `,
    )
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  // ======================
  // COUNT FOR PAGINATION
  // ======================
  const total = await User.countDocuments(match);

  // ======================
  // RESPONSE (❗ UNCHANGED)
  // ======================
  res.status(200).json({
    status: "success",
    page: pageNum,
    limit: limitNum,
    total,
    results: users.length,
    users: users.map((u) => {
      const fullName = [u.firstName, u.middleName, u.lastName]
        .filter(Boolean)
        .join(" ");

      return {
        _id: u._id,
        name:
          fullName ||
          u.sellerProfile?.shopName ||
          u.businessDetails?.businessName ||
          u.email,
        email: u.email,
        phoneNumber: u.phoneNumber,
        status: u.status,
        role: u.role,
        date: u.createdAt,
        isActive: u.isActive,
        sellerProfile: u.sellerProfile,
        businessDetails: u.businessDetails,
        isVerified: u.isAccountVerified,
      };
    }),
  });
});

// 🔹 1. Get all buyers (default pagination)
// curl -X GET "http://localhost:7345/api/admin/users" \
//   -H "Content-Type: application/json"

// 🔹 2. Pagination (page & limit)
// curl -X GET "http://localhost:7345/api/admin/users?page=1&limit=10" \
//   -H "Content-Type: application/json"

// 🔹 3. Search buyers (single word)
// curl -X GET "http://localhost:7345/api/admin/users?search=Blake" \
//   -H "Content-Type: application/json"

//   🔹 4. Search buyers (multi-word name)
//   curl -X GET "http://localhost:7345/api/admin/users?search=Blake+Bin" \
//   -H "Content-Type: application/json"

// ==========================
// GET SINGLE USER BY ID
// ==========================
export const getUserById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const user = await User.findById(id)
    .select(
      `
      firstName
      middleName
      lastName
      email
      phoneNumber
      status
      role
      accountType
      profilePicture
      createdAt
      updatedAt
      isAccountVerified
      isActive
      sellerProfile
      businessDetails
      socialLogin
      provider
      termsAccepted
      receiveMarketingEmails
      bio
      emailNotifications
      pushNotifications
      marketingEmails
      notificationFrequency
      language
      currency
      defaultAddress
      twoFactorEnabled
      twoFactorMethod
      `,
    )
    .lean();

  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // Format the response
  const fullName = [user.firstName, user.middleName, user.lastName]
    .filter(Boolean)
    .join(" ");

  res.status(200).json({
    status: "success",
    data: {
      _id: user._id,
      name: fullName || user.email,
      email: user.email,
      phoneNumber: user.phoneNumber,
      status: user.status,
      role: user.role,
      accountType: user.accountType,
      profilePicture: user.profilePicture,
      isAccountVerified: user.isAccountVerified,
      isActive: user.isActive,
      sellerProfile: user.sellerProfile,
      businessDetails: user.businessDetails,
      socialLogin: user.socialLogin,
      provider: user.provider,
      termsAccepted: user.termsAccepted,
      receiveMarketingEmails: user.receiveMarketingEmails,
      bio: user.bio,
      emailNotifications: user.emailNotifications,
      pushNotifications: user.pushNotifications,
      marketingEmails: user.marketingEmails,
      notificationFrequency: user.notificationFrequency,
      language: user.language,
      currency: user.currency,
      defaultAddress: user.defaultAddress,
      twoFactorEnabled: user.twoFactorEnabled,
      twoFactorMethod: user.twoFactorMethod,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

// ==========================
// UPDATE USER STATUS
// ==========================
export const updateUserStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  // Validate status
  const validStatuses = ["online", "offline"];
  if (!validStatuses.includes(status)) {
    return next(
      new AppError(
        `Invalid status. Valid statuses are: ${validStatuses.join(", ")}`,
        400,
      ),
    );
  }

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError("User not found", 404));
  }

  const updatedUser = await User.findByIdAndUpdate(
    id,
    { status },
    { new: true, runValidators: true },
  ).select(
    "firstName middleName lastName email phoneNumber status role createdAt updatedAt",
  );

  const fullName = [
    updatedUser.firstName,
    updatedUser.middleName,
    updatedUser.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  res.status(200).json({
    status: "success",
    data: {
      _id: updatedUser._id,
      name: fullName || updatedUser.email,
      email: updatedUser.email,
      phoneNumber: updatedUser.phoneNumber,
      status: updatedUser.status,
      role: updatedUser.role,
      updatedAt: updatedUser.updatedAt,
    },
  });
});

// ==========================
// UPDATE USER ROLE
// ==========================
export const updateUserRole = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { role } = req.body;

  // Validate role
  const validRoles = ["user", "seller"];
  if (!validRoles.includes(role)) {
    return next(
      new AppError(
        `Invalid role. Valid roles are: ${validRoles.join(", ")}`,
        400,
      ),
    );
  }

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // If changing to seller, ensure account type is business
  // if (role === "seller" && user.accountType !== "business") {
  //   return next(
  //     new AppError(
  //       "User must have a business account type to become a seller",
  //       400
  //     )
  //   );
  // }

  const updatedUser = await User.findByIdAndUpdate(
    id,
    { role },
    { new: true, runValidators: true },
  ).select(
    "firstName middleName lastName email phoneNumber status role accountType createdAt updatedAt",
  );

  const fullName = [
    updatedUser.firstName,
    updatedUser.middleName,
    updatedUser.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  res.status(200).json({
    status: "success",
    data: {
      _id: user._id,
      name: fullName || user.email,
      email: user.email,
      phoneNumber: user.phoneNumber,
      status: user.status,
      role: user.role,
      accountType: user.accountType,
      profilePicture: user.profilePicture,
      isAccountVerified: user.isAccountVerified,
      isActive: user.isActive,
      sellerProfile: user.sellerProfile,
      businessDetails: user.businessDetails,
      socialLogin: user.socialLogin,
      provider: user.provider,
      termsAccepted: user.termsAccepted,
      receiveMarketingEmails: user.receiveMarketingEmails,
      bio: user.bio,
      emailNotifications: user.emailNotifications,
      pushNotifications: user.pushNotifications,
      marketingEmails: user.marketingEmails,
      notificationFrequency: user.notificationFrequency,
      language: user.language,
      currency: user.currency,
      defaultAddress: user.defaultAddress,
      twoFactorEnabled: user.twoFactorEnabled,
      twoFactorMethod: user.twoFactorMethod,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

// ==========================
// UPDATE USER DETAILS
// ==========================
export const updateUserDetails = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const updateData = req.body;

  // Fields that can be updated
  const allowedFields = [
    "firstName",
    "middleName",
    "lastName",
    "phoneNumber",
    "bio",
    "emailNotifications",
    "pushNotifications",
    "marketingEmails",
    "notificationFrequency",
    "language",
    "currency",
    "defaultAddress",
  ];

  // Filter out non-allowed fields
  const filteredData = {};
  Object.keys(updateData).forEach((key) => {
    if (allowedFields.includes(key)) {
      filteredData[key] = updateData[key];
    }
  });

  if (Object.keys(filteredData).length === 0) {
    return next(
      new AppError(
        "No valid fields to update. Allowed fields: " +
          allowedFields.join(", "),
        400,
      ),
    );
  }

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError("User not found", 404));
  }

  const updatedUser = await User.findByIdAndUpdate(id, filteredData, {
    new: true,
    runValidators: true,
  }).select(
    "firstName middleName lastName email phoneNumber status role bio emailNotifications pushNotifications marketingEmails notificationFrequency language currency defaultAddress createdAt updatedAt",
  );

  const fullName = [
    updatedUser.firstName,
    updatedUser.middleName,
    updatedUser.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  res.status(200).json({
    status: "success",
    data: {
      _id: updatedUser._id,
      name: fullName || updatedUser.email,
      email: updatedUser.email,
      phoneNumber: updatedUser.phoneNumber,
      status: updatedUser.status,
      role: updatedUser.role,
      bio: updatedUser.bio,
      emailNotifications: updatedUser.emailNotifications,
      pushNotifications: updatedUser.pushNotifications,
      marketingEmails: updatedUser.marketingEmails,
      notificationFrequency: updatedUser.notificationFrequency,
      language: updatedUser.language,
      currency: updatedUser.currency,
      defaultAddress: updatedUser.defaultAddress,
      updatedAt: updatedUser.updatedAt,
    },
  });
});

// ==========================
// DELETE USER (SOFT DELETE)
// ==========================
export const deleteUser = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    return next(new AppError("User not found", 404));
  }

  // Soft delete by setting status to 'offline' and marking as deleted
  await User.findByIdAndUpdate(id, {
    status: "offline",
    email: `deleted_${Date.now()}_${user.email}`,
    phoneNumber: null,
  });

  res.status(200).json({
    status: "success",
    message: "User deleted successfully",
  });
});

// ==========================
// TOGGLE USER IS_ACTIVE
// ==========================

export const toggleIsActive = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const user = await User.findById(id);
  if (!user) {
    return next(new AppError("User not found", 404));
  }
  const updatedUser = await User.findByIdAndUpdate(id, {
    isActive: !user.isActive,
  });

  user.password = undefined;

  res.status(200).json({
    status: "success",
    data: {
      user,
    },
  });
});

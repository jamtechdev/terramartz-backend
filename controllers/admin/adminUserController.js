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
      sellerProfile.shopName
      businessDetails.businessName
      `
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

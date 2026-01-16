import slugify from "slugify";
import { Category } from "../../models/super-admin/category.js";
import { Product } from "../../models/seller/product.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { User } from "../../models/users.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { Purchase } from "../../models/customers/purchase.js";

// export const getAllTransactions = catchAsync(async (req, res) => {
//   const { search, status, paymentStatus, page = 1, limit = 10 } = req.query;

//   const filter = {};

//   // Status filter
//   if (status) filter.status = status;

//   // Payment status filter
//   if (paymentStatus) filter.paymentStatus = paymentStatus;

//   // Pagination
//   const pageNum = Number(page);
//   const limitNum = Number(limit);
//   const skip = (pageNum - 1) * limitNum;

//   // Fetch all transactions with buyer populated
//   let transactions = await Purchase.find(filter)
//     .populate("buyer", "firstName middleName lastName email")
//     .lean();

//   // Apply search filter if provided
//   if (search) {
//     const regex = new RegExp(search.trim(), "i"); // case-insensitive
//     transactions = transactions.filter((tx) => {
//       const buyerName = [
//         tx.buyer?.firstName,
//         tx.buyer?.middleName,
//         tx.buyer?.lastName,
//       ]
//         .filter(Boolean)
//         .join(" ");
//       const buyerEmail = tx.buyer?.email || "";
//       return regex.test(buyerName) || regex.test(buyerEmail);
//     });
//   }

//   const total = transactions.length;

//   // Pagination
//   const paginatedTransactions = transactions.slice(skip, skip + limitNum);

//   // Map transactions for response
//   const mappedTransactions = paginatedTransactions.map((tx) => ({
//     _id: tx._id,
//     orderId: tx.orderId,
//     buyerName: tx.buyer
//       ? [tx.buyer.firstName, tx.buyer.middleName, tx.buyer.lastName]
//           .filter(Boolean)
//           .join(" ")
//       : null,
//     buyerEmail: tx.buyer?.email || null,
//     amount: tx.totalAmount,
//     status: tx.status,
//     paymentStatus: tx.paymentStatus,
//     trackingNumber: tx.trackingNumber,
//     date: tx.createdAt,
//   }));

//   res.status(200).json({
//     status: "success",
//     page: pageNum,
//     limit: limitNum,
//     total,
//     results: mappedTransactions.length,
//     transactions: mappedTransactions,
//   });
// });
export const getAllTransactions = catchAsync(async (req, res) => {
  const { search, status, paymentStatus, page = 1, limit = 10 } = req.query;

  const pageNum = Number(page);
  const limitNum = Number(limit);
  const skip = (pageNum - 1) * limitNum;

  const match = {};

  // ======================
  // STATUS FILTERS
  // ======================
  if (status) match.status = status;
  if (paymentStatus) match.paymentStatus = paymentStatus;

  // ======================
  // SEARCH FILTER (MULTI-WORD)
  // ======================
  if (search) {
    const words = search.trim().split(/\s+/);

    match.$and = words.map((word) => {
      const regex = new RegExp(word, "i");
      return {
        $or: [
          { "buyer.firstName": regex },
          { "buyer.middleName": regex },
          { "buyer.lastName": regex },
          { "buyer.email": regex },
        ],
      };
    });
  }

  // ======================
  // MAIN PIPELINE
  // ======================
  const pipeline = [
    {
      $lookup: {
        from: "users",
        localField: "buyer",
        foreignField: "_id",
        as: "buyer",
      },
    },
    { $unwind: "$buyer" },
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limitNum },
    {
      $project: {
        _id: 1,
        orderId: 1,
        buyerName: {
          $trim: {
            input: {
              $concat: [
                "$buyer.firstName",
                " ",
                { $ifNull: ["$buyer.middleName", ""] },
                " ",
                "$buyer.lastName",
              ],
            },
          },
        },
        buyerEmail: "$buyer.email",
        amount: "$totalAmount",
        status: 1,
        paymentStatus: 1,
        trackingNumber: 1,
        date: "$createdAt",
      },
    },
  ];

  const transactions = await Purchase.aggregate(pipeline);

  // ======================
  // COUNT PIPELINE
  // ======================
  const countPipeline = [
    {
      $lookup: {
        from: "users",
        localField: "buyer",
        foreignField: "_id",
        as: "buyer",
      },
    },
    { $unwind: "$buyer" },
    { $match: match },
    { $count: "total" },
  ];

  const totalResult = await Purchase.aggregate(countPipeline);
  const total = totalResult[0]?.total || 0;

  // ======================
  // RESPONSE
  // ======================
  res.status(200).json({
    status: "success",
    page: pageNum,
    limit: limitNum,
    total,
    results: transactions.length,
    transactions,
  });
});


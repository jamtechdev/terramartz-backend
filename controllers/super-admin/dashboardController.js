import catchAsync from "../../utils/catchasync.js";
import { Purchase } from "../../models/customers/purchase.js";
import { Product } from "../../models/seller/product.js";
import { User } from "../../models/users.js";
import { ContactInquiry } from "../../models/common/contactInquiry.js";

export const sectionOne = catchAsync(async (req, res, next) => {
  const totalOrder = await Purchase.countDocuments();

  const revenue = await Purchase.aggregate([
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$totalAmount" },
      },
    },
  ]);

  const activeUsers = await User.countDocuments({
    isAccountVerified: true,
    // isActive: true,
  });

  const productInStock = await Product.countDocuments();

  res.status(200).json({
    totalOrder,
    revenue: revenue[0].totalRevenue,
    activeUsers,
    productInStock,
  });
});

export const sectionTwo = catchAsync(async (req, res, next) => {
  const recentPurchases = await Purchase.find()
    .sort({ createdAt: -1 })
    .limit(10);

  const currentYear = new Date().getFullYear();

  const monthlyRevenue = await Purchase.aggregate([
    {
      $match: {
        createdAt: {
          $gte: new Date(`${currentYear}-01-01`),
          $lte: new Date(`${currentYear}-12-31`),
        },
        paymentStatus: "paid", // Only count paid orders
      },
    },
    {
      $group: {
        _id: { $month: "$createdAt" },
        revenue: { $sum: "$totalAmount" },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $project: {
        _id: 0,
        month: {
          $arrayElemAt: [
            [
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ],
            { $subtract: ["$_id", 1] },
          ],
        },
        revenue: 1,
      },
    },
  ]);

  const orderStats = await Purchase.aggregate([
    {
      $match: {
        createdAt: {
          $gte: new Date(`${currentYear}-01-01`),
          $lte: new Date(`${currentYear}-12-31`),
        },
      },
    },
    {
      $group: {
        _id: {
          month: { $month: "$createdAt" },
          status: "$status",
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: "$_id.month",
        statuses: {
          $push: {
            status: "$_id.status",
            count: "$count",
          },
        },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $project: {
        _id: 0,
        month: {
          $arrayElemAt: [
            [
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ],
            { $subtract: ["$_id", 1] },
          ],
        },
        statuses: 1,
      },
    },
  ]);

  res.status(200).json({
    recentPurchases,
    monthlyRevenue,
    orderStats: orderStats,
  });
});

export const sectionThree = catchAsync(async (req, res, next) => {
  const limit = 3;

  const topProducts = await Purchase.aggregate([
    {
      $match: {
        paymentStatus: "paid", // Only count paid orders
      },
    },
    { $unwind: "$products" }, // Unwind products array
    {
      $group: {
        _id: "$products.product",
        totalSold: { $sum: "$products.quantity" },
        totalRevenue: {
          $sum: { $multiply: ["$products.quantity", "$products.price"] },
        },
        avgPrice: { $avg: "$products.price" },
      },
    },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "productDetails",
      },
    },
    { $unwind: "$productDetails" },
    {
      $project: {
        _id: 0,
        productId: "$_id",
        productName: "$productDetails.title",
        sku: null,
        category: "$productDetails.category",
        stock: "$productDetails.stockQuantity",
        price: "$productDetails.price",
        status: "$productDetails.status",
        image: "$productDetails.productImages",
        totalSold: 1,
        totalRevenue: { $round: ["$totalRevenue", 2] },
      },
    },
    { $sort: { totalSold: -1 } },
    { $limit: limit },
  ]);

  const vendorsApproval = await User.aggregate([
    {
      $match: {
        role: "seller",
        accountType: "business",
        "sellerProfile.kycStatus": "submitted",
      },
    },
    {
      $project: {
        _id: 1,
        vendorName: {
          $cond: {
            if: { $ne: ["$businessDetails.businessName", null] },
            then: "$businessDetails.businessName",
            else: {
              $concat: [
                { $ifNull: ["$firstName", ""] },
                " ",
                { $ifNull: ["$lastName", ""] },
              ],
            },
          },
        },

        // License checkf
        hasLicense: {
          $cond: {
            if: {
              $and: [
                { $ne: ["$businessDetails.licenseNumber", null] },
                { $ne: ["$businessDetails.licenseNumber", ""] },
              ],
            },
            then: true,
            else: false,
          },
        },

        hasTaxId: {
          $cond: {
            if: {
              $and: [
                { $ne: ["$businessDetails.licenseNumber", null] },
                { $ne: ["$businessDetails.licenseNumber", ""] },
              ],
            },
            then: true,
            else: false,
          },
        },

        status: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$sellerProfile.kycStatus", "pending"] },
                then: "Pending",
              },
              {
                case: { $eq: ["$sellerProfile.kycStatus", "submitted"] },
                then: "Pending",
              },
              {
                case: { $eq: ["$sellerProfile.kycStatus", "under_review"] },
                then: "Pending",
              },
              {
                case: { $eq: ["$sellerProfile.kycStatus", "approved"] },
                then: "Approved",
              },
              {
                case: { $eq: ["$sellerProfile.kycStatus", "rejected"] },
                then: "Rejected",
              },
            ],
            default: "Pending",
          },
        },

        kycStatus: "$sellerProfile.kycStatus",
        kycId: "$sellerProfile.kycId",
        email: 1,
        phoneNumber: 1,
        businessDetails: 1,
        createdAt: 1,
      },
    },
    {
      $sort: { createdAt: -1 },
    },
    { $limit: limit },
  ]);

  res.status(200).json({
    topProducts,
    vendorsApproval,
  });
});

export const sectionFour = catchAsync(async (req, res, next) => {
  const supportTickets = await ContactInquiry.aggregate([
    {
      $match: {
        status: { $in: ["pending", "in_progress"] }, // Only open tickets
      },
    },
    {
      $group: {
        _id: "$inquiryType",
        openCount: { $sum: 1 },
        avgResponseTime: {
          $avg: {
            $cond: {
              if: { $ne: ["$respondedAt", null] },
              then: {
                $divide: [
                  { $subtract: ["$respondedAt", "$createdAt"] },
                  3600000,
                ],
              },
              else: null,
            },
          },
        },
        tickets: { $push: "$$ROOT" },
      },
    },
    {
      $project: {
        _id: 0,
        category: "$_id",
        open: "$openCount",
        avgResponse: {
          $cond: {
            if: { $ne: ["$avgResponseTime", null] },
            then: {
              $concat: [
                { $toString: { $round: ["$avgResponseTime", 1] } },
                " hr",
              ],
            },
            else: "N/A",
          },
        },
        avgResponseHours: { $round: ["$avgResponseTime", 1] },
        priority: {
          $switch: {
            branches: [
              { case: { $eq: ["$_id", "Order Support"] }, then: "High" },
              { case: { $eq: ["$_id", "Payment Issue"] }, then: "Medium" },
              { case: { $eq: ["$_id", "Complaint"] }, then: "High" },
              { case: { $eq: ["$_id", "Product Question"] }, then: "Medium" },
              { case: { $eq: ["$_id", "Partnership"] }, then: "Low" },
              { case: { $eq: ["$_id", "General Inquiry"] }, then: "Low" },
            ],
            default: "Low",
          },
        },
        tickets: {
          $map: {
            input: "$tickets",
            as: "ticket",
            in: {
              contactId: "$$ticket._id",
              // Add other fields you want to include from each ticket
              status: "$$ticket.status",
              createdAt: "$$ticket.createdAt",
              respondedAt: "$$ticket.respondedAt",
            },
          },
        },
      },
    },
    {
      $sort: {
        priority: 1,
        open: -1,
      },
    },
  ]);

  res.status(200).json({
    supportTickets,
  });
});

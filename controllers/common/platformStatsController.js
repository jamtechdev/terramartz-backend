import { User } from "../../models/users.js";
import { Purchase } from "../../models/customers/purchase.js";
import { Review } from "../../models/common/review.js";
import catchAsync from "../../utils/catchAsync.js";

// Public stats for Seller Portal / marketing pages
export const getSellerPortalStats = catchAsync(async (req, res, next) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Run aggregates in parallel for performance
  const [activeFarmers, monthlyOrders, ratingAgg] = await Promise.all([
    User.countDocuments({ role: "seller" }),
    Purchase.countDocuments({
      createdAt: { $gte: startOfMonth, $lte: now },
    }),
    Review.aggregate([
      { $match: { rating: { $gte: 1 } } },
      { $group: { _id: null, avgRating: { $avg: "$rating" } } },
    ]),
  ]);

  const avgRating = ratingAgg[0]?.avgRating || 0;

  res.status(200).json({
    status: "success",
    stats: {
      activeFarmers: activeFarmers || 0,
      monthlyOrders: monthlyOrders || 0,
      averageRating: Number(avgRating.toFixed(1)),
      payoutTimeHours: 24, // keep as config value for now
    },
  });
});



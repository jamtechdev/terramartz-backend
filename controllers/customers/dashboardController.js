import { Purchase } from "../../models/customers/purchase.js";
import { WishlistProduct } from "../../models/customers/wishlistProduct.js";
import { Review } from "../../models/common/review.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { LoyaltyPoint } from "../../models/customers/loyaltyPoints.js";

function purchaseBuyerMatch(req) {
  const userId = req.user._id || req.user.id;
  const userIdString = String(userId);
  const userIdAlt1 = req.user._id ? String(req.user._id) : null;
  const userIdAlt2 = req.user.id ? String(req.user.id) : null;
  return {
    $or: [
      { buyer: userIdString },
      ...(userIdAlt1 ? [{ buyer: userIdAlt1 }] : []),
      ...(userIdAlt2 ? [{ buyer: userIdAlt2 }] : []),
    ].filter(Boolean),
  };
}

/** String ids for models that store `user` like Purchase stores `buyer` */
function userIdVariants(req) {
  return [
    ...new Set(
      [req.user._id, req.user.id].filter(Boolean).map((x) => String(x)),
    ),
  ];
}

// 🔹 Recent Activity (Top 3 items)
export const getRecentActivity = catchAsync(async (req, res, next) => {
  // 🔹 Fetch last orders (all statuses, not just delivered)
  const recentOrders = await Purchase.find(purchaseBuyerMatch(req))
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  // 🔹 Fetch last 5 wishlist actions
  const recentWishlist = await WishlistProduct.find({
    user: { $in: userIdVariants(req) },
  })
    .sort({ createdAt: -1 })
    .populate("product", "title slug _id")
    .limit(5)
    .lean();

  // 🔹 Fetch last 5 reviews
  const recentReviews = await Review.find({ user: { $in: userIdVariants(req) } })
    .sort({ createdAt: -1 })
    .populate("product", "title slug _id")
    .limit(5)
    .lean();

  // 🔹 Build type-wise latest activity map
  const activityMap = new Map();

  // Order Delivered
  recentOrders.forEach((order) => {
    if (!activityMap.has("Order Delivered")) {
      activityMap.set("Order Delivered", {
        type: "Order Delivered",
        orderId: order.orderId,
        orderIdDb: order._id,
        createdAt: order.createdAt,
      });
    }
  });

  // Added to Favorites
  recentWishlist.forEach((wish) => {
    if (!activityMap.has("Added to Favorites")) {
      activityMap.set("Added to Favorites", {
        type: "Added to Favorites",
        product: wish.product?.title || null,
        productId: wish.product?._id || null,
        productSlug: wish.product?.slug || null,
        createdAt: wish.createdAt,
      });
    }
  });

  // Review Posted
  recentReviews.forEach((review) => {
    if (!activityMap.has("Review Posted")) {
      activityMap.set("Review Posted", {
        type: "Review Posted",
        product: review.product?.title || null,
        productId: review.product?._id || null,
        productSlug: review.product?.slug || null,
        reviewId: review._id,
        createdAt: review.createdAt,
      });
    }
  });

  // 🔹 Convert map values to array and sort by date descending
  const activity = Array.from(activityMap.values()).sort(
    (a, b) => b.createdAt - a.createdAt
  );

  res.status(200).json({
    status: "success",
    recentActivity: activity,
  });
});

// 🔹 Active Orders
export const getActiveOrders = catchAsync(async (req, res, next) => {
  // 🔹 Fetch active orders for this customer (include in_transit)
  const activeOrders = await Purchase.find({
    ...purchaseBuyerMatch(req),
    status: { $in: ["new", "processing", "shipped", "in_transit"] },
  })
    .sort({ createdAt: -1 })
    .populate({
      path: "products.product",
      select: "title slug _id", // bring product info
    })
    .lean();

  // 🔹 Map orders to remove paymentIntentId from response
  const sanitizedOrders = activeOrders.map((order) => {
    const { paymentIntentId, ...rest } = order;

    // Optionally, transform products array to include slug/title cleanly
    const products = order.products.map((p) => ({
      _id: p._id,
      quantity: p.quantity,
      price: p.price,
      seller: p.seller,
      product: {
        _id: p.product?._id || null,
        title: p.product?.title || null,
        slug: p.product?.slug || null,
      },
    }));

    return {
      ...rest,
      products,
    };
  });

  res.status(200).json({
    status: "success",
    activeOrders: sanitizedOrders,
  });
});

export const getCustomerDashboardStats = catchAsync(async (req, res, next) => {
  // Handle both _id and id formats
  const userId = req.user._id || req.user.id;
  
  if (!userId) {
    return next(new AppError("User not authenticated", 401));
  }

  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );
  const endOfMonth = new Date();

  // ==================== 1️⃣ TOTAL ORDERS ====================
  const buyerMatch = purchaseBuyerMatch(req);
  const userIdString = String(userId);

  const totalOrders = await Purchase.countDocuments(buyerMatch);

  const monthlyOrders = await Purchase.countDocuments({
    ...buyerMatch,
    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
  });

  // ==================== 2️⃣ TOTAL SPENT ====================
  const totalSpentResult = await Purchase.aggregate([
    { $match: buyerMatch },
    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
  ]);

  const totalSpent =
    totalSpentResult.length > 0 ? totalSpentResult[0].total : 0;

  const prevStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth() - 1,
    1
  );
  const prevEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0);

  const prevMonthSpentResult = await Purchase.aggregate([
    {
      $match: {
        ...buyerMatch,
        createdAt: { $gte: prevStart, $lte: prevEnd },
      },
    },
    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
  ]);

  const prevSpent =
    prevMonthSpentResult.length > 0 ? prevMonthSpentResult[0].total : 0;
  const spentChange =
    prevSpent === 0 ? 100 : ((totalSpent - prevSpent) / prevSpent) * 100;

  // ==================== 3️⃣ LOYALTY POINTS ====================
  // Calculate loyalty points by summing earned points and subtracting redeemed points
  const loyaltyResult = await LoyaltyPoint.aggregate([
    {
      $match: {
        $or: [
          { user: userIdString },
          ...(req.user._id ? [{ user: String(req.user._id) }] : []),
          ...(req.user.id ? [{ user: String(req.user.id) }] : []),
        ].filter(Boolean),
      },
    },
    {
      $group: {
        _id: null,
        earnedPoints: {
          $sum: {
            $cond: [{ $eq: ["$type", "earn"] }, "$points", 0]
          }
        },
        redeemedPoints: {
          $sum: {
            $cond: [{ $eq: ["$type", "redeem"] }, { $abs: "$points" }, 0]
          }
        }
      }
    },
    {
      $project: {
        totalPoints: { $subtract: ["$earnedPoints", "$redeemedPoints"] }
      }
    }
  ]);

  const loyaltyPoints =
    loyaltyResult.length > 0 ? loyaltyResult[0].totalPoints : 0;
  const nextTierGoal = 5000; // example tier target
  const pointsToNextTier = Math.max(0, nextTierGoal - loyaltyPoints);

  // ==================== RESPONSE ====================
  res.status(200).json({
    status: "Success",
    dashboard: {
      totalOrders: {
        count: totalOrders,
        message: `+${monthlyOrders} this month`,
      },
      totalSpent: {
        amount: totalSpent,
        message: `+${spentChange.toFixed(2)}% from last month`,
      },
      loyaltyPoints: {
        total: loyaltyPoints,
        message: `${pointsToNextTier} points to next tier`,
      },
    },
  });
});

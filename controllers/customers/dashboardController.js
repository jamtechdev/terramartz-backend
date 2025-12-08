import { Purchase } from "../../models/customers/purchase.js";
import { WishlistProduct } from "../../models/customers/wishlistProduct.js";
import { Review } from "../../models/common/review.js";
import catchAsync from "../../utils/catchasync.js";
import { LoyaltyPoint } from "../../models/customers/loyaltyPoints.js";

// 🔹 Recent Activity (Top 3 items)
export const getRecentActivity = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  // 🔹 Fetch last delivered orders only
  const recentOrders = await Purchase.find({
    buyer: userId,
    status: "delivered",
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  // 🔹 Fetch last 5 wishlist actions
  const recentWishlist = await WishlistProduct.find({ user: userId })
    .sort({ createdAt: -1 })
    .populate("product", "title slug _id")
    .limit(5)
    .lean();

  // 🔹 Fetch last 5 reviews
  const recentReviews = await Review.find({ user: userId })
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
  const userId = req.user._id;

  // 🔹 Fetch active orders for this customer
  const activeOrders = await Purchase.find({
    buyer: userId,
    status: { $in: ["new", "processing", "shipped"] }, // exclude delivered/cancelled
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
  const userId = req.user._id;

  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );
  const endOfMonth = new Date();

  // ==================== 1️⃣ TOTAL ORDERS ====================
  const totalOrders = await Purchase.countDocuments({ buyer: userId });

  const monthlyOrders = await Purchase.countDocuments({
    buyer: userId,
    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
  });

  // ==================== 2️⃣ TOTAL SPENT ====================
  const totalSpentResult = await Purchase.aggregate([
    { $match: { buyer: userId } },
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
      $match: { buyer: userId, createdAt: { $gte: prevStart, $lte: prevEnd } },
    },
    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
  ]);

  const prevSpent =
    prevMonthSpentResult.length > 0 ? prevMonthSpentResult[0].total : 0;
  const spentChange =
    prevSpent === 0 ? 100 : ((totalSpent - prevSpent) / prevSpent) * 100;

  // ==================== 3️⃣ LOYALTY POINTS ====================
  const loyaltyResult = await LoyaltyPoint.aggregate([
    { $match: { user: userId } },
    { $group: { _id: null, totalPoints: { $sum: "$points" } } },
  ]);

  const loyaltyPoints =
    loyaltyResult.length > 0 ? loyaltyResult[0].totalPoints : 0;
  const nextTierGoal = 5000; // example tier target
  const pointsToNextTier = Math.max(0, nextTierGoal - loyaltyPoints);

  // ==================== 4️⃣ SAVED / WISHLIST ITEMS ====================
  const savedItems = await WishlistProduct.countDocuments({ user: userId });

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
      savedItems: {
        count: savedItems,
        message: "Awaiting your return",
      },
    },
  });
});

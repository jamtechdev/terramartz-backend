import mongoose from "mongoose";

import { Purchase } from "../../models/customers/purchase.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { Review } from "../../models/common/review.js";
import { Product } from "../../models/seller/product.js";
import { getPresignedUrl } from "../../utils/awsS3.js";
import catchAsync from "../../utils/catchasync.js";
// import { getPresignedUrl } from "../../utils/awsS3.js";

export const getSellerPerformanceStats = catchAsync(async (req, res, next) => {
  const sellerId = req.user._id.toString();

  const now = new Date();
  const firstDayCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstDayPreviousMonth = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  );

  // ✅ Total Store Views
  const viewsData = await ProductPerformance.aggregate([
    { $match: { createdBy: sellerId } },
    {
      $facet: {
        currentMonth: [
          { $match: { updatedAt: { $gte: firstDayCurrentMonth } } },
          { $group: { _id: null, views: { $sum: "$views" } } },
        ],
        previousMonth: [
          {
            $match: {
              updatedAt: {
                $gte: firstDayPreviousMonth,
                $lt: firstDayCurrentMonth,
              },
            },
          },
          { $group: { _id: null, views: { $sum: "$views" } } },
        ],
      },
    },
  ]);

  const currentViews = viewsData[0]?.currentMonth[0]?.views || 0;
  const lastViews = viewsData[0]?.previousMonth[0]?.views || 0;
  const viewsTrend =
    lastViews > 0 ? ((currentViews - lastViews) / lastViews) * 100 : 0;

  // ✅ Total Orders + Conversion Rate
  const ordersData = await Purchase.aggregate([
    { $match: { "products.seller": sellerId, paymentStatus: "paid" } },
    {
      $facet: {
        currentMonth: [
          { $match: { createdAt: { $gte: firstDayCurrentMonth } } },
          { $count: "total" },
        ],
        previousMonth: [
          {
            $match: {
              createdAt: {
                $gte: firstDayPreviousMonth,
                $lt: firstDayCurrentMonth,
              },
            },
          },
          { $count: "total" },
        ],
      },
    },
  ]);

  const currentOrders = ordersData[0]?.currentMonth[0]?.total || 0;
  const lastOrders = ordersData[0]?.previousMonth[0]?.total || 0;

  const conversionRate =
    currentViews > 0 ? ((currentOrders / currentViews) * 100).toFixed(1) : 0;
  const conversionTrend =
    lastViews > 0 && lastOrders > 0
      ? (
          ((currentOrders / currentViews - lastOrders / lastViews) /
            (lastOrders / lastViews)) *
          100
        ).toFixed(1)
      : 0;

  // ✅ Customer Satisfaction (Avg Rating × 20)
  const ratingData = await ProductPerformance.aggregate([
    { $match: { createdBy: sellerId } },
    { $group: { _id: null, avgRating: { $avg: "$rating" } } },
  ]);
  const avgRating = ratingData[0]?.avgRating || 0;
  const csat = Math.round(avgRating * 20);

  // Last month CSAT
  const ratingDataLastMonth = await ProductPerformance.aggregate([
    {
      $match: {
        createdBy: sellerId,
        updatedAt: {
          $gte: firstDayPreviousMonth,
          $lt: firstDayCurrentMonth,
        },
      },
    },
    { $group: { _id: null, avgRating: { $avg: "$rating" } } },
  ]);
  const lastMonthCSAT = Math.round(
    (ratingDataLastMonth[0]?.avgRating || 0) * 20
  );
  const csatTrend = lastMonthCSAT
    ? (((csat - lastMonthCSAT) / lastMonthCSAT) * 100).toFixed(1)
    : 0;

  // ✅ Response with % sign formatted
  res.status(200).json({
    status: "success",
    performanceOverview: {
      storeViews: {
        value: currentViews.toLocaleString(), // 5,234
        trend: `${viewsTrend.toFixed(0)}% from last month`, // +15% from last month
      },
      conversionRate: {
        value: `${conversionRate}%`,
        trend: `${conversionTrend}% from last month`,
      },
      customerSatisfaction: {
        value: `${csat}%`,
        trend: `${csatTrend}% from last month`,
      },
      totalOrders: currentOrders,
    },
  });
});

export const getSellerCompleteAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user._id;
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const safeObjectId = (id) => {
    if (mongoose.Types.ObjectId.isValid(id))
      return new mongoose.Types.ObjectId(id);
    return id;
  };

  // 🔹 Total Customers
  const totalCustomers = await Purchase.distinct("buyer", {
    "products.seller": safeObjectId(sellerId),
  });

  // 🔹 Repeat Customers
  const repeatCustomersAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: { "products.seller": safeObjectId(sellerId) } },
    { $group: { _id: "$buyer", orderCount: { $sum: 1 } } },
    { $match: { orderCount: { $gt: 1 } } },
    { $count: "repeatCustomers" },
  ]);
  const repeatCustomers = repeatCustomersAgg[0]?.repeatCustomers || 0;

  // 🔹 Average Order Value (AOV)
  const aovAgg = await Purchase.aggregate([
    { $match: { "products.seller": safeObjectId(sellerId) } },
    { $group: { _id: null, avgOrderValue: { $avg: "$totalAmount" } } },
  ]);
  const averageOrderValue = aovAgg[0]?.avgOrderValue || 0;

  // 🔹 Customer Lifetime Value (CLV)
  const clvAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: { "products.seller": safeObjectId(sellerId) } },
    { $group: { _id: "$buyer", totalSpent: { $sum: "$products.price" } } },
    { $group: { _id: null, avgLifetimeValue: { $avg: "$totalSpent" } } },
  ]);
  const customerLifetimeValue = clvAgg[0]?.avgLifetimeValue || 0;

  // 🔹 Lifetime Sales (all time)
  const lifetimeSalesAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: { "products.seller": safeObjectId(sellerId) } },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$products.price" },
        totalOrders: { $sum: 1 },
      },
    },
  ]);
  const lifetimeSales = {
    totalRevenue: lifetimeSalesAgg[0]?.totalRevenue || 0,
    totalOrders: lifetimeSalesAgg[0]?.totalOrders || 0,
  };

  // 🔹 Daily, Weekly, Monthly, Yearly Sales
  const salesAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: { "products.seller": safeObjectId(sellerId) } },
    {
      $project: {
        totalAmount: "$products.price",
        date: "$createdAt",
        day: { $dayOfMonth: "$createdAt" },
        month: { $month: "$createdAt" },
        year: { $year: "$createdAt" },
        week: { $week: "$createdAt" },
      },
    },
    { $match: { year } },
    {
      $group: {
        _id: null,
        daily: { $push: { day: "$day", totalAmount: "$totalAmount" } },
        weekly: { $push: { week: "$week", totalAmount: "$totalAmount" } },
        monthly: { $push: { month: "$month", totalAmount: "$totalAmount" } },
        yearly: { $sum: "$totalAmount" },
      },
    },
  ]);

  // Aggregate daily, weekly, monthly totals
  const dailySales = {};
  const weeklySales = {};
  const monthlySales = {};
  const yearlySales = salesAgg[0]?.yearly || 0;

  if (salesAgg[0]) {
    salesAgg[0].daily.forEach((d) => {
      dailySales[d.day] = (dailySales[d.day] || 0) + d.totalAmount;
    });
    salesAgg[0].weekly.forEach((w) => {
      weeklySales[w.week] = (weeklySales[w.week] || 0) + w.totalAmount;
    });
    salesAgg[0].monthly.forEach((m) => {
      monthlySales[m.month] = (monthlySales[m.month] || 0) + m.totalAmount;
    });
  }

  res.status(200).json({
    status: "success",
    totalCustomers: totalCustomers.length,
    repeatCustomers,
    averageOrderValue,
    customerLifetimeValue,
    lifetimeSales,
    dailySales,
    weeklySales,
    monthlySales,
    yearlySales,
  });
});
// 127.0.0.1:7345/api/seller/dashboard/analytics?startDate=2025-07-01&endDate=2025-10-20&filterProducts=true
export const getSellerDashboardAnalytics = catchAsync(async (req, res) => {
  const sellerId = req.user._id;
  const { startDate, endDate, filterProducts = "false" } = req.query;

  const safeId = mongoose.Types.ObjectId.isValid(sellerId)
    ? new mongoose.Types.ObjectId(sellerId)
    : sellerId;

  // 🔹 Parse startDate & endDate
  let start = startDate ? new Date(startDate) : null;
  let end = endDate ? new Date(endDate) : null;
  if (end) end.setHours(23, 59, 59, 999);

  // 🔹 Match conditions for Purchase
  const matchPurchase = { "products.seller": safeId };
  if (start || end) {
    matchPurchase.createdAt = {};
    if (start) matchPurchase.createdAt.$gte = start;
    if (end) matchPurchase.createdAt.$lte = end;
  }

  // 🔹 Total Sales
  const salesAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: matchPurchase },
    { $group: { _id: null, revenue: { $sum: "$products.price" } } },
  ]);
  const totalSales = salesAgg[0]?.revenue || 0;

  // 🔹 Sales Growth this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );

  const currentMonthAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    {
      $match: {
        "products.seller": safeId,
        createdAt: { $gte: monthStart, $lte: monthEnd },
      },
    },
    { $group: { _id: null, revenue: { $sum: "$products.price" } } },
  ]);
  const currentMonthSales = currentMonthAgg[0]?.revenue || 0;

  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59,
    999
  );

  const lastMonthAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    {
      $match: {
        "products.seller": safeId,
        createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd },
      },
    },
    { $group: { _id: null, revenue: { $sum: "$products.price" } } },
  ]);
  const lastMonthSales = lastMonthAgg[0]?.revenue || 0;

  const salesGrowth =
    lastMonthSales > 0
      ? (((currentMonthSales - lastMonthSales) / lastMonthSales) * 100).toFixed(
          2
        )
      : 0;

  // 🔹 Match conditions for Product
  const productMatch = { createdBy: safeId };
  if (filterProducts === "true" && (start || end)) {
    productMatch.createdAt = {};
    if (start) productMatch.createdAt.$gte = start;
    if (end) productMatch.createdAt.$lte = end;
  }

  // 🔹 Total Products & Active Products
  const productCounts = await Product.aggregate([
    { $match: productMatch },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        activeProducts: {
          $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
        },
      },
    },
  ]);
  const totalProducts = productCounts[0]?.totalProducts || 0;
  const activeProducts = productCounts[0]?.activeProducts || 0;

  // 🔹 Active Orders / Pending Orders
  const orderAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: matchPurchase },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const activeOrders = orderAgg.find((d) => d._id === "processing")?.count || 0;
  const pendingOrders = orderAgg.find((d) => d._id === "new")?.count || 0;

  // 🔹 Avg Rating & Total Reviews
  let productIds = await Product.find({ createdBy: safeId }).distinct("_id");
  const reviewMatch = { product: { $in: productIds } };
  if (filterProducts === "true" && (start || end)) {
    reviewMatch.createdAt = {};
    if (start) reviewMatch.createdAt.$gte = start;
    if (end) reviewMatch.createdAt.$lte = end;
  }

  const reviewAgg = await Review.aggregate([
    { $match: reviewMatch },
    {
      $group: {
        _id: null,
        avgRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 },
      },
    },
  ]);
  const avgRating = reviewAgg[0]?.avgRating?.toFixed(1) || 0;
  const totalReviews = reviewAgg[0]?.totalReviews || 0;

  // 🔹 Final Response
  res.status(200).json({
    status: "success",
    totalSales,
    salesGrowth: `${salesGrowth}%`,
    totalProducts,
    activeProducts,
    activeOrders,
    pendingOrders,
    avgRating,
    totalReviews,
    startDate: start ? start.toISOString().split("T")[0] : null,
    endDate: end ? end.toISOString().split("T")[0] : null,
  });
});

export const getBestSellers = catchAsync(async (req, res, next) => {
  let topProducts = await ProductPerformance.aggregate([
    // 1️⃣ Join products collection
    {
      $lookup: {
        from: "products",
        localField: "product",
        foreignField: "_id",
        as: "productDetails",
      },
    },
    { $unwind: "$productDetails" },
    { $match: { "productDetails.status": "active" } },

    // 2️⃣ Sort by sales, views, createdAt
    {
      $sort: {
        totalSales: -1,
        views: -1,
        "productDetails.createdAt": -1,
      },
    },
    { $limit: 3 },

    // 3️⃣ Merge productDetails into root
    {
      $replaceRoot: {
        newRoot: { $mergeObjects: ["$productDetails", "$$ROOT"] },
      },
    },

    // 4️⃣ Join seller info from User collection
    {
      $lookup: {
        from: "users",
        localField: "createdBy",
        foreignField: "_id",
        as: "seller",
      },
    },
    { $unwind: { path: "$seller", preserveNullAndEmptyArrays: true } },

    // 5️⃣ Project only required fields + shopSlug
    {
      $project: {
        _id: 1,
        title: 1,
        slug: 1,
        description: 1,
        price: 1,
        originalPrice: 1,
        category: 1,
        stockQuantity: 1,
        productImages: 1,
        tags: 1,
        organic: 1,
        featured: 1,
        productType: 1,
        status: 1,
        createdBy: 1,
        discount: 1,
        discountType: 1,
        discountExpires: 1,
        totalSales: 1,
        totalQuantitySold: 1,
        views: 1,
        rating: 1,
        currentStock: 1,
        createdAt: 1,
        shopSlug: "$seller.sellerProfile.shopSlug",
        shopPicture: "$seller.sellerProfile.shopPicture",
      },
    },
  ]);

  if (!topProducts || topProducts.length === 0) {
    return next(new AppError("No best-selling products found", 404));
  }

  // 🔹 Apply presigned URLs for product images and shop picture
  topProducts = await Promise.all(
    topProducts.map(async (p) => {
      // Product images presigned URL
      let productImages = p.productImages || [];
      productImages = await Promise.all(
        productImages.map(
          async (img) => await getPresignedUrl(`products/${img}`)
        )
      );

      // Seller shop picture presigned URL
      let shopPictureUrl = null;
      if (p.shopPicture) {
        shopPictureUrl = await getPresignedUrl(`shopPicture/${p.shopPicture}`);
      }

      return {
        ...p,
        productImages,
        shopPicture: shopPictureUrl,
      };
    })
  );

  res.status(200).json({
    status: "success",
    results: topProductsWithUrls.length,
    data: topProductsWithUrls,
  });
});

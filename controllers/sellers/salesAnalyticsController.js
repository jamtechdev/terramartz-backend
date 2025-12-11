import mongoose from "mongoose";

import { Purchase } from "../../models/customers/purchase.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { Review } from "../../models/common/review.js";
import { Product } from "../../models/seller/product.js";
import { getPresignedUrl } from "../../utils/awsS3.js";
import catchAsync from "../../utils/catchasync.js";
// import { getPresignedUrl } from "../../utils/awsS3.js";
import AppError from "../../utils/apperror.js";

// Helper function to safely convert to ObjectId
const safeObjectId = (id) => {
  if (mongoose.Types.ObjectId.isValid(id))
    return new mongoose.Types.ObjectId(id);
  return id;
};

// ✅ Get Seller Performance Stats
export const getSellerPerformanceStats = catchAsync(async (req, res, next) => {
  const sellerId = req.user._id;
  const safeId = safeObjectId(sellerId);

  // Total Products
  const totalProducts = await Product.countDocuments({ createdBy: safeId });

  // Active Products
  const activeProducts = await Product.countDocuments({
    createdBy: safeId,
    status: "active",
  });

  // Total Sales (from Purchase collection)
  const salesAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: { "products.seller": safeId } },
    { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" } } },
    { $group: { _id: null, revenue: { $sum: "$totalAmount" } } },
  ]);
  const totalSales = salesAgg[0]?.revenue || 0;

  // Total Orders
  const totalOrders = await Purchase.countDocuments({
    "products.seller": safeId,
  });

  res.status(200).json({
    status: "success",
    data: {
      totalProducts,
      activeProducts,
      totalSales,
      totalOrders,
    },
  });
});

// ✅ Get Seller Complete Analytics (Lifetime)
export const getSellerCompleteAnalytics = catchAsync(async (req, res, next) => {
  const sellerId = req.user._id;
  const { startDate, endDate, year } = req.query;

  // Get year from query or default to current year
  const currentYear = new Date().getFullYear();
  const selectedYear = year ? parseInt(year) : currentYear;

  // 🔹 Convert sellerId to String (Purchase stores seller as String)
  const sellerIdString = String(sellerId);

  // Parse dates
  let start = startDate ? new Date(startDate) : null;
  let end = endDate ? new Date(endDate) : null;
  if (end) end.setHours(23, 59, 59, 999);

  // 🔹 Match conditions (seller is stored as String in Purchase)
  const matchPurchase = { "products.seller": sellerIdString };
  if (start || end) {
    matchPurchase.createdAt = {};
    if (start) matchPurchase.createdAt.$gte = start;
    if (end) matchPurchase.createdAt.$lte = end;
  }

  console.log("\n========== SELLER COMPLETE ANALYTICS ==========");
  console.log("📦 Seller ID:", sellerId, "Type:", typeof sellerId);
  console.log("📦 Seller ID (String):", sellerIdString);
  console.log("📦 Match Purchase:", JSON.stringify(matchPurchase, null, 2));
  console.log("📦 Selected Year:", selectedYear);

  // 🔹 Total Revenue - Use totalAmount (what user paid) for orders containing seller's products
  // First check what seller IDs exist in Purchase collection
  const sampleSellerIds = await Purchase.aggregate([
    { $unwind: "$products" },
    { $limit: 5 },
    {
      $project: {
        sellerId: "$products.seller",
        sellerIdType: { $type: "$products.seller" },
      },
    },
  ]);
  console.log("📦 Sample seller IDs in Purchase:", sampleSellerIds);
  
  const revenueAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: matchPurchase },
    { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" } } },
    { $group: { _id: null, revenue: { $sum: "$totalAmount" } } },
  ]);
  const totalRevenue = revenueAgg[0]?.revenue || 0;
  console.log("📦 Total Revenue:", totalRevenue);
  console.log("📦 Revenue Agg result:", revenueAgg);

  // 🔹 Total Orders
  const totalOrdersAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: matchPurchase },
    { $group: { _id: "$_id" } },
    { $count: "total" },
  ]);
  const totalOrders = totalOrdersAgg[0]?.total || 0;

  // 🔹 Average Order Value
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // 🔹 Total Customers (unique buyers)
  const totalCustomersAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: matchPurchase },
    { $group: { _id: "$buyer" } },
    { $count: "total" },
  ]);
  const totalCustomers = totalCustomersAgg[0]?.total || 0;

  // 🔹 Repeat Customers (customers with more than 1 order)
  const repeatCustomersAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: matchPurchase },
    { $group: { _id: "$buyer", orderCount: { $sum: 1 } } },
    { $match: { orderCount: { $gt: 1 } } },
    { $count: "total" },
  ]);
  const repeatCustomers = repeatCustomersAgg[0]?.total || 0;

  // 🔹 Customer Lifetime Value (average revenue per customer)
  const clvAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: matchPurchase },
    { $group: { _id: "$buyer", totalSpent: { $sum: "$totalAmount" } } },
    {
      $group: {
        _id: null,
        avgLifetimeValue: { $avg: "$totalSpent" },
      },
    },
  ]);
  const customerLifetimeValue = clvAgg[0]?.avgLifetimeValue || 0;

  // 🔹 Lifetime Sales (all time) - Use totalAmount (what user paid)
  const lifetimeSalesAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: { "products.seller": sellerIdString } },
    { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" } } }, // Get totalAmount per order
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$totalAmount" }, // Sum all order totalAmounts
        totalOrders: { $sum: 1 },
      },
    },
  ]);
  const lifetimeSales = {
    totalRevenue: lifetimeSalesAgg[0]?.totalRevenue || 0,
    totalOrders: lifetimeSalesAgg[0]?.totalOrders || 0,
  };

  // 🔹 Daily, Weekly, Monthly, Yearly Sales - Use totalAmount (what user paid)
  const salesAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: { "products.seller": sellerIdString } },
    { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" }, createdAt: { $first: "$createdAt" } } }, // Get totalAmount per order
    {
      $project: {
        totalAmount: "$totalAmount", // Use order's totalAmount
        day: { $dayOfMonth: "$createdAt" },
        month: { $month: "$createdAt" },
        year: { $year: "$createdAt" },
        week: { $week: "$createdAt" },
      },
    },
    { $match: { year: selectedYear } },
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

  // Aggregate daily, weekly, monthly totals for revenue
  const dailySales = {};
  const weeklySales = {};
  const monthlySales = {};
  const yearlySales = salesAgg[0]?.yearly || 0;
  
  // Aggregate daily, weekly, monthly totals for order counts
  const dailyOrders = {};
  const weeklyOrders = {};
  const monthlyOrders = {};
  
  console.log("📦 Yearly Sales for", selectedYear, ":", yearlySales);
  console.log("📦 Sales Aggregation result:", salesAgg[0] ? "Found data" : "No data");

  if (salesAgg[0]) {
    console.log("📦 Processing daily/weekly/monthly data...");
    console.log("📦 Daily array length:", salesAgg[0].daily?.length || 0);
    console.log("📦 Weekly array length:", salesAgg[0].weekly?.length || 0);
    console.log("📦 Monthly array length:", salesAgg[0].monthly?.length || 0);
    
    salesAgg[0].daily.forEach((d) => {
      const dayKey = String(d.day);
      dailySales[dayKey] = (dailySales[dayKey] || 0) + d.totalAmount;
      dailyOrders[dayKey] = (dailyOrders[dayKey] || 0) + 1;
    });
    salesAgg[0].weekly.forEach((w) => {
      const weekKey = String(w.week);
      weeklySales[weekKey] = (weeklySales[weekKey] || 0) + w.totalAmount;
      weeklyOrders[weekKey] = (weeklyOrders[weekKey] || 0) + 1;
    });
    salesAgg[0].monthly.forEach((m) => {
      const monthKey = String(m.month);
      monthlySales[monthKey] = (monthlySales[monthKey] || 0) + m.totalAmount;
      monthlyOrders[monthKey] = (monthlyOrders[monthKey] || 0) + 1;
    });
    
    console.log("📦 Daily Orders sample:", Object.keys(dailyOrders).slice(0, 5).map(k => `${k}: ${dailyOrders[k]}`));
    console.log("📦 Monthly Orders:", monthlyOrders);
  }

  res.status(200).json({
    status: "success",
    data: {
      totalRevenue,
      totalOrders,
      avgOrderValue,
      customerLifetimeValue,
      totalCustomers,
      repeatCustomers,
      lifetimeSales,
      dailySales,
      weeklySales,
      monthlySales,
      yearlySales,
      dailyOrders,
      weeklyOrders,
      monthlyOrders,
    },
  });
});
// 127.0.0.1:7345/api/seller/dashboard/analytics?startDate=2025-07-01&endDate=2025-10-20&filterProducts=true
export const getSellerDashboardAnalytics = catchAsync(async (req, res) => {
  const sellerId = req.user._id;
    const { startDate, endDate, filterProducts = "false" } = req.query;

    console.log("\n========== SELLER DASHBOARD ANALYTICS ==========");
    console.log("📦 Seller ID:", sellerId, "Type:", typeof sellerId);

    // 🔹 Convert sellerId to String (Purchase and Product use String IDs)
    const sellerIdString = String(sellerId);
    console.log("📦 Seller ID (String):", sellerIdString);

    // 🔹 Parse startDate & endDate
    let start = startDate ? new Date(startDate) : null;
    let end = endDate ? new Date(endDate) : null;
    if (end) end.setHours(23, 59, 59, 999);

    // 🔹 Match conditions for Purchase (seller is stored as String)
    // Try String first, then ObjectId if needed
    const matchPurchase = {
      "products.seller": sellerIdString, // Primary: match as String
    };
    if (start || end) {
      matchPurchase.createdAt = {};
      if (start) matchPurchase.createdAt.$gte = start;
      if (end) matchPurchase.createdAt.$lte = end;
    }

    console.log("📦 Purchase match condition:", JSON.stringify(matchPurchase, null, 2));

    // 🔹 Total Sales - Use totalAmount (what user paid) for orders containing seller's products
    // Group by orderId first to get unique orders, then sum totalAmount
    console.log("📦 Fetching total sales...");
    const salesAgg = await Purchase.aggregate([
      { $unwind: "$products" },
      { $match: matchPurchase },
      { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" } } }, // Get totalAmount per order
      { $group: { _id: null, revenue: { $sum: "$totalAmount" } } }, // Sum all order totalAmounts
    ]);
    const totalSales = salesAgg[0]?.revenue || 0;
    console.log("📦 Total Sales:", totalSales);

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
    59,
    999
  );

  console.log("📦 Fetching current month sales...");
  const currentMonthAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    {
      $match: {
        "products.seller": sellerIdString,
        createdAt: { $gte: monthStart, $lte: monthEnd },
      },
    },
    { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" } } }, // Get totalAmount per order
    { $group: { _id: null, revenue: { $sum: "$totalAmount" } } }, // Sum all order totalAmounts
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
    59,
    999
  );

  console.log("📦 Fetching last month sales...");
  const lastMonthAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    {
      $match: {
        "products.seller": sellerIdString,
        createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd },
      },
    },
    { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" } } }, // Get totalAmount per order
    { $group: { _id: null, revenue: { $sum: "$totalAmount" } } }, // Sum all order totalAmounts
  ]);
  const lastMonthSales = lastMonthAgg[0]?.revenue || 0;

  const salesGrowth =
    lastMonthSales > 0
      ? (((currentMonthSales - lastMonthSales) / lastMonthSales) * 100).toFixed(
          2
        )
      : 0;

  // 🔹 Match conditions for Product (createdBy is stored as String UUID)
  const productMatch = {
    createdBy: sellerIdString, // Match as String
  };
  if (filterProducts === "true" && (start || end)) {
    productMatch.createdAt = {};
    if (start) productMatch.createdAt.$gte = start;
    if (end) productMatch.createdAt.$lte = end;
  }

  console.log("📦 Product match condition:", JSON.stringify(productMatch, null, 2));
  console.log("📦 Fetching product counts...");

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

  console.log("📦 Total Products:", productCounts[0]?.totalProducts || 0);
  console.log("📦 Active Products:", productCounts[0]?.activeProducts || 0);

  // 🔹 Top Selling Products (by quantity sold)
  console.log("📦 Fetching top selling products...");
  const topSellingAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: matchPurchase },
    {
      $group: {
        _id: "$products.product",
        totalQuantity: { $sum: "$products.quantity" },
      },
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: 5 },
  ]);

  const topSellingProductIds = topSellingAgg.map((p) => p._id);
  const topSellingProducts = await Product.find({
    _id: { $in: topSellingProductIds },
  })
    .select("title slug price productImages")
    .lean();

  // Map sales quantities to products
  const topSelling = topSellingProducts.map((product) => {
    const salesData = topSellingAgg.find(
      (s) => String(s._id) === String(product._id)
    );
    return {
      ...product,
      quantitySold: salesData?.totalQuantity || 0,
    };
  });

  console.log("📦 Top selling products count:", topSelling.length);
  console.log("==========================================\n");

  // 🔹 Get active/pending orders count
  // Active orders = orders with paymentStatus paid/pending and status not delivered
  const activeOrdersMatch = {
    ...matchPurchase,
    paymentStatus: { $in: ["paid", "pending"] },
    status: { $ne: "delivered" },
  };
  // Remove products.seller from match since we're matching at order level
  delete activeOrdersMatch["products.seller"];
  activeOrdersMatch["products.seller"] = sellerIdString;

  const activeOrdersAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: { "products.seller": sellerIdString } },
    { $group: { _id: "$_id", paymentStatus: { $first: "$paymentStatus" }, status: { $first: "$status" } } },
    {
      $match: {
        paymentStatus: { $in: ["paid", "pending"] },
        status: { $ne: "delivered" },
      },
    },
    { $count: "total" },
  ]);
  const activeOrders = activeOrdersAgg[0]?.total || 0;

  const pendingOrdersAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    { $match: { "products.seller": sellerIdString } },
    { $group: { _id: "$_id", paymentStatus: { $first: "$paymentStatus" } } },
    {
      $match: {
        paymentStatus: "pending",
      },
    },
    { $count: "total" },
  ]);
  const pendingOrders = pendingOrdersAgg[0]?.total || 0;

  // 🔹 Get average rating and total reviews from Review collection
  // Get all products created by this seller
  const sellerProducts = await Product.find({ createdBy: sellerIdString })
    .select("_id")
    .lean();
  const sellerProductIds = sellerProducts.map((p) => String(p._id));

  let avgRating = 0;
  let totalReviews = 0;

  if (sellerProductIds.length > 0) {
    // Get reviews for seller's products
    const reviewsAgg = await Review.aggregate([
      {
        $match: {
          product: { $in: sellerProductIds },
        },
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
        },
      },
    ]);

    if (reviewsAgg[0]) {
      avgRating = Math.round((reviewsAgg[0].avgRating || 0) * 10) / 10; // Round to 1 decimal
      totalReviews = reviewsAgg[0].totalReviews || 0;
    }
  }

  console.log("📦 Final analytics data:", {
    totalSales,
    salesGrowth: parseFloat(salesGrowth),
    totalProducts,
    activeProducts,
    activeOrders,
    pendingOrders,
    avgRating,
    totalReviews,
  });

  res.status(200).json({
    status: "success",
    data: {
      totalSales,
      salesGrowth: parseFloat(salesGrowth),
      totalProducts,
      activeProducts,
      activeOrders,
      pendingOrders,
      avgRating,
      totalReviews,
      topSellingProducts: topSelling,
    },
    startDate: start ? start.toISOString().split("T")[0] : null,
    endDate: end ? end.toISOString().split("T")[0] : null,
  });
});

export const getBestSellers = catchAsync(async (req, res, next) => {
  // 🔹 First, get actual sales count from Purchase collection (last 8 days)
  // This ensures we show products that actually have orders
  const eightDaysAgo = new Date();
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
  eightDaysAgo.setHours(0, 0, 0, 0);

  console.log("\n========== BEST SELLERS - CALCULATING ==========");
  console.log("📦 Date range: Last 8 days from", eightDaysAgo.toISOString());

  // Get products with actual sales from Purchase collection (last 8 days)
  const actualSalesData = await Purchase.aggregate([
    { $unwind: "$products" },
    {
      $match: {
        createdAt: { $gte: eightDaysAgo },
        paymentStatus: { $in: ["paid", "pending"] }, // Count all paid/pending orders
      },
    },
    {
      $group: {
        _id: "$products.product", // Product ID (String UUID)
        soldCount: { $sum: "$products.quantity" },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { soldCount: -1 } },
    { $limit: 10 }, // Get top 10 by actual sales
  ]);

  console.log("📦 Actual sales from Purchase (last 8 days):", JSON.stringify(actualSalesData, null, 2));

  // Create a map for quick lookup of sales count
  const salesCountMap = {};
  actualSalesData.forEach((item) => {
    salesCountMap[String(item._id)] = item.soldCount || 0;
  });

  // Get product IDs that have actual sales
  const productIdsWithSales = actualSalesData.map((item) => String(item._id));
  console.log("📦 Product IDs with sales:", productIdsWithSales);

  let topProducts;
  
  if (productIdsWithSales.length > 0) {
    // 🔹 START FROM PRODUCT COLLECTION (not ProductPerformance)
    // Get products that have actual sales directly from Product collection
    // Note: Product._id is String (UUID), so we match as strings
    topProducts = await Product.aggregate([
      {
        $match: {
          _id: { $in: productIdsWithSales },
          status: "active",
        },
      },
      // 1️⃣ Join ProductPerformance for additional metrics
      {
        $lookup: {
          from: "productperformances",
          localField: "_id",
          foreignField: "product",
          as: "performance",
        },
      },
      { $unwind: { path: "$performance", preserveNullAndEmptyArrays: true } },

      // 2️⃣ Join seller info from User collection
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "seller",
        },
      },
      { $unwind: { path: "$seller", preserveNullAndEmptyArrays: true } },

      // 3️⃣ Project required fields
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
          createdAt: 1,
          // From ProductPerformance
          totalSales: "$performance.totalSales",
          totalQuantitySold: "$performance.totalQuantitySold",
          views: "$performance.views",
          rating: "$performance.rating",
          currentStock: "$performance.currentStock",
          // From seller
          shopSlug: "$seller.sellerProfile.shopSlug",
          shopPicture: "$seller.sellerProfile.shopPicture",
        },
      },
    ]);
    
    // Add soldLast8Days to each product from salesCountMap
    topProducts = topProducts.map((p) => {
      const productIdStr = String(p._id);
      return {
        ...p,
        soldLast8Days: salesCountMap[productIdStr] || 0,
      };
    });
    
    // Re-sort by actual sales count (descending)
    topProducts.sort((a, b) => {
      if (b.soldLast8Days !== a.soldLast8Days) {
        return b.soldLast8Days - a.soldLast8Days;
      }
      return (b.views || 0) - (a.views || 0);
    });
    
    // Limit to top 3
    topProducts = topProducts.slice(0, 3);
    
    console.log("📦 Top products after sorting:", topProducts.map(p => ({ 
      id: p._id, 
      title: p.title, 
      soldLast8Days: p.soldLast8Days 
    })));
  } else {
    // Fallback: Use ProductPerformance if no recent sales
    console.log("⚠️ No products with sales in last 8 days, using ProductPerformance fallback");
    topProducts = await ProductPerformance.aggregate([
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
    
    // Add soldLast8Days as 0 for fallback products
    topProducts = topProducts.map((p) => ({
      ...p,
      soldLast8Days: 0,
    }));
  }

  if (!topProducts || topProducts.length === 0) {
    return next(new AppError("No best-selling products found", 404));
  }

  console.log("📦 Final top products:", topProducts.map(p => ({ 
    id: p._id, 
    title: p.title, 
    soldLast8Days: p.soldLast8Days || 0 
  })));
  console.log("==========================================\n");

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

      // soldLast8Days is already added above
      const soldLast8Days = p.soldLast8Days || 0;
      
      console.log(`📦 Product "${p.title || 'Unknown'}" (${p._id}): Sold=${soldLast8Days} (Last 8 days)`);

      return {
        ...p,
        productImages,
        shopPicture: shopPictureUrl,
        soldLast8Days, // Add sales count for last 8 days
      };
    })
  );

  res.status(200).json({
    status: "success",
    results: topProducts.length,
    data: topProducts,
  });
});

// ✅ Get Seller Earnings (Today and Overall)
export const getSellerEarnings = catchAsync(async (req, res, next) => {
  const sellerId = req.user._id.toString();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );

  // 🔹 Today's Earnings - Use totalAmount (what user paid) for orders containing seller's products
  const todayEarningsAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    {
      $match: {
        "products.seller": sellerId,
        createdAt: { $gte: todayStart, $lte: todayEnd },
        paymentStatus: { $in: ["paid", "pending"] },
      },
    },
    { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" } } }, // Get totalAmount per order
    { $group: { _id: null, revenue: { $sum: "$totalAmount" } } }, // Sum all order totalAmounts
  ]);
  const todayEarnings = todayEarningsAgg[0]?.revenue || 0;

  // 🔹 Overall Earnings - Use totalAmount (what user paid) for orders containing seller's products
  const overallEarningsAgg = await Purchase.aggregate([
    { $unwind: "$products" },
    {
      $match: {
        "products.seller": sellerId,
        paymentStatus: { $in: ["paid", "pending"] },
      },
    },
    { $group: { _id: "$_id", totalAmount: { $first: "$totalAmount" } } }, // Get totalAmount per order
    { $group: { _id: null, revenue: { $sum: "$totalAmount" } } }, // Sum all order totalAmounts
  ]);
  const overallEarnings = overallEarningsAgg[0]?.revenue || 0;

  res.status(200).json({
    status: "success",
    data: {
      todayEarnings,
      overallEarnings,
    },
  });
});

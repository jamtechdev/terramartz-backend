import mongoose from "mongoose";
import crypto from "crypto";
import { getPresignedUrl } from "../../utils/awsS3.js";
import { User } from "../../models/users.js";
import { Farm } from "../../models/seller/farm.js";
import { Purchase } from "../../models/customers/purchase.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { Product } from "../../models/seller/product.js";
import { Review } from "../../models/common/review.js";

import APIFeatures from "../../utils/apiFeatures.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { processImage } from "../../utils/multerConfig.js";

export const getSellerStore = catchAsync(async (req, res, next) => {
  const { sellerId } = req.params;

  // 1️⃣ Fetch seller
  const seller = await User.findById(sellerId).lean();
  if (!seller || seller.role !== "seller") {
    return next(new AppError("Seller not found", 404));
  }

  // 2️⃣ Fetch farm
  const farm = await Farm.findOne({ owner: sellerId }).lean();
  if (!farm) {
    return next(new AppError("Farm not found for this seller", 404));
  }

  // 3️⃣ Fetch products count
  const productsCount = await Product.countDocuments({ createdBy: sellerId });

  // 4️⃣ Fetch reviews
  const reviews = await Review.find({ product: { $in: farm.products } }).lean();
  const totalReviews = reviews.length;
  const avgRating =
    totalReviews > 0
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(
          1
        )
      : 0;

  // 🔥 PRESIGNED URL APPLY — replace old image URL with signed version
  const shopPicture = seller.sellerProfile?.shopPicture
    ? await getPresignedUrl(`shopPicture/${seller.sellerProfile.shopPicture}`)
    : null;

  const profilePicture = seller.profilePicture
    ? await getPresignedUrl(`profilePicture/${seller.profilePicture}`)
    : null;

  // 5️⃣ Prepare response (NOTHING REMOVED OR RENAMED)
  const storeData = {
    shopName:
      seller.sellerProfile?.shopName || seller.businessDetails?.businessName,
    shopSlug: seller.sellerProfile?.shopSlug,

    // ⬇️ same keys — only value updated
    shopPicture,
    profilePicture,

    sellerName: `${seller.firstName || ""} ${seller.lastName || ""}`.trim(),
    averageRating: Number(avgRating),
    totalReviews,
    happyCustomers: totalReviews,
    businessAddress: {
      lineAddress: seller.lineAddress || "",
      apartmentOrBuildingNumber: seller.apartmentOrBuildingNumber || "",
      city: seller.city || "",
      state: seller.state || "",
      postalCode: seller.zipCode || "",
      country: seller.countryCode || seller.businessDetails?.country || "",
    },
    productsAvailable: productsCount,
    memberSince: seller.createdAt,
    farmDescription: farm.description || "",
    specialties: farm.product_categories || [],
    certifications: farm.certifications || [],
    contact: {
      phone: seller.phoneNumber || "",
      email: seller.email || "",
      openingHours: farm.openingHours || {},
    },
  };

  res.status(200).json({
    status: "success",
    store: storeData,
  });
});

// http://localhost:7345/api/terramartz/sellers/9cbbc239-2b5b-4158-87be-8e3c283b8295/store/products?search=Tomato&categoryId=3cd07046-ea63-45a9-b78f-cbf9a8b409a4&priceSort=desc&ratingSort=desc&page=1&limit=10

export const getSellerStoreProducts = catchAsync(async (req, res, next) => {
  const { sellerId } = req.params;

  const isTopSelling = req.query.topSelling === "true";
  const page = req.query.page * 1 || 1;
  const limit = req.query.limit * 1 || 10;

  let productSalesMap = {};
  let productIds = [];

  const safeObjectId = (id) => {
    if (mongoose.Types.ObjectId.isValid(id))
      return new mongoose.Types.ObjectId(id);
    return id;
  };

  // 🔹 Aggregate top selling if requested
  if (isTopSelling) {
    const topSelling = await Purchase.aggregate([
      { $unwind: "$products" },
      { $match: { "products.seller": safeObjectId(sellerId) } },
      {
        $group: {
          _id: "$products.product",
          totalQuantity: { $sum: "$products.quantity" },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);

    productIds = topSelling.map((p) => p._id.toString());
    topSelling.forEach((p) => {
      productSalesMap[p._id.toString()] = p.totalQuantity;
    });
  } else {
    const allSales = await Purchase.aggregate([
      { $unwind: "$products" },
      { $match: { "products.seller": safeObjectId(sellerId) } },
      {
        $group: {
          _id: "$products.product",
          totalQuantity: { $sum: "$products.quantity" },
        },
      },
    ]);
    allSales.forEach((p) => {
      productSalesMap[p._id.toString()] = p.totalQuantity;
    });
  }

  // 🔹 Base product query
  let query = Product.find({ createdBy: sellerId });

  // 🔹 Search by product name (fuzzy)
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search.split(" ").join("|"), "i");
    query = query.find({ title: { $regex: searchRegex } });
  }

  // 🔹 Filter by category
  if (req.query.categoryId) {
    query = query.find({ category: req.query.categoryId });
  }

  // 🔹 Pagination
  const skip = (page - 1) * limit;
  query = query.skip(skip).limit(limit);

  // 🔹 Populate seller & category
  let products = await query
    .populate({
      path: "createdBy",
      select:
        "firstName middleName lastName profilePicture businessDetails sellerProfile",
    })
    .populate({
      path: "category",
      select: "name _id",
    });

  // 🔹 Fetch product performances
  const allProductIds = products.map((p) => p._id);
  const performances = await ProductPerformance.find({
    product: { $in: allProductIds },
  }).lean();

  const performanceMap = {};
  performances.forEach((p) => {
    performanceMap[p.product.toString()] = p;
  });

  // 🔹 Build products with performance & seller info
  let productsWithPerformance = await Promise.all(
    products.map(async (p) => {
      // 🔹 Presigned URL for seller images
      const profilePicture = p.createdBy?.profilePicture
        ? await getPresignedUrl(`profilePicture/${p.createdBy.profilePicture}`)
        : null;

      const shopPicture = p.createdBy?.sellerProfile?.shopPicture
        ? await getPresignedUrl(
            `shopPicture/${p.createdBy.sellerProfile.shopPicture}`
          )
        : null;

      // 🔹 Presigned URLs for product images
      const productImages = p.productImages?.length
        ? await Promise.all(
            p.productImages.map((img) => getPresignedUrl(`products/${img}`))
          )
        : [];

      const seller = p.createdBy
        ? {
            _id: p.createdBy._id,
            name: `${p.createdBy.firstName || ""} ${
              p.createdBy.middleName || ""
            } ${p.createdBy.lastName || ""}`
              .replace(/\s+/g, " ")
              .trim(),
            profilePicture,
            shopName: p.createdBy.businessDetails?.businessName || null,
            shopLocation: p.createdBy.businessDetails?.businessLocation || null,
            shopPicture,
          }
        : null;

      const totalSold = productSalesMap[p._id.toString()] || 0;

      return {
        _id: p._id,
        title: p.title,
        description: p.description,
        price: p.price,
        originalPrice: p.originalPrice,
        category: p.category
          ? { _id: p.category._id, name: p.category.name }
          : null,
        stockQuantity: p.stockQuantity,
        productImages,
        tags: p.tags || [],
        organic: p.organic,
        featured: p.featured,
        productType: p.productType,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        performance: performanceMap[p._id.toString()] || {
          views: 0,
          totalSales: totalSold,
          rating: 0,
          currentStock: p.stockQuantity || 0,
        },
        totalSold,
        seller,
      };
    })
  );

  // 🔹 Sorting
  if (req.query.priceSort) {
    const sortDir = req.query.priceSort === "asc" ? 1 : -1;
    productsWithPerformance.sort((a, b) => (a.price - b.price) * sortDir);
  }

  if (req.query.ratingSort) {
    const sortDir = req.query.ratingSort === "asc" ? 1 : -1;
    productsWithPerformance.sort(
      (a, b) =>
        ((a.performance?.rating || 0) - (b.performance?.rating || 0)) * sortDir
    );
  }

  // 🔹 Top selling sort (optional)
  if (isTopSelling) {
    productsWithPerformance.sort((a, b) => b.totalSold - a.totalSold);
  }

  res.status(200).json({
    status: "success",
    topSelling: isTopSelling,
    results: productsWithPerformance.length,
    page,
    limit,
    products: productsWithPerformance,
  });
});

// export const getSellerStoreProducts = catchAsync(async (req, res, next) => {
//   const { sellerId } = req.params;

//   const isTopSelling = req.query.topSelling === "true";
//   const page = req.query.page * 1 || 1;
//   const limit = req.query.limit * 1 || 10;

//   let productSalesMap = {};
//   let productIds = [];

//   const safeObjectId = (id) => {
//     if (mongoose.Types.ObjectId.isValid(id))
//       return new mongoose.Types.ObjectId(id);
//     return id;
//   };

//   // 🔹 Aggregate top selling if requested
//   if (isTopSelling) {
//     const topSelling = await Purchase.aggregate([
//       { $unwind: "$products" },
//       { $match: { "products.seller": safeObjectId(sellerId) } },
//       {
//         $group: {
//           _id: "$products.product",
//           totalQuantity: { $sum: "$products.quantity" },
//         },
//       },
//       { $sort: { totalQuantity: -1 } },
//       { $skip: (page - 1) * limit },
//       { $limit: limit },
//     ]);

//     productIds = topSelling.map((p) => p._id.toString());
//     topSelling.forEach((p) => {
//       productSalesMap[p._id.toString()] = p.totalQuantity;
//     });
//   } else {
//     const allSales = await Purchase.aggregate([
//       { $unwind: "$products" },
//       { $match: { "products.seller": safeObjectId(sellerId) } },
//       {
//         $group: {
//           _id: "$products.product",
//           totalQuantity: { $sum: "$products.quantity" },
//         },
//       },
//     ]);
//     allSales.forEach((p) => {
//       productSalesMap[p._id.toString()] = p.totalQuantity;
//     });
//   }

//   // 🔹 Base product query
//   let query = Product.find({ createdBy: sellerId });

//   // 🔹 Search by product name (fuzzy)
//   if (req.query.search) {
//     const searchRegex = new RegExp(req.query.search.split(" ").join("|"), "i");
//     query = query.find({ title: { $regex: searchRegex } });
//   }

//   // 🔹 Filter by category
//   if (req.query.categoryId) {
//     query = query.find({ category: req.query.categoryId });
//   }

//   // 🔹 Pagination
//   const skip = (page - 1) * limit;
//   query = query.skip(skip).limit(limit);

//   // 🔹 Populate seller & category
//   let products = await query
//     .populate({
//       path: "createdBy",
//       select:
//         "firstName middleName lastName profilePicture businessDetails sellerProfile",
//     })
//     .populate({
//       path: "category",
//       select: "name _id",
//     });

//   // 🔹 Fetch product performances
//   const allProductIds = products.map((p) => p._id);
//   const performances = await ProductPerformance.find({
//     product: { $in: allProductIds },
//   }).lean();

//   const performanceMap = {};
//   performances.forEach((p) => {
//     performanceMap[p.product.toString()] = p;
//   });

//   // 🔹 Build products with performance & seller info

//   let productsWithPerformance = products.map((p) => {
//     const seller = p.createdBy
//       ? {
//           _id: p.createdBy._id,
//           name: `${p.createdBy.firstName || ""} ${
//             p.createdBy.middleName || ""
//           } ${p.createdBy.lastName || ""}`
//             .replace(/\s+/g, " ")
//             .trim(),
//           profilePicture: p.createdBy.profilePicture || null,
//           shopName: p.createdBy.businessDetails?.businessName || null,
//           shopLocation: p.createdBy.businessDetails?.businessLocation || null,
//         }
//       : null;

//     const totalSold = productSalesMap[p._id.toString()] || 0;

//     return {
//       _id: p._id,
//       title: p.title,
//       description: p.description,
//       price: p.price,
//       originalPrice: p.originalPrice,
//       category: p.category
//         ? { _id: p.category._id, name: p.category.name }
//         : null,
//       stockQuantity: p.stockQuantity,
//       productImages: p.productImages || [],
//       tags: p.tags || [],
//       organic: p.organic,
//       featured: p.featured,
//       productType: p.productType,
//       status: p.status,
//       createdAt: p.createdAt,
//       updatedAt: p.updatedAt,
//       performance: performanceMap[p._id.toString()] || {
//         views: 0,
//         totalSales: totalSold,
//         rating: 0,
//         currentStock: p.stockQuantity || 0,
//       },
//       totalSold,
//       seller,
//     };
//   });

//   // 🔹 Sorting
//   if (req.query.priceSort) {
//     const sortDir = req.query.priceSort === "asc" ? 1 : -1;
//     productsWithPerformance.sort((a, b) => (a.price - b.price) * sortDir);
//   }

//   if (req.query.ratingSort) {
//     const sortDir = req.query.ratingSort === "asc" ? 1 : -1;
//     productsWithPerformance.sort(
//       (a, b) =>
//         ((a.performance?.rating || 0) - (b.performance?.rating || 0)) * sortDir
//     );
//   }

//   // 🔹 Top selling sort (optional)
//   if (isTopSelling) {
//     productsWithPerformance.sort((a, b) => b.totalSold - a.totalSold);
//   }

//   res.status(200).json({
//     status: "success",
//     topSelling: isTopSelling,
//     results: productsWithPerformance.length,
//     page,
//     limit,
//     products: productsWithPerformance,
//   });
// });

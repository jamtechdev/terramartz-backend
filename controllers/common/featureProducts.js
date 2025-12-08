import mongoose from "mongoose";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { Product } from "../../models/seller/product.js";
import { AdminSelection } from "../../models/super-admin/adminSelection.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { User } from "../../models/users.js";
import { getPresignedUrl } from "../../utils/awsS3.js";

export const getFeatureProducts = catchAsync(async (req, res, next) => {
  const usedProductIds = [];

  const mapProductWithCategory = async (
    product,
    performance,
    categoryTitle,
    seller
  ) => {
    if (!product) return null;
    const productObj = product.toObject ? product.toObject() : product;

    const productImagesWithUrls = await Promise.all(
      (productObj.productImages || []).map(async (image) => {
        return await getPresignedUrl(`products/${image}`);
      })
    );

    const sellerProfilePicture = seller?.profilePicture
      ? await getPresignedUrl(`profiles/${seller.profilePicture}`)
      : null;

    return {
      ...productObj,
      productImages: productImagesWithUrls,
      totalSales: performance?.totalSales || 0,
      totalQuantitySold: performance?.totalQuantitySold || 0,
      views: performance?.views || 0,
      rating: performance?.rating || 0,
      details: {
        ...productObj,
        productImages: productImagesWithUrls,
      },
      category_title: categoryTitle,
      shopSlug: seller?.sellerProfile?.shopSlug || null,
      sellerProfile: seller?.sellerProfile || null,
      profilePicture: seller?.profilePicture || null,
    };
  };

  // Helper to attach presigned URLs
  const attachPresignedUrls = async (product) => {
    if (!product) return null;

    // Product images
    if (product.productImages && product.productImages.length > 0) {
      product.productImages = await Promise.all(
        product.productImages.map((img) => getPresignedUrl(`products/${img}`))
      );
    }

    // Seller profilePicture
    if (product.profilePicture) {
      product.profilePicture = await getPresignedUrl(
        `profilePicture/${product.profilePicture}`
      );
    }

    // Seller shopPicture
    if (product.sellerProfile?.shopPicture) {
      product.sellerProfile.shopPicture = await getPresignedUrl(
        `shopPicture/${product.sellerProfile.shopPicture}`
      );
    }

    return product;
  };

  // Column 1: Best Seller
  const bestSellerAgg = await ProductPerformance.aggregate([
    {
      $lookup: {
        from: "products",
        localField: "product",
        foreignField: "_id",
        as: "details",
      },
    },
    { $unwind: "$details" },
    { $match: { "details.status": "active" } },
    { $sort: { totalSales: -1, views: -1, "details.createdAt": -1 } },
    { $limit: 1 },
    { $replaceRoot: { newRoot: { $mergeObjects: ["$details", "$$ROOT"] } } },
  ]);

  let seller1 = null;
  if (bestSellerAgg[0])
    seller1 = await User.findById(bestSellerAgg[0].createdBy).lean();
  let column1 = mapProductWithCategory(
    bestSellerAgg[0],
    bestSellerAgg[0],
    "Best Seller",
    seller1
  );
  column1 = await attachPresignedUrls(column1);
  if (column1) usedProductIds.push(column1._id);

  // Column 2: Top Rated
  const topRatedAgg = await ProductPerformance.aggregate([
    {
      $lookup: {
        from: "products",
        localField: "product",
        foreignField: "_id",
        as: "details",
      },
    },
    { $unwind: "$details" },
    { $match: { "details.status": "active", _id: { $nin: usedProductIds } } },
    { $sort: { rating: -1, totalQuantitySold: -1, "details.createdAt": -1 } },
    { $limit: 1 },
    { $replaceRoot: { newRoot: { $mergeObjects: ["$details", "$$ROOT"] } } },
  ]);

  let seller2 = null;
  if (topRatedAgg[0])
    seller2 = await User.findById(topRatedAgg[0].createdBy).lean();
  let column2 = mapProductWithCategory(
    topRatedAgg[0],
    topRatedAgg[0],
    "Top Rated",
    seller2
  );
  column2 = await attachPresignedUrls(column2);
  if (column2) usedProductIds.push(column2._id);

  // Column 3: Admin Selected / Best Seller Fallback
  let column3 = null;
  const latestAdmin = await AdminSelection.findOne(
    {},
    {},
    { sort: { createdAt: -1 } }
  );
  if (latestAdmin) {
    const product = await Product.findById(latestAdmin.productId).lean();
    const performance = await ProductPerformance.findOne({
      product: latestAdmin.productId,
    });
    let seller3 = null;
    if (product) seller3 = await User.findById(product.createdBy).lean();
    if (
      product &&
      product.status === "active" &&
      !usedProductIds.includes(product._id)
    ) {
      column3 = await mapProductWithCategory(
        product,
        performance,
        "Farmer's Choice",
        seller3
      );
      column3 = await attachPresignedUrls(column3);
      usedProductIds.push(column3._id);
    }
  }

  if (!column3) {
    const nextBestSellerAgg = await ProductPerformance.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "details",
        },
      },
      { $unwind: "$details" },
      { $match: { "details.status": "active", _id: { $nin: usedProductIds } } },
      { $sort: { totalSales: -1, views: -1, "details.createdAt": -1 } },
      { $limit: 1 },
      { $replaceRoot: { newRoot: { $mergeObjects: ["$details", "$$ROOT"] } } },
    ]);

    let seller3Fallback = null;
    if (nextBestSellerAgg[0])
      seller3Fallback = await User.findById(
        nextBestSellerAgg[0].createdBy
      ).lean();
    column3 = await mapProductWithCategory(
      nextBestSellerAgg[0],
      nextBestSellerAgg[0],
      "Best Seller",
      seller3Fallback
    );
    column3 = await attachPresignedUrls(column3);
    if (column3) usedProductIds.push(column3._id);
  }

  // Column 4: Smart / Dynamic / Top Rated Fallback
  let column4 = null;
  if (latestAdmin) {
    const secondAdmin = await AdminSelection.findOne(
      { _id: { $ne: latestAdmin._id } },
      {},
      { sort: { createdAt: -1 } }
    );
    if (secondAdmin) {
      const product = await Product.findById(secondAdmin.productId).lean();
      const performance = await ProductPerformance.findOne({
        product: secondAdmin.productId,
      });
      let seller4 = null;
      if (product) seller4 = await User.findById(product.createdBy).lean();
      if (
        product &&
        product.status === "active" &&
        !usedProductIds.includes(product._id)
      ) {
        column4 = await mapProductWithCategory(
          product,
          performance,
          "Farmer's Choice",
          seller4
        );
        column4 = await attachPresignedUrls(column4);
        usedProductIds.push(column4._id);
      }
    }
  }

  if (!column4) {
    const nextTopRatedAgg = await ProductPerformance.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "details",
        },
      },
      { $unwind: "$details" },
      { $match: { "details.status": "active", _id: { $nin: usedProductIds } } },
      { $sort: { rating: -1, totalQuantitySold: -1, "details.createdAt": -1 } },
      { $limit: 1 },
      { $replaceRoot: { newRoot: { $mergeObjects: ["$details", "$$ROOT"] } } },
    ]);

    let seller4Fallback = null;
    if (nextTopRatedAgg[0])
      seller4Fallback = await User.findById(
        nextTopRatedAgg[0].createdBy
      ).lean();
    column4 = await mapProductWithCategory(
      nextTopRatedAgg[0],
      nextTopRatedAgg[0],
      "Top Rated",
      seller4Fallback
    );
    column4 = await attachPresignedUrls(column4);
    if (column4) usedProductIds.push(column4._id);
  }

  res.status(200).json({
    status: "success",
    data: { column1, column2, column3, column4 },
  });
});

// export const getFeatureProducts = catchAsync(async (req, res, next) => {
//   const usedProductIds = [];

//   const mapProductWithCategory = (
//     product,
//     performance,
//     categoryTitle,
//     seller
//   ) => {
//     if (!product) return null;
//     const productObj = product.toObject ? product.toObject() : product;

//     return {
//       ...productObj,
//       totalSales: performance?.totalSales || 0,
//       totalQuantitySold: performance?.totalQuantitySold || 0,
//       views: performance?.views || 0,
//       rating: performance?.rating || 0,
//       details: { ...productObj },
//       category_title: categoryTitle,
//       shopSlug: seller?.sellerProfile?.shopSlug || null,
//     };
//   };

//   // Column 1: Best Seller
//   const bestSellerAgg = await ProductPerformance.aggregate([
//     {
//       $lookup: {
//         from: "products",
//         localField: "product",
//         foreignField: "_id",
//         as: "details",
//       },
//     },
//     { $unwind: "$details" },
//     { $match: { "details.status": "active" } },
//     { $sort: { totalSales: -1, views: -1, "details.createdAt": -1 } },
//     { $limit: 1 },
//     { $replaceRoot: { newRoot: { $mergeObjects: ["$details", "$$ROOT"] } } },
//   ]);

//   let seller1 = null;
//   if (bestSellerAgg[0])
//     seller1 = await User.findById(bestSellerAgg[0].createdBy).lean();
//   const column1 = mapProductWithCategory(
//     bestSellerAgg[0],
//     bestSellerAgg[0],
//     "Best Seller",
//     seller1
//   );
//   if (column1) usedProductIds.push(column1._id);

//   // Column 2: Top Rated
//   const topRatedAgg = await ProductPerformance.aggregate([
//     {
//       $lookup: {
//         from: "products",
//         localField: "product",
//         foreignField: "_id",
//         as: "details",
//       },
//     },
//     { $unwind: "$details" },
//     { $match: { "details.status": "active", _id: { $nin: usedProductIds } } },
//     { $sort: { rating: -1, totalQuantitySold: -1, "details.createdAt": -1 } },
//     { $limit: 1 },
//     { $replaceRoot: { newRoot: { $mergeObjects: ["$details", "$$ROOT"] } } },
//   ]);

//   let seller2 = null;
//   if (topRatedAgg[0])
//     seller2 = await User.findById(topRatedAgg[0].createdBy).lean();
//   const column2 = mapProductWithCategory(
//     topRatedAgg[0],
//     topRatedAgg[0],
//     "Top Rated",
//     seller2
//   );
//   if (column2) usedProductIds.push(column2._id);

//   // Column 3: Admin Selected / Best Seller Fallback
//   let column3 = null;
//   const latestAdmin = await AdminSelection.findOne(
//     {},
//     {},
//     { sort: { createdAt: -1 } }
//   );
//   if (latestAdmin) {
//     const product = await Product.findById(latestAdmin.productId).lean();
//     const performance = await ProductPerformance.findOne({
//       product: latestAdmin.productId,
//     });
//     let seller3 = null;
//     if (product) seller3 = await User.findById(product.createdBy).lean();
//     if (
//       product &&
//       product.status === "active" &&
//       !usedProductIds.includes(product._id)
//     ) {
//       column3 = mapProductWithCategory(
//         product,
//         performance,
//         "Farmer's Choice",
//         seller3
//       );
//       usedProductIds.push(column3._id);
//     }
//   }

//   if (!column3) {
//     const nextBestSellerAgg = await ProductPerformance.aggregate([
//       {
//         $lookup: {
//           from: "products",
//           localField: "product",
//           foreignField: "_id",
//           as: "details",
//         },
//       },
//       { $unwind: "$details" },
//       { $match: { "details.status": "active", _id: { $nin: usedProductIds } } },
//       { $sort: { totalSales: -1, views: -1, "details.createdAt": -1 } },
//       { $limit: 1 },
//       { $replaceRoot: { newRoot: { $mergeObjects: ["$details", "$$ROOT"] } } },
//     ]);

//     let seller3Fallback = null;
//     if (nextBestSellerAgg[0])
//       seller3Fallback = await User.findById(
//         nextBestSellerAgg[0].createdBy
//       ).lean();
//     column3 = mapProductWithCategory(
//       nextBestSellerAgg[0],
//       nextBestSellerAgg[0],
//       "Best Seller",
//       seller3Fallback
//     );
//     if (column3) usedProductIds.push(column3._id);
//   }

//   // Column 4: Smart / Dynamic / Top Rated Fallback
//   let column4 = null;
//   if (latestAdmin) {
//     const secondAdmin = await AdminSelection.findOne(
//       { _id: { $ne: latestAdmin._id } },
//       {},
//       { sort: { createdAt: -1 } }
//     );
//     if (secondAdmin) {
//       const product = await Product.findById(secondAdmin.productId).lean();
//       const performance = await ProductPerformance.findOne({
//         product: secondAdmin.productId,
//       });
//       let seller4 = null;
//       if (product) seller4 = await User.findById(product.createdBy).lean();
//       if (
//         product &&
//         product.status === "active" &&
//         !usedProductIds.includes(product._id)
//       ) {
//         column4 = mapProductWithCategory(
//           product,
//           performance,
//           "Farmer's Choice",
//           seller4
//         );
//         usedProductIds.push(column4._id);
//       }
//     }
//   }
//   if (!column4) {
//     const nextTopRatedAgg = await ProductPerformance.aggregate([
//       {
//         $lookup: {
//           from: "products",
//           localField: "product",
//           foreignField: "_id",
//           as: "details",
//         },
//       },
//       { $unwind: "$details" },
//       { $match: { "details.status": "active", _id: { $nin: usedProductIds } } },
//       { $sort: { rating: -1, totalQuantitySold: -1, "details.createdAt": -1 } },
//       { $limit: 1 },
//       { $replaceRoot: { newRoot: { $mergeObjects: ["$details", "$$ROOT"] } } },
//     ]);

//     let seller4Fallback = null;
//     if (nextTopRatedAgg[0])
//       seller4Fallback = await User.findById(
//         nextTopRatedAgg[0].createdBy
//       ).lean();
//     column4 = mapProductWithCategory(
//       nextTopRatedAgg[0],
//       nextTopRatedAgg[0],
//       "Top Rated",
//       seller4Fallback
//     );
//     if (column4) usedProductIds.push(column4._id);
//   }

//   res.status(200).json({
//     status: "success",
//     data: { column1, column2, column3, column4 },
//   });
// });

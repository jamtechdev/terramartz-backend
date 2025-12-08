import { Product } from "../../models/seller/product.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { User } from "../../models/users.js";
import { getPresignedUrl } from "../../utils/awsS3.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { getPresignedUrl } from "../../utils/awsS3.js";

export const getProductByProductSlug = catchAsync(async (req, res, next) => {
  const { productSlug } = req.params;

  // 🔹 Find product by slug + populate category
  let product = await Product.findOne({
    slug: { $regex: new RegExp(`^${productSlug}$`, "i") },
  }).populate({
    path: "category",
    select:
      "_id name description image logo createdBy createdAt updatedAt slug",
  });

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  // 🔹 Fetch product performance
  const performance = await ProductPerformance.findOne({
    product: product._id,
  }).lean();

  // 🔹 Fetch seller info
  const seller = await User.findById(product.createdBy);

  const sellerName = `${seller.firstName || ""} ${seller.middleName || ""} ${
    seller.lastName || ""
  }`
    .replace(/\s+/g, " ")
    .trim();

  // 🔹 Presigned URLs for seller images
  const sellerProfilePictureUrl = seller.profilePicture
    ? await getPresignedUrl(`profilePicture/${seller.profilePicture}`)
    : null;

  const shopPictureUrl = seller.sellerProfile?.shopPicture
    ? await getPresignedUrl(`shopPicture/${seller.sellerProfile.shopPicture}`)
    : null;

  const sellerInfo = {
    _id: seller._id,
    name: sellerName || null,
    profilePicture: sellerProfilePictureUrl,
    shopPicture: shopPictureUrl,
    shopName:
      seller.sellerProfile?.shopName ||
      seller.businessDetails?.businessName ||
      null,
    shopSlug: seller.sellerProfile?.shopSlug || null,
    shopLocation: seller.businessDetails?.businessLocation || null,
  };

  // 🔹 Presigned URLs for product images
  const productImagesWithUrls = await Promise.all(
    (product.productImages || []).map((img) =>
      getPresignedUrl(`products/${img}`)
    )
  );

  // 🔹 Presigned URLs for category images
  let categoryWithUrls = null;
  if (product.category) {
    const categoryImageUrl = product.category.image
      ? await getPresignedUrl(`categories/${product.category.image}`)
      : null;
    const categoryLogoUrl = product.category.logo
      ? await getPresignedUrl(`categories/${product.category.logo}`)
      : null;

    categoryWithUrls = {
      ...product.category.toObject(),
      image: categoryImageUrl,
      logo: categoryLogoUrl,
    };
  }

  // 🔹 Response (exactly same structure, only image URLs replaced)
  res.status(200).json({
    status: "success",
    product: {
      _id: product._id,
      title: product.title,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      category: categoryWithUrls,
      stockQuantity: product.stockQuantity,
      productImages: productImagesWithUrls,
      tags: product.tags || [],
      organic: product.organic,
      featured: product.featured,
      productType: product.productType,
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      performance: performance || {
        views: 0,
        totalSales: 0,
        rating: 0,
        currentStock: productCopy.stockQuantity || 0,
      },
      seller: sellerInfo,
    },
  });
});

// export const getProductByProductSlug = catchAsync(async (req, res, next) => {
//   const { productSlug } = req.params;

//   // 🔹 Find product by slug + populate category
//   let product = await Product.findOne({ slug: productSlug }).populate({
//     path: "category",
//     select:
//       "_id name description image logo createdBy createdAt updatedAt slug",
//   });

//   if (!product) {
//     return next(new AppError("Product not found", 404));
//   }

//   // 🔹 Fetch product performance
//   const performance = await ProductPerformance.findOne({
//     product: product._id,
//   }).lean();

//   // 🔹 Fetch seller info
//   const seller = await User.findById(product.createdBy);
//   const sellerName = `${seller.firstName || ""} ${seller.middleName || ""} ${
//     seller.lastName || ""
//   }`
//     .replace(/\s+/g, " ")
//     .trim();

//   const sellerInfo = {
//     _id: seller._id,
//     name: sellerName || null,
//     profilePicture: seller.profilePicture || null,
//     shopName:
//       seller.sellerProfile?.shopName ||
//       seller.businessDetails?.businessName ||
//       null,
//     shopSlug: seller.sellerProfile?.shopSlug || null,
//     shopLocation: seller.businessDetails?.businessLocation || null,
//   };

//   // 🔹 Response
//   res.status(200).json({
//     status: "success",
//     product: {
//       _id: product._id,
//       title: product.title,
//       slug: product.slug,
//       description: product.description,
//       price: product.price,
//       originalPrice: product.originalPrice,
//       category: product.category,
//       stockQuantity: product.stockQuantity,
//       productImages: product.productImages || [],
//       tags: product.tags || [],
//       organic: product.organic,
//       featured: product.featured,
//       productType: product.productType,
//       status: product.status,
//       createdAt: product.createdAt,
//       updatedAt: product.updatedAt,
//       performance: performance || {
//         views: 0,
//         totalSales: 0,
//         rating: 0,
//         currentStock: product.stockQuantity || 0,
//       },
//       seller: sellerInfo,
//     },
//   });
// });

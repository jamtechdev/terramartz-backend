import multer from "multer";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import slugify from "slugify";

import { Category } from "../../models/super-admin/category.js";
import { Product } from "../../models/seller/product.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { User } from "../../models/users.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import APIFeatures from "../../utils/apiFeatures.js";
import {
  uploadToS3,
  getPresignedUrl,
  deleteFileFromS3,
} from "../../utils/awsS3.js";

// Multer config (same as before)
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image")) cb(null, true);
  else cb(new AppError("Only image files are allowed!", 400), false);
};
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});
export const uploadCategoryFiles = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "logo", maxCount: 1 },
]);

// =================== 🔹 Create Category ===================
export const createCategory = catchAsync(async (req, res, next) => {
  const { name, description } = req.body;

  const exists = await Category.findOne({ name, createdBy: req.user._id });
  if (exists)
    return next(
      new AppError("You already have a category with this name.", 409)
    );

  let image = null;
  let logo = null;

  // 🔹 S3 upload (perfect quality & aspect ratio)
  if (req.files?.image) {
    const buffer = await sharp(req.files.image[0].buffer)
      .resize({ width: 500, height: 500, fit: "inside" }) // aspect ratio maintain
      .jpeg({ quality: 100 }) // maximum quality
      .toBuffer();

    const key = `${req.user._id}-${Date.now()}-image.jpeg`;
    await uploadToS3(buffer, `categories/${key}`, "image/jpeg");
    image = key;
  }

  if (req.files?.logo) {
    const buffer = await sharp(req.files.logo[0].buffer)
      .resize({ width: 500, height: 500, fit: "inside" }) // aspect ratio maintain
      .jpeg({ quality: 100 }) // maximum quality
      .toBuffer();

    const key = `${req.user._id}-${Date.now()}-logo.jpeg`;
    await uploadToS3(buffer, `categories/${key}`, "image/jpeg");
    logo = key;
  }

  const category = await Category.create({
    name,
    description,
    image,
    logo,
    createdBy: req.user._id,
  });

  // 🔹 Presigned URL generate
  const presignedImage = image
    ? await getPresignedUrl(`categories/${image}`)
    : null;
  const presignedLogo = logo
    ? await getPresignedUrl(`categories/${logo}`)
    : null;

  res.status(201).json({
    status: "success",
    message: "Category created successfully.",
    category: {
      ...category.toObject(),
      image: presignedImage,
      logo: presignedLogo,
    },
  });
});

// =================== 🔹 Update Category ===================
export const updateCategory = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id);
  if (!category) return next(new AppError("Category not found.", 404));

  if (
    category.createdBy.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    return next(
      new AppError("You do not have permission to update this category.", 403)
    );
  }

  category.name = req.body.name || category.name;
  category.description = req.body.description || category.description;

  // 🔹 S3 image update
  if (req.files?.image) {
    if (category.image) await deleteFileFromS3(`categories/${category.image}`);

    const buffer = await sharp(req.files.image[0].buffer)
      .resize(500, 500)
      .jpeg({ quality: 90 })
      .toBuffer();

    const key = `${req.user._id}-${Date.now()}-image.jpeg`;
    await uploadToS3(buffer, `categories/${key}`, "image/jpeg");
    category.image = key;
  }

  if (req.files?.logo) {
    if (category.logo) await deleteFileFromS3(`categories/${category.logo}`);

    const buffer = await sharp(req.files.logo[0].buffer)
      .resize(500, 500)
      .jpeg({ quality: 90 })
      .toBuffer();

    const key = `${req.user._id}-${Date.now()}-logo.jpeg`;
    await uploadToS3(buffer, `categories/${key}`, "image/jpeg");
    category.logo = key;
  }

  await category.save();

  // 🔹 Generate presigned URLs for response
  const imageUrl = category.image
    ? await getPresignedUrl(`categories/${category.image}`)
    : null;
  const logoUrl = category.logo
    ? await getPresignedUrl(`categories/${category.logo}`)
    : null;

  res.status(200).json({
    status: "success",
    message: "Category updated successfully.",
    category: {
      ...category.toObject(),
      image: imageUrl,
      logo: logoUrl,
    },
  });
});
// export const updateCategory = catchAsync(async (req, res, next) => {
//   const category = await Category.findById(req.params.id);
//   if (!category) return next(new AppError("Category not found.", 404));

//   if (
//     category.createdBy.toString() !== req.user._id.toString() &&
//     req.user.role !== "admin"
//   ) {
//     return next(
//       new AppError("You do not have permission to update this category.", 403)
//     );
//   }

//   category.name = req.body.name || category.name;
//   category.description = req.body.description || category.description;

//   // 🔹 S3 image update
//   if (req.files?.image) {
//     // Delete previous image from S3 if exists
//     if (category.image) await deleteFileFromS3(`categories/${category.image}`);

//     const buffer = await sharp(req.files.image[0].buffer)
//       .resize(500, 500)
//       .jpeg({ quality: 90 })
//       .toBuffer();

//     const key = `${req.user._id}-${Date.now()}-image.jpeg`;
//     await uploadToS3(buffer, `categories/${key}`, "image/jpeg");
//     category.image = key;
//   }

//   if (req.files?.logo) {
//     if (category.logo) await deleteFileFromS3(`categories/${category.logo}`);

//     const buffer = await sharp(req.files.logo[0].buffer)
//       .resize(500, 500)
//       .jpeg({ quality: 90 })
//       .toBuffer();

//     const key = `${req.user._id}-${Date.now()}-logo.jpeg`;
//     await uploadToS3(buffer, `categories/${key}`, "image/jpeg");
//     category.logo = key;
//   }

//   await category.save();

//   res.status(200).json({
//     status: "success",
//     message: "Category updated successfully.",
//     category,
//   });
// });

// =================== 🔹 Get All Categories ===================
export const getAllCategories = catchAsync(async (req, res, next) => {
  // Check if user is logged in (from optionalProtect middleware or query param)
  const isLoggedIn = req.user ? true : req.query.loggedIn === "true";
  
  let query = Category.find().populate("createdBy", "name email");
  const features = new APIFeatures(query, req.query).paginate();
  const categories = await features.query;

  // 🔹 Generate presigned URLs for image and logo
  const categoriesWithUrls = await Promise.all(
    categories.map(async (category) => {
      const categoryCopy = category.toObject();

      // if (categoryCopy.image) {
      //   categoryCopy.image = await getPresignedUrl(
      //     `categories/${categoryCopy.image}`
      //   );
      // }
      // if (categoryCopy.logo) {
      //   categoryCopy.logo = await getPresignedUrl(
      //     `categories/${categoryCopy.logo}`
      //   );
      // }

      return categoryCopy;
    })
  );

  res.status(200).json({
    status: "success",
    isLoggedIn: isLoggedIn, // Indicate if user is logged in
    user: req.user ? { id: req.user._id, name: req.user.name, email: req.user.email } : null, // User info if logged in
    total: categoriesWithUrls.length,
    page: req.query.page * 1 || 1,
    limit: req.query.limit * 1 || 100,
    categories: categoriesWithUrls,
  });
});

// =================== 🔹 Get Category by ID ===================
export const getCategory = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id).populate(
    "createdBy",
    "name email"
  );
  if (!category) return next(new AppError("Category not found.", 404));

  const categoryCopy = category.toObject();

  // 🔹 Generate presigned URLs for image and logo
  // if (categoryCopy.image) {
  //   categoryCopy.image = await getPresignedUrl(
  //     `categories/${categoryCopy.image}`
  //   );
  // }
  // if (categoryCopy.logo) {
  //   categoryCopy.logo = await getPresignedUrl(
  //     `categories/${categoryCopy.logo}`
  //   );
  // }

  res.status(200).json({
    status: "success",
    category: categoryCopy,
  });
});

// =================== 🔹 Delete Category ===================
export const deleteCategory = catchAsync(async (req, res, next) => {
  const category = await Category.findById(req.params.id);
  if (!category) return next(new AppError("Category not found.", 404));

  if (
    category.createdBy.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    return next(
      new AppError("You do not have permission to delete this category.", 403)
    );
  }

  // 🔹 Delete from S3 instead of local files
  if (category.image) await deleteFileFromS3(`categories/${category.image}`);
  if (category.logo) await deleteFileFromS3(`categories/${category.logo}`);

  await Category.findByIdAndDelete(req.params.id);

  res.status(200).json({
    status: "success",
    message: "Category deleted successfully.",
  });
});

// 127.0.0.1:7345/api/category/slug/fresh-fruit-vegetable?page=1&limit=10&search=ideal&productType=organic&priceMin=10&priceMax=700&featured=true&organic=true&sort=highestRated

export const getCategoryWithProductsAdvanced = catchAsync(
  async (req, res, next) => {
    const { slug } = req.params;

    // 1️⃣ Category info
    const category = await Category.findOne({ slug });
    if (!category) return next(new AppError("Category not found.", 404));

    // 🔹 S3: presigned URL for category image & logo
    const categoryCopy = category.toObject();
    if (categoryCopy.image) {
      categoryCopy.image = await getPresignedUrl(
        `categories/${categoryCopy.image}`
      );
    }
    if (categoryCopy.logo) {
      categoryCopy.logo = await getPresignedUrl(
        `categories/${categoryCopy.logo}`
      );
    }

    // 2️⃣ Build match object for aggregation
    let matchObj = { category: category._id, status: "active" };

    // 🔹 Filter by seller if seller is logged in and sellerOnly=true
    if (req.user && req.user.role === "seller" && req.query.sellerOnly === "true") {
      matchObj.createdBy = req.user._id;
      console.log("🔍 Filtering products for seller:", req.user._id);
    }

    // Search by title (minimum 2 letters)
    if (req.query.search && req.query.search.length >= 2) {
      const searchRegex = new RegExp(req.query.search, "i");
      matchObj.title = { $regex: searchRegex };
    }

    // Filter by productType
    if (req.query.productType) matchObj.productType = req.query.productType;

    // Price range filter
    if (req.query.priceMin || req.query.priceMax) {
      matchObj.price = {};
      if (req.query.priceMin) matchObj.price.$gte = Number(req.query.priceMin);
      if (req.query.priceMax) matchObj.price.$lte = Number(req.query.priceMax);
    }

    // Featured & organic filter
    if (req.query.featured === "true") matchObj.featured = true;
    if (req.query.organic === "true") matchObj.organic = true;

    // 3️⃣ Aggregation pipeline
    const pipeline = [
      { $match: matchObj },
      {
        $lookup: {
          from: "productperformances",
          localField: "_id",
          foreignField: "product",
          as: "performance",
        },
      },
      { $unwind: { path: "$performance", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          let: { sellerId: "$createdBy" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$sellerId"] } } },
            {
              $project: {
                _id: 1,
                "sellerProfile.shopName": 1,
                "sellerProfile.shopSlug": 1,
              },
            },
          ],
          as: "seller",
        },
      },
      { $unwind: { path: "$seller", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          seller: {
            _id: "$seller._id",
            shopName: "$seller.sellerProfile.shopName",
            shopSlug: "$seller.sellerProfile.shopSlug",
          },
        },
      },
      {
        $addFields: {
          score: {
            $add: [
              { $multiply: ["$performance.rating", 0.5] },
              { $multiply: ["$performance.totalSales", 0.3] },
              { $multiply: [{ $rand: {} }, 0.2] },
            ],
          },
        },
      },
      {
        // Ensure productImages field is included
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
          farmId: 1,
          farmName: 1,
          discount: 1,
          discountType: 1,
          discountExpires: 1,
          delivery: 1,
          performance: 1,
          seller: 1,
          score: 1,
        },
      },
    ];

    // Sorting by weighted score
    pipeline.push({ $sort: { score: -1 } });

    // Pagination
    const page = req.query.page * 1 || 1;
    const limit = req.query.limit * 1 || 10;
    const skip = (page - 1) * limit;
    pipeline.push({ $skip: skip }, { $limit: limit });

    let products = await Product.aggregate(pipeline);

    // 🔹 S3 presigned URLs for product images
    products = await Promise.all(
      products.map(async (prod) => {
        const prodCopy = { ...prod };

        // Debug: Log productImages before conversion
        if (!prodCopy.productImages || prodCopy.productImages.length === 0) {
          console.log(`⚠️ Product ${prodCopy._id} (${prodCopy.title}) has no productImages. Raw productImages:`, prodCopy.productImages);
        }

        if (prodCopy.productImages && Array.isArray(prodCopy.productImages) && prodCopy.productImages.length > 0) {
          prodCopy.productImages = await Promise.all(
            prodCopy.productImages.map(async (imgKey) => {
              try {
                const url = await getPresignedUrl(`products/${imgKey}`);
                return url;
              } catch (error) {
                console.error(`Error generating presigned URL for ${imgKey}:`, error);
                return null;
              }
            })
          );
          // Filter out any null values
          prodCopy.productImages = prodCopy.productImages.filter(url => url !== null);
        } else {
          // Ensure productImages is always an array
          prodCopy.productImages = [];
        }

        return prodCopy;
      })
    );

    // Shuffle products randomly
    function shuffleArray(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    }
    const shuffledProducts = shuffleArray(products);

    res.status(200).json({
      status: "success",
      category: categoryCopy,
      results: shuffledProducts.length,
      page,
      limit,
      products: shuffledProducts,
    });
  }
);

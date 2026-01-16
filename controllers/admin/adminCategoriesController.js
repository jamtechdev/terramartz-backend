
// import slugify from "slugify";
// import { Category } from "../../models/super-admin/category.js";
// import { Product } from "../../models/seller/product.js";
// import { ProductPerformance } from "../../models/seller/productPerformance.js";
// import { User } from "../../models/users.js";

// import catchAsync from "../../utils/catchasync.js";
// import AppError from "../../utils/apperror.js";
// import { uploadToS3 ,  deleteFileFromS3,getDirectUrl
// } from "../../utils/awsS3.js";
// export const getAllCategories = catchAsync(async (req, res) => {
//   const categories = await Category.find()
//     .select("name description slug image logo createdAt")
//     .sort({ createdAt: -1 });

//   const categoriesWithUrls = categories.map(cat => ({
//     ...cat.toObject(),
//     image: cat.image ? getDirectUrl(cat.image) : null,
//     logo: cat.logo ? getDirectUrl(cat.logo) : null,
//   }));

//   res.status(200).json({
//     status: "success",
//     results: categoriesWithUrls.length,
//     categories: categoriesWithUrls,
//   });
// });

// // CREATE CATEGORY


// export const createCategory = catchAsync(async (req, res, next) => {
//   const { name, description } = req.body;

//   if (!name) {
//     return next(new AppError("Category name is required", 400));
//   }

//   const slug = slugify(name, { lower: true });

//   let imageKey = null;

//   if (req.file) {
//     imageKey = `categories/${Date.now()}-${req.file.originalname}`;
//     await uploadToS3(
//       req.file.buffer,
//       imageKey,
//       req.file.mimetype
//     );
//   }

//   const category = await Category.create({
//     name,
//     description,
//     slug,
//     image: imageKey ? getDirectUrl(imageKey) : null,
//     createdBy: "admin",
//   });

//   res.status(201).json({
//     status: "success",
//     data: category,
//   });
// });

// // UPDATE CATEGORY
// export const updateCategory = catchAsync(async (req, res, next) => {
//   const { id } = req.params;

//   const category = await Category.findById(id);

//   if (!category) {
//     return next(new AppError("Category not found", 404));
//   }

//   // 🔁 Handle image update
//   if (req.file) {
//     // delete old image
//     if (category.image) {
//       await deleteFileFromS3(category.image);
//     }

//     const newKey = `categories/${Date.now()}-${req.file.originalname}`;
//     await uploadToS3(
//       req.file.buffer,
//       newKey,
//       req.file.mimetype
//     );

//     req.body.image = getDirectUrl(newKey);
//   }

//   // update slug if name changes
//   if (req.body.name) {
//     req.body.slug = slugify(req.body.name, { lower: true });
//   }

//   const updatedCategory = await Category.findByIdAndUpdate(
//     id,
//     req.body,
//     { new: true, runValidators: true }
//   );

//   res.status(200).json({
//     status: "success",
//     data: updatedCategory,
//   });
// });

// // DELETE CATEGORY
// export const deleteCategory = catchAsync(async (req, res, next) => {
//   const { id } = req.params;

//   const category = await Category.findById(id);

//   if (!category) {
//     return next(new AppError("Category not found", 404));
//   }

//   if (category.image) {
//     await deleteFileFromS3(category.image);
//   }

//   await category.deleteOne();

//   res.status(200).json({
//     status: "success",
//     message: "Category deleted successfully",
//   });
// });



import slugify from "slugify";
import { Category } from "../../models/super-admin/category.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { uploadToS3, deleteFileFromS3, getDirectUrl } from "../../utils/awsS3.js";

// ==========================
// GET ALL CATEGORIES
// ==========================
export const getAllCategories = catchAsync(async (req, res) => {
  const categories = await Category.find()
    .select("name description slug image logo createdAt")
    .sort({ createdAt: -1 });

  const categoriesWithUrls = categories.map(cat => ({
    ...cat.toObject(),
    image: cat.image ? getDirectUrl(cat.image) : null,
    logo: cat.logo ? getDirectUrl(cat.logo) : null,
  }));

  res.status(200).json({
    status: "success",
    results: categoriesWithUrls.length,
    categories: categoriesWithUrls,
  });
});

// ==========================
// CREATE CATEGORY
// ==========================
export const createCategory = catchAsync(async (req, res, next) => {
  const { name, description } = req.body;

  if (!name) return next(new AppError("Category name is required", 400));

  // Generate slug
  const slug = slugify(name, { lower: true, strict: true });

  // Handle image upload
  let imageKey = null;
  if (req.file) {
    imageKey = `categories/${Date.now()}-${req.file.originalname}`;
    await uploadToS3(req.file.buffer, imageKey, req.file.mimetype);
  }

  const category = await Category.create({
    name,
    description,
    slug,
    image: imageKey ? getDirectUrl(imageKey) : null,
    createdBy: "admin",
  });

  res.status(201).json({
    status: "success",
    data: category,
  });
});

// ==========================
// UPDATE CATEGORY
// ==========================
export const updateCategory = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const category = await Category.findById(id);
  if (!category) return next(new AppError("Category not found", 404));

  // Handle image update
  if (req.file) {
    if (category.image) {
      try {
        await deleteFileFromS3(category.image);
      } catch (err) {
        console.warn("Failed to delete old image:", err.message);
      }
    }

    const newKey = `categories/${Date.now()}-${req.file.originalname}`;
    await uploadToS3(req.file.buffer, newKey, req.file.mimetype);
    req.body.image = getDirectUrl(newKey);
  }

  // Update slug if name changes
  if (req.body.name) {
    req.body.slug = slugify(req.body.name, { lower: true, strict: true });
  }

  const updatedCategory = await Category.findByIdAndUpdate(
    id,
    req.body,
    { new: true, runValidators: true }
  );

  res.status(200).json({
    status: "success",
    data: updatedCategory,
  });
});

// ==========================
// DELETE CATEGORY
// ==========================
export const deleteCategory = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const category = await Category.findById(id);
  if (!category) return next(new AppError("Category not found", 404));

  // Delete image from S3
  if (category.image) {
    try {
      await deleteFileFromS3(category.image);
    } catch (err) {
      console.warn("Failed to delete S3 image:", err.message);
    }
  }

  await category.deleteOne();

  res.status(200).json({
    status: "success",
    message: "Category deleted successfully",
  });
});

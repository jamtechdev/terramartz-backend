import { BlogCategory } from "../../models/super-admin/blogCategory.js";
import AppError from "../../utils/apperror.js";
import catchAsync from "../../utils/catchasync.js";
import APIFeatures from "../../utils/apiFeatures.js";

export const createBlogCategory = catchAsync(async (req, res, next) => {
  const newCategory = await BlogCategory.create(req.body);

  res.status(201).json({
    status: "success",
    data: {
      category: newCategory,
    },
  });
});

export const getAllBlogCategories = catchAsync(async (req, res, next) => {
  const { search, status, page = 1, limit = 10 } = req.query;
  const pageNum = Number(page);
  const limitNum = Number(limit);
  const skip = (pageNum - 1) * limitNum;

  const match = {};
  if (status) match.status = status;

  if (search) {
    const words = String(search).trim().split(/\s+/);
    match.$and = words.map((word) => {
      const regex = new RegExp(word, "i");
      return {
        $or: [{ name: regex }, { slug: regex }],
      };
    });
  }

  const total = await BlogCategory.countDocuments(match);

  const categories = await BlogCategory.find(match)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum);

  res.status(200).json({
    status: "success",
    page: pageNum,
    limit: limitNum,
    total,
    results: categories.length,
    data: {
      categories,
    },
  });
});

export const getBlogCategory = catchAsync(async (req, res, next) => {
  const category = await BlogCategory.findById(req.params.id);

  if (!category) {
    return next(new AppError("No category found with that ID", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      category,
    },
  });
});

export const updateBlogCategory = catchAsync(async (req, res, next) => {
  const category = await BlogCategory.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!category) {
    return next(new AppError("No category found with that ID", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      category,
    },
  });
});

export const deleteBlogCategory = catchAsync(async (req, res, next) => {
  const category = await BlogCategory.findByIdAndDelete(req.params.id);

  if (!category) {
    return next(new AppError("No category found with that ID", 404));
  }

  res.status(204).json({
    status: "success",
    data: null,
  });
});

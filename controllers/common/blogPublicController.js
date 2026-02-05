import { Blog } from "../../models/super-admin/blog.js";
import { BlogCategory } from "../../models/super-admin/blogCategory.js";
import AppError from "../../utils/apperror.js";
import catchAsync from "../../utils/catchasync.js";
import APIFeatures from "../../utils/apiFeatures.js";

export const getAllBlogsPublic = catchAsync(async (req, res, next) => {
  // Only published blogs
  let filter = { status: "published" };

  // Handle category filter by slug
  if (req.query.category) {
    const category = await BlogCategory.findOne({ slug: req.query.category });
    if (category) {
      filter.category = category._id;
    } else {
      // If category not found, return empty
      return res.status(200).json({
        status: "success",
        results: 0,
        data: { blogs: [] },
      });
    }
    // Remove category from query string to avoid interfering with APIFeatures
    delete req.query.category;
  }

  // Handle tag filter
  if (req.query.tag) {
    filter.tags = { $in: [req.query.tag] };
    delete req.query.tag;
  }
  
  // Handle text search
  if (req.query.search) {
     filter.$text = { $search: req.query.search };
     // APIFeatures has a specific search implementation for name/email/phone, so we handle text search here manually in the filter
     delete req.query.search;
  }

  const features = new APIFeatures(Blog.find(filter), req.query)
    .sort()
    .limitFields()
    .paginate();

  const blogs = await features.query.populate("category", "name slug").populate("createdBy", "name");

  res.status(200).json({
    status: "success",
    results: blogs.length,
    data: {
      blogs,
    },
  });
});

export const getBlogBySlug = catchAsync(async (req, res, next) => {
  const blog = await Blog.findOne({ slug: req.params.slug, status: "published" })
    .populate("category", "name slug")
    .populate("createdBy", "name");

  if (!blog) {
    return next(new AppError("Blog not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      blog,
    },
  });
});

export const getAllCategoriesPublic = catchAsync(async (req, res, next) => {
  const categories = await BlogCategory.find({ status: "active" }).select("name slug");

  res.status(200).json({
    status: "success",
    results: categories.length,
    data: {
      categories,
    },
  });
});

import { Blog } from "../../models/super-admin/blog.js";
import AppError from "../../utils/apperror.js";
import catchAsync from "../../utils/catchasync.js";
import APIFeatures from "../../utils/apiFeatures.js";

export const createBlog = catchAsync(async (req, res, next) => {
  req.body.createdBy = req.user.id;
  
  const newBlog = await Blog.create(req.body);

  res.status(201).json({
    status: "success",
    data: {
      blog: newBlog,
    },
  });
});

export const getAllBlogsAdmin = catchAsync(async (req, res, next) => {
  const { search, status, category, createdBy, page = 1, limit = 10 } = req.query;
  const pageNum = Number(page);
  const limitNum = Number(limit);
  const skip = (pageNum - 1) * limitNum;

  const match = {};
  if (status) match.status = status;
  if (category) match.category = category;
  if (createdBy) match.createdBy = createdBy;

  if (search) {
    const words = String(search).trim().split(/\s+/);
    match.$and = words.map((word) => {
      const regex = new RegExp(word, "i");
      return {
        $or: [
          { title: regex },
          { shortDescription: regex },
          { content: regex },
          { tags: { $in: [regex] } },
        ],
      };
    });
  }

  const total = await Blog.countDocuments(match);

  const blogs = await Blog.find(match)
    .populate("category", "name slug")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum);

  res.status(200).json({
    status: "success",
    page: pageNum,
    limit: limitNum,
    total,
    results: blogs.length,
    data: {
      blogs,
    },
  });
});



export const getBlogAdmin = catchAsync(async (req, res, next) => {
  const blog = await Blog.findById(req.params.id).populate("category", "name slug");

  if (!blog) {
    return next(new AppError("No blog found with that ID", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      blog,
    },
  });
});

export const updateBlog = catchAsync(async (req, res, next) => {
  const blog = await Blog.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!blog) {
    return next(new AppError("No blog found with that ID", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      blog,
    },
  });
});

export const updateFullBlog = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  
  // Check if blog exists
  const existingBlog = await Blog.findById(id);
  if (!existingBlog) {
    return next(new AppError("No blog found with that ID", 404));
  }

  // Add metadata
  req.body.updatedBy = req.user.id;
  req.body.updatedAt = new Date();
  
  // Replace entire blog document
  const updatedBlog = await Blog.findByIdAndUpdate(
    id,
    { $set: req.body },
    {
      new: true,
      runValidators: true,
      overwrite: true
    }
  ).populate("category", "name slug");

  res.status(200).json({
    status: "success",
    data: {
      blog: updatedBlog,
    },
  });
});

export const deleteBlog = catchAsync(async (req, res, next) => {
  const blog = await Blog.findByIdAndDelete(req.params.id);

  if (!blog) {
    return next(new AppError("No blog found with that ID", 404));
  }

  res.status(204).json({
    status: "success",
    data: null,
  });
});

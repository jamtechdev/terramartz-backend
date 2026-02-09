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

// export const getAllBlogsAdmin = catchAsync(async (req, res, next) => {
//   const features = new APIFeatures(Blog.find(), req.query)
//     .filter()
//     .sort()
//     .limitFields()
//     .paginate();

//   const blogs = await features.query.populate("category", "name slug");

//   res.status(200).json({
//     status: "success",
//     results: blogs.length,
//     data: {
//       blogs,
//     },
//   });
// });

export const getAllBlogsAdmin = catchAsync(async (req, res, next) => {
  // Pagination values
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;

  // Total documents (without pagination)
  const total = await Blog.countDocuments();

  // Apply features
  const features = new APIFeatures(Blog.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const blogs = await features.query.populate("category", "name slug");

  res.status(200).json({
    status: "success",
    page,
    limit,
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

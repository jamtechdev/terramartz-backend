import { Faq } from "../../models/super-admin/faq.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

// ✅ Create FAQ
export const createFaq = catchAsync(async (req, res, next) => {
  const { question, answer } = req.body;

  if (!question || !answer) {
    return next(new AppError("Question and Answer are required!", 400));
  }

  const faq = await Faq.create({
    question,
    answer,
    createdBy: req.user ? req.user.id : null,
  });

  res.status(201).json({
    status: "success",
    message: "FAQ created successfully!",
    data: faq,
  });
});

// ✅ Get all FAQs for Public (Active Only)
export const getAllFaqs = catchAsync(async (req, res, next) => {
  const faqs = await Faq.find({ isActive: true }).sort({ createdAt: -1 });

  res.status(200).json({
    status: "success",
    results: faqs.length,
    data: faqs,
  });
});

// ✅ Get all FAQs for Admin (with search, filter, pagination)
export const adminGetAllFaqs = catchAsync(async (req, res, next) => {
  const { search, isActive, page = 1, limit = 10 } = req.query;

  const query = {};

  // 1. Search by Question or Answer
  if (search) {
    query.$or = [
      { question: { $regex: search, $options: "i" } },
      { answer: { $regex: search, $options: "i" } },
    ];
  }

  // 2. Filter by Status (isActive)
  if (isActive !== undefined && isActive !== "all") {
    query.isActive = isActive === "true";
  }

  // 3. Pagination limits
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const total = await Faq.countDocuments(query);

  const faqs = await Faq.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  res.status(200).json({
    status: "success",
    results: faqs.length,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(total / limit),
    data: faqs,
  });
});

// ✅ Get single FAQ by ID
export const getFaqById = catchAsync(async (req, res, next) => {
  const faq = await Faq.findById(req.params.id);

  if (!faq) {
    return next(new AppError("No FAQ found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    data: faq,
  });
});

// ✅ Update FAQ
export const updateFaq = catchAsync(async (req, res, next) => {
  const faq = await Faq.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!faq) {
    return next(new AppError("No FAQ found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    message: "FAQ updated successfully!",
    data: faq,
  });
});

// ✅ Delete FAQ
export const deleteFaq = catchAsync(async (req, res, next) => {
  const faq = await Faq.findByIdAndDelete(req.params.id);

  if (!faq) {
    return next(new AppError("No FAQ found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    message: "FAQ deleted successfully!",
  });
});

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

// ✅ Get all FAQs
export const getAllFaqs = catchAsync(async (req, res, next) => {
  const faqs = await Faq.find({ isActive: true }).sort({ createdAt: -1 });

  res.status(200).json({
    status: "success",
    results: faqs.length,
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

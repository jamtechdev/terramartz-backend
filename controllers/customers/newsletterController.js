import { Newsletter } from "../../models/customers/newsletter.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import APIFeatures from "../../utils/apiFeatures.js";

// POST - Subscribe to Newsletter (Public - No Auth Required)
export const subscribe = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email) return next(new AppError("Email is required", 400));

  const exists = await Newsletter.findOne({ email });
  if (exists) return next(new AppError("Already subscribed", 409));

  await Newsletter.create({ email });

  res.status(201).json({
    status: "success",
    message: "Subscribed successfully!",
  });
});

// GET - Get All Newsletter Subscribers (Authenticated - Admin/Seller Only)
export const getAllSubscribers = catchAsync(async (req, res, next) => {
  const features = new APIFeatures(Newsletter.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const subscribers = await features.query;

  const total = await Newsletter.countDocuments(features.queryString);

  res.status(200).json({
    status: "success",
    results: subscribers.length,
    total,
    data: {
      subscribers,
    },
  });
});

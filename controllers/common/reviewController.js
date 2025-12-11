import mongoose from "mongoose";

import { Review } from "./../../models/common/review.js";
import { Product } from "./../../models/seller/product.js";
import { ProductPerformance } from "./../../models/seller/productPerformance.js";
import { Purchase } from "./../../models/customers/purchase.js";

import catchAsync from "./../../utils/catchasync.js";
import AppError from "./../../utils/apperror.js";
import APIFeatures from "./../../utils/apiFeatures.js";

// ====================== CREATE REVIEW ======================
export const createReview = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId, rating, message } = req.body;
    const userId = req.user._id;

    // 1️⃣ Check product exists
    const product = await Product.findById(productId).session(session);
    if (!product) throw new AppError("Product not found.", 404);

    // 1.5️⃣ Check if user is the seller (can't review own product)
    const userIdString = String(userId);
    const productSellerId = String(product.createdBy);
    if (userIdString === productSellerId) {
      throw new AppError("You cannot review your own product.", 403);
    }

    // 2️⃣ Check if user purchased the product
    const purchased = await Purchase.findOne({
      buyer: userId,
      "products.product": productId,
    }).session(session);

    if (!purchased)
      throw new AppError(
        "You cannot review this product without purchasing it.",
        400
      );

    // 3️⃣ Check if already reviewed
    const existingReview = await Review.findOne({
      product: productId,
      user: userId,
    }).session(session);
    if (existingReview)
      throw new AppError("You already reviewed this product.", 400);

    // 4️⃣ Create review
    const [review] = await Review.create(
      [
        {
          product: productId,
          user: userId,
          rating,
          message,
        },
      ],
      { session }
    );

    // 5️⃣ Calculate average rating
    const reviews = await Review.find({ product: productId }).session(session);
    const totalReviews = reviews.length;
    const averageRating =
      reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews;

    // 6️⃣ Update ProductPerformance
    let performance = await ProductPerformance.findOne({
      product: productId,
    }).session(session);

    if (!performance) {
      performance = new ProductPerformance({
        product: productId,
        totalSales: 0,
        views: 0,
        rating: averageRating,
        currentStock: product.stockQuantity,
      });
    } else {
      performance.rating = averageRating;
    }

    await performance.save({ session });

    // 7️⃣ Commit transaction
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      status: "Success",
      message: "Review added successfully.",
      review,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(error);
  }
});

// ====================== GET PRODUCT REVIEWS ======================

export const getProductReviews = catchAsync(async (req, res, next) => {
  const { productId } = req.params;

  // Query: product-এর সব reviews
  const query = Review.find({ product: productId }).populate(
    "user",
    "firstName middleName lastName email profilePicture"
  );

  // Pagination
  const features = new APIFeatures(query, req.query).paginate();
  const reviews = await features.query;

  // Calculate average rating
  const allReviews = await Review.find({ product: productId });
  const totalCount = allReviews.length;
  const avgRating = totalCount > 0
    ? allReviews.reduce((sum, r) => sum + r.rating, 0) / totalCount
    : 0;

  res.status(200).json({
    status: "Success",
    count: reviews.length,
    totalCount,
    averageRating: avgRating,
    currentPage: req.query.page * 1 || 1,
    reviews: reviews || [],
  });
});

// ====================== UPDATE REVIEW ======================
export const updateReview = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reviewId } = req.params;
    const { rating, message } = req.body;
    const userId = req.user._id;

    // Find review
    const review = await Review.findOne({
      _id: reviewId,
      user: userId,
    }).session(session);

    if (!review) {
      throw new AppError("Review not found or you don't have permission to edit it.", 404);
    }

    // Update review
    if (rating !== undefined) review.rating = rating;
    if (message !== undefined) review.message = message;
    await review.save({ session });

    // Recalculate average rating
    const allReviews = await Review.find({ product: review.product }).session(session);
    const totalReviews = allReviews.length;
    const averageRating = totalReviews > 0
      ? allReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
      : 0;

    // Update ProductPerformance
    let performance = await ProductPerformance.findOne({
      product: review.product,
    }).session(session);

    if (performance) {
      performance.rating = averageRating;
      await performance.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: "Success",
      message: "Review updated successfully.",
      review,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(error);
  }
});

// ====================== DELETE REVIEW ======================
export const deleteReview = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reviewId } = req.params;
    const userId = req.user._id;

    // Find review
    const review = await Review.findOne({
      _id: reviewId,
      user: userId,
    }).session(session);

    if (!review) {
      throw new AppError("Review not found or you don't have permission to delete it.", 404);
    }

    const productId = review.product;

    // Delete review
    await Review.findByIdAndDelete(reviewId).session(session);

    // Recalculate average rating
    const allReviews = await Review.find({ product: productId }).session(session);
    const totalReviews = allReviews.length;
    const averageRating = totalReviews > 0
      ? allReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
      : 0;

    // Update ProductPerformance
    let performance = await ProductPerformance.findOne({
      product: productId,
    }).session(session);

    if (performance) {
      performance.rating = averageRating;
      await performance.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: "Success",
      message: "Review deleted successfully.",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(error);
  }
});

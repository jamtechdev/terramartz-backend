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

  if (!reviews || reviews.length === 0) {
    return next(new AppError("No reviews found for this product.", 404));
  }

  res.status(200).json({
    status: "Success",
    count: reviews.length,
    currentPage: req.query.page * 1 || 1,
    reviews,
  });
});

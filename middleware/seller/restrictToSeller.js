import AppError from "../../utils/apperror.js";
import { Review } from "../../models/common/review.js";
import { Product } from "../../models/seller/product.js";

// শুধু seller role এর জন্য
export const restrictToSeller = (req, res, next) => {
  if (!req.user || req.user.role !== "seller") {
    return next(
      new AppError("Only sellers are allowed to perform this action", 403)
    );
  }
  next();
};

export const isProductOwnerWithReviewReply = async (req, res, next) => {
  try {
    const { reviewId } = req.params;

    // Step 1: Review খুঁজে বের করো
    const review = await Review.findById(reviewId);
    if (!review) {
      return next(new AppError("Review not found.", 404));
    }

    // Step 2: Product খুঁজে বের করো
    const product = await Product.findById(review.product);
    if (!product) {
      return next(new AppError("Product not found.", 404));
    }

    // Step 3: User কি product owner?
    if (product.createdBy.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Only product owner can reply to reviews." });
    }

    // সব ঠিক থাকলে next()
    next();
  } catch (error) {
    console.error(error);
    return next(new AppError("Server error", 500));
  }
};

import { Review } from "../../models/common/review.js";
import { getPresignedUrl } from "../../utils/awsS3.js";
import APIFeatures from "../../utils/apiFeatures.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

// 🔹 Get all reviews of the currently logged-in user

export const getCustomerReviews = catchAsync(async (req, res, next) => {
  const userKeys = [
    ...new Set(
      [req.user._id, req.user.id].filter(Boolean).map((x) => String(x)),
    ),
  ];

  // ✅ Step 1: Base Query — logged-in user (string/ObjectId-shaped ids)
  let query = Review.find({ user: { $in: userKeys } });

  // ✅ Step 2: Filtering, Sorting, Pagination
  const features = new APIFeatures(query, req.query).filter().sort().paginate();

  const reviews = await features.query
    .populate({
      path: "product",
      select: "title slug price productImages",
    })
    .lean();

  // ✅ Step 3: Check if reviews exist
  if (!reviews || reviews.length === 0) {
    return next(new AppError("No reviews found for this user.", 404));
  }

  // 🔥 New Step: Apply Presigned URLs to productImages
  const reviewsWithPresigned = await Promise.all(
    reviews.map(async (r) => {
      let presignedImages = [];

      if (r?.product?.productImages?.length) {
        presignedImages = await Promise.all(
          r.product.productImages.map(async (imgKey) => {
            const url = await getPresignedUrl(`products/${imgKey}`);
            return url || imgKey; // fallback
          })
        );
      }

      return {
        ...r,
        product: {
          ...r.product,
          productImages: presignedImages, // Replace images with presigned URLs
        },
      };
    })
  );

  // ✅ Step 4: Get total count for pagination info
  const totalReviews = await Review.countDocuments({ user: { $in: userKeys } });

  // ✅ Step 5: Send Response (structure unchanged)
  res.status(200).json({
    status: "success",
    message: "Customer reviews fetched successfully.",
    results: reviewsWithPresigned.length,
    totalReviews,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
    reviews: reviewsWithPresigned.map((r) => ({
      _id: r._id,
      rating: r.rating,
      review: r.message || null, // <-- unchanged
      createdAt: r.createdAt,
      product: {
        _id: r.product?._id || null,
        title: r.product?.title || null,
        slug: r.product?.slug || null,
        price: r.product?.price || null,
        images: r.product?.productImages || [], // <-- SAME structure, now presigned
      },
    })),
  });
});

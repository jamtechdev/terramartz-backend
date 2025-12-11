import express from "express";
import {
  createReview,
  getProductReviews,
  updateReview,
  deleteReview,
} from "../../controllers/common/reviewController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

// Create review
router.post("/", protect, createReview);

// Get reviews for a product
router.get("/products/:productId", getProductReviews);

// Update review
router.patch("/:reviewId", protect, updateReview);

// Delete review
router.delete("/:reviewId", protect, deleteReview);

export default router;

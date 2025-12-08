import express from "express";
import {
  createReview,
  getProductReviews,
} from "../../controllers/common/reviewController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

// Create review
router.post("/", protect, createReview);

// Get reviews for a product
router.get("/products/:productId", getProductReviews);

export default router;

// Promo Code routes for CRUD operations
import express from "express";
const router = express.Router();

import {
  createPromoCode,
  getAllPromoCodes,
  getPromoCode,
  updatePromoCode,
  deletePromoCode,
  validatePromoCode,
  applyPromoCode,
  getPromoCodeUsage,
} from "../../controllers/sellers/promoCodeController.js";
import { protect } from "../../controllers/authController.js";

// Create a new promo code seller)
router.post("/", protect, createPromoCode);

// Get list of promo codes seller)
router.get("/", protect, getAllPromoCodes);

// Get a single promo code by ID
router.get("/:id", protect, getPromoCode);

// Update a promo code by ID
router.patch("/:id", protect, updatePromoCode);

// Delete a promo code by ID
router.delete("/:id", protect, deletePromoCode);

// Validate promo code (no auth required)
router.post("/validate", protect, validatePromoCode);

// Apply promo code (customers only)
router.post("/apply", protect, applyPromoCode);

// Get promo code usage statistics
router.get("/:id/usage", protect, getPromoCodeUsage);

export default router;

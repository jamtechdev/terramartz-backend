// Promo Code routes for CRUD operations
import express from "express";
const router = express.Router();

import {
  createPromoCode,
  getAllPromoCodes,
  getPromoCode,
  updatePromoCode,
  deletePromoCode,
} from "../../controllers/sellers/promoCodeController.js";
import { protect } from "../../controllers/authController.js";

// Create a new promo code (admin or seller)
router.post("/", protect, createPromoCode);

// Get list of promo codes (admin or seller)
router.get("/", protect, getAllPromoCodes);

// Get a single promo code by ID
router.get("/:id", protect, getPromoCode);

// Update a promo code by ID
router.patch("/:id", protect, updatePromoCode);

// Delete a promo code by ID
router.delete("/:id", protect, deletePromoCode);

export default router;

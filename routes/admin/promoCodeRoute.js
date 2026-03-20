// Promo Code Admin Routes - CRUD operations only
import express from "express";
const router = express.Router();

import {
  createPromoCode,
  getAllPromoCodes,
  getPromoCode,
  updatePromoCode,
  deletePromoCode,
  getPromoCodeUsage,
} from "../../controllers/admin/promoCodeController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

// Admin-only: Create, list, update, delete promo codes
router.post("/", protectAdmin("Promo Codes", "Full"), createPromoCode);
router.get("/", protectAdmin("Promo Codes", "View"), getAllPromoCodes);
router.get("/:id", protectAdmin("Promo Codes", "View"), getPromoCode);
router.patch("/:id", protectAdmin("Promo Codes", "Full"), updatePromoCode);
router.delete("/:id", protectAdmin("Promo Codes", "Full"), deletePromoCode);
router.get("/:id/usage", protectAdmin("Promo Codes", "View"), getPromoCodeUsage);

export default router;

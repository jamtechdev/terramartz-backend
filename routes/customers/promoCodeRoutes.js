// Promo Code Customer Routes - Validate and Apply only
import express from "express";
const router = express.Router();

import {
  validatePromoCode,
  applyPromoCode,
} from "../../controllers/admin/promoCodeController.js";
import { protect } from "../../controllers/authController.js";

// Customer-only: Validate and apply promo codes
router.post("/validate", protect, validatePromoCode);
router.post("/apply", protect, applyPromoCode);

export default router;

import express from "express";
const router = express.Router();

import * as taxController from "../../controllers/super-admin/taxWithAdminDiscountController.js";
import {
  selectFeatureProduct,
  deleteFeatureProduct,
} from "../../controllers/super-admin/adminSelectionController.js";
import { protect } from "../../controllers/authController.js";
import { restrictToAdmin } from "../../middleware/super-admin/restrictToAdmin.js";
import {
  createFaq,
  updateFaq,
  deleteFaq,
} from "../../controllers/super-admin/faqController.js";

router.post(
  "/active-tax-with-dicount",
  protect,
  restrictToAdmin,
  taxController.updateTaxRate
);
router.get("/active-tax-with-dicount", taxController.getActiveTax);
router.post(
  "/select-feature-product",
  protect,
  restrictToAdmin,
  selectFeatureProduct
);
router.delete(
  "/select-feature-product",
  protect,
  restrictToAdmin,
  deleteFeatureProduct
);

// faq related apis code start

router.post("/faqs", protect, restrictToAdmin, createFaq);
router.patch("/faqs/:id", protect, restrictToAdmin, updateFaq);
router.delete("/faqs/:id", protect, restrictToAdmin, deleteFaq);
// faq related apis code end

export default router;

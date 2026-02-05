import express from "express";
const router = express.Router();

import * as adminCategoryController from "../../controllers/admin/adminCategoriesController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";
import { upload } from "../../middleware/admin/upload.js";

// 🔐 ADMIN
router.get("/", adminCategoryController.getAllCategories);
router.post(
  "/",
  protectAdmin("Settings", "View"),
  upload.single("image"),
  adminCategoryController.createCategory,
);
router.patch(
  "/:id",
  protectAdmin("Settings", "View"),
  upload.single("image"),
  adminCategoryController.updateCategory,
);
router.delete(
  "/:id",
  protectAdmin("Settings", "View"),
  adminCategoryController.deleteCategory,
);
router.patch(
  "/:id/toggle-is-active",
  protectAdmin("Settings", "View"),
  adminCategoryController.toggleCategoryIsActive,
);

export default router;

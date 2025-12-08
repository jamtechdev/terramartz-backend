import express from "express";
const router = express.Router();

import * as categoryController from "../../controllers/super-admin/categoryController.js";
import { protect } from "../../controllers/authController.js";
import { restrictToAdmin } from "../../middleware/super-admin/restrictToAdmin.js";

router.post(
  "/",
  protect,
  restrictToAdmin,
  categoryController.uploadCategoryFiles,
  categoryController.createCategory
);

router.patch(
  "/:id",
  protect,
  restrictToAdmin,
  categoryController.uploadCategoryFiles,
  categoryController.updateCategory
);

router.get("/", categoryController.getAllCategories);
router.get("/:id", categoryController.getCategory);

router.delete(
  "/:id",
  protect,
  restrictToAdmin,
  categoryController.deleteCategory
);

export default router;

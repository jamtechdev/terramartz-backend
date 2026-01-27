import express from "express";
const router = express.Router();

import * as adminCategoryController 
  from "../../controllers/admin/adminCategoriesController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";
import { upload } from "../../middleware/admin/upload.js";


// 🔐 ADMIN
router.get("/",
      protectAdmin('Orders', 'View'), 
     adminCategoryController.getAllCategories);
router.post("/",
     protectAdmin,
         upload.single("image"),
      adminCategoryController.createCategory);
router.patch("/:id",
     protectAdmin,
         upload.single("image"),
      adminCategoryController.updateCategory);
router.delete("/:id",
     protectAdmin,
      adminCategoryController.deleteCategory);

export default router;

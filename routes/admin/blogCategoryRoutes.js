import express from "express";
import { protectAdmin } from "../../controllers/common/admin/authController.js";
import {
  createBlogCategory,
  getAllBlogCategories,
  getBlogCategory,
  updateBlogCategory,
  deleteBlogCategory,
} from "../../controllers/admin/blogCategoryController.js";

const router = express.Router();

// Protect all routes
router.use(protectAdmin("Blogs", "View"));

router
  .route("/")
  .get(getAllBlogCategories)
  .post(protectAdmin("Blogs", "Full"), createBlogCategory);

router
  .route("/:id")
  .get(getBlogCategory)
  .patch(protectAdmin("Blogs", "Full"), updateBlogCategory)
  .delete(protectAdmin("Blogs", "Full"), deleteBlogCategory);

export default router;

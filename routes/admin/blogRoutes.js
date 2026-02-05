import express from "express";
import { protectAdmin } from "../../controllers/common/admin/authController.js";
import {
  createBlog,
  getAllBlogsAdmin,
  getBlogAdmin,
  updateBlog,
  deleteBlog,
  updateFullBlog,
} from "../../controllers/admin/blogController.js";

const router = express.Router();

// Protect all routes
router.use(protectAdmin("Blogs", "View"));

router
  .route("/")
  .get(getAllBlogsAdmin)
  .post(protectAdmin("Blogs", "Full"), createBlog);

router
  .route("/:id")
  .get(getBlogAdmin)
  .patch(protectAdmin("Blogs", "Full"), updateBlog)
  .delete(protectAdmin("Blogs", "Full"), deleteBlog);

router
  .route("/:id/edit")
  .patch(protectAdmin("Blogs", "Full"), updateFullBlog);

export default router;

import express from "express";
import {
  getAllBlogsPublic,
  getBlogBySlug,
  getAllCategoriesPublic,
} from "../../controllers/common/blogPublicController.js";

const router = express.Router();

router.get("/", getAllBlogsPublic);
router.get("/categories", getAllCategoriesPublic);
router.get("/:slug", getBlogBySlug);

export default router;

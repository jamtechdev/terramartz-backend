import express from "express";
import {
  getCategoryWithProductsAdvanced,
  getAllCategories,
} from "../../controllers/super-admin/categoryController.js";
import { optionalProtect } from "../../controllers/authController.js";

const router = express.Router();

// Advanced category + products (optional auth - to detect seller)
router.get("/:slug/products", optionalProtect, getCategoryWithProductsAdvanced);
router.get("/", getAllCategories);

export default router;

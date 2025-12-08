import express from "express";
import {
  getCategoryWithProductsAdvanced,
  getAllCategories,
} from "../../controllers/super-admin/categoryController.js";

const router = express.Router();

// Advanced category + products
router.get("/:slug/products", getCategoryWithProductsAdvanced);
router.get("/", getAllCategories);

export default router;

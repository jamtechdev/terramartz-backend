import express from "express";
const router = express.Router();
import {
  getSellerStore,
  getSellerStoreProducts,
} from "../../controllers/sellers/sellerStoreDetailController.js";
import { optionalProtect } from "../../controllers/authController.js";

// Public routes - store details and products are visible to everyone
router.get("/:sellerId/store", optionalProtect, getSellerStore);
router.get("/:sellerId/store/products", optionalProtect, getSellerStoreProducts);

export default router;

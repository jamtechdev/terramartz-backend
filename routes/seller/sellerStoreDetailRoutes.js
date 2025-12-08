import express from "express";
const router = express.Router();
import {
  getSellerStore,
  getSellerStoreProducts,
} from "../../controllers/sellers/sellerStoreDetailController.js";

router.get("/:sellerId/store", getSellerStore);
router.get("/:sellerId/store/products", getSellerStoreProducts);

export default router;

import express from "express";
import * as productController from "../../controllers/sellers/productController.js";
import { protect } from "../../controllers/authController.js";
import { restrictToSeller } from "../../middleware/seller/restrictToSeller.js";
import { upload } from "../../middleware/seller/uploadMiddleware.js";

const router = express.Router();

// Protect all routes
router.use(protect, restrictToSeller);

// Routes
router
  .route("/")
  .post(upload.array("productImages", 8), productController.createProduct)
  .get(productController.getAllProducts);

router
  .route("/:id")
  .get(productController.getProduct)
  .patch(upload.array("productImages", 8), productController.updateProduct)
  .delete(productController.deleteProduct);

export default router;

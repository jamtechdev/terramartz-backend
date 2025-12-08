import express from "express";
const router = express.Router();

import {
  upload,
  resizeProductImages,
} from "../middleware/seller/uploadMiddleware.js";
import * as productController from "../controllers/sellers/productController.js";
import { protect } from "../controllers/authController.js"; // JWT protect middleware
import { restrictToSeller } from "../middleware/seller/restrictToSeller.js";
import { Product } from "./../models/seller/product.js";
import { getFeatureProducts } from "./../controllers/common/featureProducts.js";
import AppError from "./../utils/apperror.js";

// -----------------------
// Product CRUD
// -----------------------
router
  .route("/")
  .post(
    protect,
    restrictToSeller,
    upload.array("productImages", 8),
    resizeProductImages,
    productController.createProduct
  )
  // .get(protect, restrictToSeller, productController.getAllProducts);
  .get(
    protect,
    restrictToSeller,
    productController.getSellerProductsWithPerformance
  );

router
  .route("/details-with-performance")
  .get(productController.getAllProductWithPerformance);

router
  .route("/:id")
  .get(productController.getProduct)
  .patch(
    protect,
    restrictToSeller,
    upload.array("productImages", 8),
    async (req, res, next) => {
      // ডাটাবেস থেকে old images set করা
      const product = await Product.findById(req.params.id);
      if (!product) return next(new AppError("Product not found", 404));
      req.oldImages = product.productImages;
      next();
    },
    resizeProductImages,
    productController.updateProduct
  )
  .delete(protect, restrictToSeller, productController.deleteProduct);
// ✅ Public marketplace route (anyone can see)
// router.get("/slug/:slug", productController.getProductsBySlug);
// -----------------------
// Product Performance
// -----------------------

// 1️⃣ Views (public)
router.route("/:id/performance/views").patch(productController.incrementViews);

// 2️⃣ Sales & Stock (protected, backend only)
router
  .route("/:id/performance/sales")
  .patch(
    protect,
    restrictToSeller,
    productController.incrementSalesAndUpdateStock
  );

// 3️⃣ Rating (protected, auth user)
router
  .route("/:id/performance/rating")
  .patch(protect, productController.updateRating);

// 4️⃣ Full info (product + performance)
router
  .route("/details-with-performance/:id")
  .get(productController.getProductWithPerformance);

// feature products
router.route("/feature/list").get(getFeatureProducts);

export default router;

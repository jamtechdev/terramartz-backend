import express from "express";
import * as salesAnalyticsController from "../../controllers/sellers/salesAnalyticsController.js";
import * as sellerOrderController from "../../controllers/sellers/sellerOrderController.js";
import * as shopSettingsController from "../../controllers/sellers/shopSettingsController.js";
import { upload } from "../../utils/multerConfig.js";
import { restrictToSeller } from "../../middleware/seller/restrictToSeller.js";
import { protect } from "../../controllers/authController.js"; // JWT protect middleware
import { getBestSellers } from "./../../controllers/sellers/salesAnalyticsController.js";
const router = express.Router();
// GET seller orders list (with pagination)
router.get(
  "/performance/stats",
  protect,
  restrictToSeller,
  salesAnalyticsController.getSellerPerformanceStats
);
// GET seller orders list (with pagination)
router.get(
  "/analytics/lifetime",
  protect,
  restrictToSeller,
  salesAnalyticsController.getSellerCompleteAnalytics
);
router.get(
  "/analytics/summary",
  protect,
  restrictToSeller,
  salesAnalyticsController.getSellerDashboardAnalytics
);

// GET seller earnings (today and overall)
router.get(
  "/earnings",
  protect,
  restrictToSeller,
  salesAnalyticsController.getSellerEarnings
);

// GET seller orders list (with pagination)
router.get(
  "/orders/",
  protect,
  restrictToSeller,
  sellerOrderController.getSellerOrdersPerfect
);
// PATCH /api/seller/orders/:orderId
router.patch(
  "/order/:orderId",
  protect,
  restrictToSeller,
  sellerOrderController.updateOrderStatus
);

// PATCH /api/seller/orders/:orderId
router.patch(
  "/shop-settings",
  protect,
  restrictToSeller,
  upload.fields([
    { name: "shopPicture", maxCount: 1 },
    { name: "profilePicture", maxCount: 1 },
  ]),
  shopSettingsController.updateShopSettings
);
router.route("/products/best-sellers").get(getBestSellers);

export default router;

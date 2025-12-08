import express from "express";
import {
  getRecentActivity,
  getActiveOrders,
  getCustomerDashboardStats,
} from "../../controllers/customers/dashboardController.js";
import { getOrderHistory } from "../../controllers/customers/getOrderHistoryController.js";
import { getCustomerOrders } from "../../controllers/customers/orderTracker.js";
import { getCustomerReviews } from "../../controllers/customers/reviewController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

router.get("/recent-activity", protect, getRecentActivity);
router.get("/active-orders", protect, getActiveOrders);
router.get("/order-history", protect, getOrderHistory);
router.get("/reviews", protect, getCustomerReviews);
router.get("/order-tracker", protect, getCustomerOrders);
router.get("/stats", protect, getCustomerDashboardStats);

export default router;

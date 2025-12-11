import express from "express";
import {
  getRecentActivity,
  getActiveOrders,
  getCustomerDashboardStats,
} from "../../controllers/customers/dashboardController.js";
import { getOrderHistory, getOrderBySessionId } from "../../controllers/customers/getOrderHistoryController.js";
import { getCustomerOrders } from "../../controllers/customers/orderTracker.js";
import { getCustomerReviews } from "../../controllers/customers/reviewController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

// Dashboard routes with /dashboard prefix
router.get("/dashboard/recent-activity", protect, getRecentActivity);
router.get("/dashboard/active-orders", protect, getActiveOrders);
router.get("/dashboard/order-history", protect, getOrderHistory);
router.get("/dashboard/order-by-session", protect, getOrderBySessionId);
router.get("/dashboard/reviews", protect, getCustomerReviews);
router.get("/dashboard/order-tracker", protect, getCustomerOrders);
router.get("/dashboard/stats", protect, getCustomerDashboardStats);

// Legacy routes without /dashboard prefix (for backward compatibility)
router.get("/recent-activity", protect, getRecentActivity);
router.get("/active-orders", protect, getActiveOrders);
router.get("/order-history", protect, getOrderHistory);
router.get("/order-by-session", protect, getOrderBySessionId);
router.get("/reviews", protect, getCustomerReviews);
router.get("/order-tracker", protect, getCustomerOrders);
router.get("/stats", protect, getCustomerDashboardStats);

export default router;

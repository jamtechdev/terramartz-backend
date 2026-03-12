import express from "express";
const router = express.Router();

import * as adminNotificationController from "../../controllers/admin/adminNotificationController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

// 🔐 ADMIN
/**
 * @route   GET /api/v1/admin/notifications/counts
 * @desc    Get counts of new/pending records for admin notifications
 * @access  Private (Admin)
 */
router.get(
  "/counts",
  //   protectAdmin("Dashboard", "View"), // Using Dashboard View permission as this is likely for a top-bar or dashboard notification counter
  adminNotificationController.getAdminNotificationCounts,
);

export default router;

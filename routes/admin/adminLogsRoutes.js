import express from "express";
const router = express.Router();

import * as adminLogsController from "../../controllers/admin/adminLogsController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

// 🔐 ADMIN LOGS ROUTES

// GET available log dates
router.get(
  "/dates/available",
  // protectAdmin("Logs", "View"),
  adminLogsController.getAvailableLogDates,
);

// GET logs by specific date (must be before the generic /:date route)
router.get(
  "/:date",
  // protectAdmin("Logs", "View"),
  adminLogsController.getLogsByDate,
);

// GET all logs with date range filter
router.get(
  "/",
  // protectAdmin("Logs", "View"),
  adminLogsController.getAllLogs,
);

export default router;

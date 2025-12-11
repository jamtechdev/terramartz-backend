import express from "express";
import * as notificationController from "../../controllers/common/notificationController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// GET /api/notifications - Get user notifications
router.get("/", notificationController.getUserNotifications);

// POST /api/notifications - Create notification (admin/seller only)
router.post("/", notificationController.createNotification);

// PATCH /api/notifications/:notificationId/read - Mark as read
router.patch("/:notificationId/read", notificationController.markNotificationAsRead);

// PATCH /api/notifications/read-all - Mark all as read
router.patch("/read-all", notificationController.markAllNotificationsAsRead);

// DELETE /api/notifications/:notificationId - Delete notification
router.delete("/:notificationId", notificationController.deleteNotification);

export default router;


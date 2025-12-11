import { Notification } from "../../models/common/notification.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

// ✅ Create notification
export const createNotification = catchAsync(async (req, res, next) => {
  const { user, type, title, message, orderId, order, productId, metadata } = req.body;

  if (!user || !type || !title || !message) {
    return next(new AppError("User, type, title, and message are required", 400));
  }

  const notification = await Notification.create({
    user,
    type,
    title,
    message,
    orderId,
    order,
    productId,
    metadata,
  });

  res.status(201).json({
    status: "success",
    data: notification,
  });
});

// ✅ Get all notifications for a user
export const getUserNotifications = catchAsync(async (req, res, next) => {
  const userId = req.user._id || req.user.id;
  const userIdString = String(userId);

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;
  const isRead = req.query.isRead === "true" ? true : req.query.isRead === "false" ? false : null;

  // Build query
  const query = { user: userIdString };
  if (isRead !== null) {
    query.isRead = isRead;
  }

  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Notification.countDocuments(query);
  const unreadCount = await Notification.countDocuments({ user: userIdString, isRead: false });

  res.status(200).json({
    status: "success",
    results: notifications.length,
    total,
    unreadCount,
    page,
    limit,
    data: notifications,
  });
});

// ✅ Mark notification as read
export const markNotificationAsRead = catchAsync(async (req, res, next) => {
  const { notificationId } = req.params;
  const userId = req.user._id || req.user.id;
  const userIdString = String(userId);

  const notification = await Notification.findOne({
    _id: notificationId,
    user: userIdString,
  });

  if (!notification) {
    return next(new AppError("Notification not found", 404));
  }

  notification.isRead = true;
  notification.readAt = new Date();
  await notification.save();

  res.status(200).json({
    status: "success",
    data: notification,
  });
});

// ✅ Mark all notifications as read
export const markAllNotificationsAsRead = catchAsync(async (req, res, next) => {
  const userId = req.user._id || req.user.id;
  const userIdString = String(userId);

  const result = await Notification.updateMany(
    { user: userIdString, isRead: false },
    { isRead: true, readAt: new Date() }
  );

  res.status(200).json({
    status: "success",
    message: `${result.modifiedCount} notifications marked as read`,
    modifiedCount: result.modifiedCount,
  });
});

// ✅ Delete notification
export const deleteNotification = catchAsync(async (req, res, next) => {
  const { notificationId } = req.params;
  const userId = req.user._id || req.user.id;
  const userIdString = String(userId);

  const notification = await Notification.findOneAndDelete({
    _id: notificationId,
    user: userIdString,
  });

  if (!notification) {
    return next(new AppError("Notification not found", 404));
  }

  res.status(204).json({
    status: "success",
    data: null,
  });
});


import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { Conversation } from "../../models/common/conversation.js";
import { Message } from "../../models/common/message.js";
import { User } from "../../models/users.js";
import { Admin } from "../../models/super-admin/admin.js";
import { getOnlineUsers } from "../../utils/socket.js";

const authUserId = (req) => String(req.user._id || req.user.id);

const resolveUserType = async (userId) => {
  const user = await User.findOne({ _id: userId }).select(
    "_id role firstName lastName",
  );
  if (user) return { userType: "User", user };
  const admin = await Admin.findOne({ _id: userId }).select("_id role name");
  if (admin) return { userType: "Admin", user: admin };
  return null;
};

export const startConversation = catchAsync(async (req, res, next) => {
  const { receiverId, orderId } = req.body;
  const senderId = authUserId(req);

  if (!receiverId) {
    return next(new AppError("receiverId is required", 400));
  }

  if (String(receiverId) === senderId) {
    return next(new AppError("Cannot start a conversation with yourself", 400));
  }

  const senderInfo = await resolveUserType(senderId);
  const receiverInfo = await resolveUserType(receiverId);

  if (!senderInfo) return next(new AppError("Sender not found", 404));
  if (!receiverInfo) return next(new AppError("Receiver not found", 404));

  const senderNorm = String(senderId).trim();
  const receiverNorm = String(receiverId).trim();

  // Multi-vendor orders: one conversation per (orderId + buyer + seller), not per order alone
  let findQuery;

  if (orderId) {
    findQuery = {
      orderId,
      isActive: true,
      "participants.userId": { $all: [senderNorm, receiverNorm] },
    };
  } else {
    findQuery = {
      "participants.userId": { $all: [senderNorm, receiverNorm] },
      orderId: null,
      isActive: true,
    };
  }

  let conversation = await Conversation.findOne(findQuery);

  if (conversation) {
    let modified = false;

    const senderExists = conversation.participants.some(
      (p) => String(p.userId).trim() === String(senderId).trim(),
    );
    if (!senderExists) {
      conversation.participants.push({
        userId: senderId,
        userType: senderInfo.userType,
      });
      modified = true;
    }

    const receiverExists = conversation.participants.some(
      (p) => String(p.userId).trim() === String(receiverId).trim(),
    );
    if (!receiverExists) {
      conversation.participants.push({
        userId: receiverId,
        userType: receiverInfo.userType,
      });
      modified = true;
    }

    if (modified) await conversation.save();

    return res.status(200).json({
      status: "success",
      data: { conversation },
    });
  }

  conversation = await Conversation.create({
    participants: [
      { userId: senderId, userType: senderInfo.userType },
      { userId: receiverId, userType: receiverInfo.userType },
    ],
    orderId: orderId || null,
  });

  res.status(201).json({
    status: "success",
    data: { conversation },
  });
});

export const getMyConversations = catchAsync(async (req, res) => {
  const userId = authUserId(req);
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const conversations = await Conversation.find({
    "participants.userId": userId,
    isActive: true,
  })
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("lastMessage")
    .lean();

  const onlineUsers = getOnlineUsers();

  const enriched = await Promise.all(
    conversations.map(async (conv) => {
      const enrichedParticipants = await Promise.all(
        conv.participants.map(async (p) => {
          let name = "Unknown";
          let profilePicture = null;

          if (p.userType === "User") {
            const u = await User.findOne({ _id: p.userId }).select(
              "firstName lastName profilePicture role",
            );
            if (u) {
              name = `${u.firstName || ""} ${u.lastName || ""}`.trim();
              profilePicture = u.profilePicture;
              p.role = u.role;
            }
          } else {
            const a = await Admin.findOne({ _id: p.userId }).select("name role");
            if (a) {
              name = a.name;
              p.role = a.role;
            }
          }

          return {
            ...p,
            name,
            profilePicture,
            isOnline: onlineUsers.has(p.userId),
          };
        }),
      );

      const unreadCount = await Message.countDocuments({
        conversation: conv._id,
        "sender.userId": { $ne: userId },
        "readBy.userId": { $ne: userId },
      });

      return {
        ...conv,
        participants: enrichedParticipants,
        unreadCount,
      };
    }),
  );

  const total = await Conversation.countDocuments({
    "participants.userId": userId,
    isActive: true,
  });

  res.status(200).json({
    status: "success",
    results: enriched.length,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    data: { conversations: enriched },
  });
});

export const getMessages = catchAsync(async (req, res, next) => {
  const { conversationId } = req.params;
  const userId = authUserId(req);
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const skip = (page - 1) * limit;

  const conversation = await Conversation.findOne({ _id: conversationId });
  if (!conversation) {
    return next(new AppError("Conversation not found", 404));
  }

  const isParticipant = conversation.participants.some(
    (p) => String(p.userId).trim() === String(userId).trim(),
  );
  if (!isParticipant) {
    return next(
      new AppError("You are not a participant of this conversation", 403),
    );
  }

  const messages = await Message.find({
    conversation: conversationId,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Message.countDocuments({
    conversation: conversationId,
    isDeleted: false,
  });

  res.status(200).json({
    status: "success",
    results: messages.length,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    data: { messages: messages.reverse() },
  });
});

export const deleteConversation = catchAsync(async (req, res, next) => {
  const { conversationId } = req.params;
  const userId = authUserId(req);

  const conversation = await Conversation.findOne({ _id: conversationId });
  if (!conversation) {
    return next(new AppError("Conversation not found", 404));
  }

  const isParticipant = conversation.participants.some(
    (p) => String(p.userId) === String(userId),
  );
  if (!isParticipant) {
    return next(
      new AppError("You are not a participant of this conversation", 403),
    );
  }

  conversation.isActive = false;
  await conversation.save();

  res.status(200).json({
    status: "success",
    message: "Conversation deleted",
  });
});

export const getOnlineStatus = catchAsync(async (req, res) => {
  const { userIds } = req.body;

  if (!Array.isArray(userIds)) {
    return res.status(400).json({
      status: "fail",
      message: "userIds must be an array",
    });
  }

  const onlineUsers = getOnlineUsers();
  const statuses = userIds.map((id) => ({
    userId: id,
    isOnline: onlineUsers.has(id),
  }));

  res.status(200).json({
    status: "success",
    data: { statuses },
  });
});

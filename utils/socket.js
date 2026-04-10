import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { User } from "../models/users.js";
import { Admin } from "../models/super-admin/admin.js";
import { Conversation } from "../models/common/conversation.js";
import { Message } from "../models/common/message.js";

const onlineUsers = new Map();

export function getOnlineUsers() {
  return onlineUsers;
}

function getUserRoom(userId) {
  return `user:${userId}`;
}

export function initializeSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (process.env.NODE_ENV !== "production") return callback(null, true);
        const allowedOrigins = [
          "http://35.168.8.254.nip.io",
          "https://35.168.8.254.nip.io",
          "http://localhost:3000",
          "http://localhost:3001",
          "http://127.0.0.1:3000",
          "http://admin.35.168.8.254.nip.io",
          "https://terramartz.com",
          "https://admin.terramartz.com",
        ];
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1];

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      let user = await User.findOne({ _id: decoded.id });
      if (user) {
        socket.user = {
          _id: user._id,
          userType: "User",
          role: user.role,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        };
        return next();
      }

      let admin = await Admin.findOne({ _id: decoded.id });
      if (admin) {
        socket.user = {
          _id: admin._id,
          userType: "Admin",
          role: admin.role,
          name: admin.name,
        };
        return next();
      }

      return next(new Error("User not found"));
    } catch (err) {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const { _id, userType, name } = socket.user;

    onlineUsers.set(_id, {
      socketId: socket.id,
      userType,
      name,
    });

    socket.join(getUserRoom(_id));

    io.emit("user:online", { userId: _id, userType });

    socket.on("message:send", async (data, callback) => {
      try {
        const {
          conversationId,
          content,
          messageType = "text",
          attachmentUrl,
        } = data;

        if (!conversationId || !content) {
          return callback?.({
            error: "conversationId and content are required",
          });
        }

        const conversation = await Conversation.findOne({
          _id: conversationId,
        });
        if (!conversation) {
          return callback?.({ error: "Conversation not found" });
        }

        const senderId = String(_id).trim();
        const isParticipant = conversation.participants.some(
          (p) => String(p.userId).trim() === senderId,
        );
        if (!isParticipant) {
          return callback?.({
            error: "You are not a participant of this conversation",
          });
        }

        const message = await Message.create({
          conversation: conversationId,
          sender: { userId: _id, userType },
          content,
          messageType,
          attachmentUrl: attachmentUrl || null,
          readBy: [{ userId: _id }],
        });

        conversation.lastMessage = message._id;
        await conversation.save();

        const populatedMessage = {
          ...message.toObject(),
          senderName: name,
        };

        const currentId = String(_id).trim();
        conversation.participants.forEach((p) => {
          if (String(p.userId).trim() !== currentId) {
            io.to(getUserRoom(p.userId)).emit(
              "message:receive",
              populatedMessage,
            );
          }
        });

        callback?.({ success: true, message: populatedMessage });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on("message:read", async (data, callback) => {
      try {
        const { conversationId } = data;

        await Message.updateMany(
          {
            conversation: conversationId,
            "sender.userId": { $ne: _id },
            "readBy.userId": { $ne: _id },
          },
          {
            $push: { readBy: { userId: _id, readAt: new Date() } },
          },
        );

        const conversation = await Conversation.findOne({
          _id: conversationId,
        });
        if (conversation) {
          const currentId = String(_id).trim();
          const participant = conversation.participants.find(
            (p) => String(p.userId).trim() === currentId,
          );
          if (participant) {
            participant.lastReadAt = new Date();
            await conversation.save();
          }

          const readerId = String(_id).trim();
          conversation.participants.forEach((p) => {
            if (String(p.userId).trim() !== readerId) {
              io.to(getUserRoom(p.userId)).emit("message:read", {
                conversationId,
                readBy: _id,
              });
            }
          });
        }

        callback?.({ success: true });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on("typing:start", (data) => {
      const { conversationId } = data;
      socket
        .to(conversationId)
        .emit("typing:start", { conversationId, userId: _id, name });
    });

    socket.on("typing:stop", (data) => {
      const { conversationId } = data;
      socket
        .to(conversationId)
        .emit("typing:stop", { conversationId, userId: _id });
    });

    socket.on("conversation:join", (data) => {
      const { conversationId } = data;
      socket.join(conversationId);
    });

    socket.on("conversation:leave", (data) => {
      const { conversationId } = data;
      socket.leave(conversationId);
    });

    socket.on("disconnect", () => {
      onlineUsers.delete(_id);
      io.emit("user:offline", { userId: _id, userType });
    });
  });

  return io;
}

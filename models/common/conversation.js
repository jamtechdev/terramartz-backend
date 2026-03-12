import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const participantSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    userType: {
      type: String,
      enum: ["User", "Admin"],
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    lastReadAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    participants: {
      type: [participantSchema],
      validate: {
        validator: function (v) {
          return v.length >= 2;
        },
        message: "A conversation must have at least 2 participants.",
      },
    },
    orderId: {
      type: String,
      ref: "Purchase",
      default: null,
    },
    lastMessage: {
      type: String,
      ref: "Message",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

conversationSchema.index({ "participants.userId": 1 });
conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ orderId: 1 });

export const Conversation = mongoose.model(
  "Conversation",
  conversationSchema,
);

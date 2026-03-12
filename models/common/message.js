import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const messageSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    conversation: {
      type: String,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: {
      userId: {
        type: String,
        required: true,
      },
      userType: {
        type: String,
        enum: ["User", "Admin"],
        required: true,
      },
    },
    content: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    messageType: {
      type: String,
      enum: ["text", "image", "file"],
      default: "text",
    },
    attachmentUrl: {
      type: String,
      default: null,
    },
    readBy: [
      {
        userId: { type: String },
        readAt: { type: Date, default: Date.now },
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

messageSchema.index({ conversation: 1, createdAt: -1 });

export const Message = mongoose.model("Message", messageSchema);

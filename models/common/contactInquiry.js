import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const contactInquirySchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      maxlength: [100, "Full name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email address",
      ],
      index: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          return !v || /^\+?[\d\s\-()]+$/.test(v);
        },
        message: "Please enter a valid phone number",
      },
    },
    inquiryType: {
      type: String,
      required: [true, "Inquiry type is required"],
      enum: [
        "General Inquiry",
        "Product Question",
        "Order Support",
        "Partnership",
        "Complaint",
        "Feedback",
        "Other",
      ],
      default: "General Inquiry",
      index: true,
    },
    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
      maxlength: [200, "Subject cannot exceed 200 characters"],
    },
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },
    status: {
      type: String,
      enum: ["pending", "in_progress", "resolved", "closed"],
      default: "pending",
      index: true,
    },
    respondedAt: {
      type: Date,
    },
    responseNotes: {
      type: String,
      trim: true,
    },
    assignedAdmin: {
      type: String,
      ref: "Admin",
      default: null,
      index: true,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    assignmentHistory: [{
      assignedBy: {
        type: String,
        ref: "Admin"
      },
      assignedTo: {
        type: String,
        ref: "Admin"
      },
      assignedAt: {
        type: Date,
        default: Date.now
      },
      reason: {
        type: String,
        default: "Automatic assignment"
      }
    }],
  },
  { timestamps: true }
);

// Index for efficient queries
contactInquirySchema.index({ email: 1, createdAt: -1 });
contactInquirySchema.index({ status: 1, createdAt: -1 });
contactInquirySchema.index({ inquiryType: 1 });
contactInquirySchema.index({ assignedAdmin: 1, createdAt: -1 });
contactInquirySchema.index({ assignedAdmin: 1, status: 1 });

export const ContactInquiry = mongoose.model(
  "ContactInquiry",
  contactInquirySchema
);


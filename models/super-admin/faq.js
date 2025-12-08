// models/faq.js
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const faqSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    question: {
      type: String,
      required: [true, "Question is required!"],
      trim: true,
    },
    answer: {
      type: String,
      required: [true, "Answer is required!"],
      trim: true,
    },
    createdBy: {
      type: String,
      ref: "User", // যিনি FAQ বানিয়েছেন (admin/seller)
    },
    isActive: {
      type: Boolean,
      default: true, // false হলে front-end এ দেখানো হবে না
    },
  },
  { timestamps: true }
);

export const Faq = mongoose.model("Faq", faqSchema);

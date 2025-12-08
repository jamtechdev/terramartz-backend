import express from "express";
import * as contactInquiryController from "../../controllers/common/contactInquiryController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

// POST - Submit Inquiry (Public - No Auth)
router.post("/submit", contactInquiryController.submitInquiry);

// GET - Get All Inquiries (Authenticated)
router.get("/", protect, contactInquiryController.getAllInquiries);

// GET - Get Single Inquiry (Authenticated)
router.get("/:id", protect, contactInquiryController.getInquiryById);

// PATCH - Update Inquiry Status (Authenticated)
router.patch("/:id/status", protect, contactInquiryController.updateInquiryStatus);

export default router;


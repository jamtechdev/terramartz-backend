import express from "express";
import * as contactInquiryController from "../../controllers/common/contactInquiryController.js";
import { protect } from "../../controllers/authController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

const router = express.Router();

// POST - Submit Inquiry (Public - No Auth)
router.post("/submit", contactInquiryController.submitInquiry);

// GET - Get All Inquiries (Admin Only)
router.get("/", protectAdmin('Support', 'View'), contactInquiryController.getAllInquiries);

// PATCH - Update Inquiry Status (Admin Only)
router.patch("/:id/status", protectAdmin('Support', 'Full'), contactInquiryController.updateInquiryStatus);

// GET - Get Tickets Assigned to Current Admin (Admin Only)
router.get("/my-tickets", protectAdmin('Support', 'View'), contactInquiryController.getMyTickets);

// GET - Get Ticket Statistics (Admin Only)
router.get("/stats", protectAdmin('Support', 'View'), contactInquiryController.getTicketStats);

// GET - Get Single Inquiry (Admin Only) - This must come AFTER specific routes like /stats
router.get("/:id", protectAdmin('Support', 'View'), contactInquiryController.getInquiryById);

// PATCH - Reassign/Unassign Ticket (Super Admin Only)
router.patch("/:id/assign", protectAdmin(), contactInquiryController.reassignTicketController);

export default router;


import express from "express";
import { protectAdmin } from "../../controllers/common/admin/authController.js";
import {
  getAllFaqs,
  getFaqById,
  adminGetAllFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
} from "../../controllers/super-admin/faqController.js";

const router = express.Router();

// --- Public Routes ---
// These are accessible to everyone (only fetches active FAQs)
router.get("/", getAllFaqs);
router.get("/:id", getFaqById);

// --- Admin Routes ---
// Protected by protectAdmin middleware. Example: requires "Settings" or generic admin access.
// We'll use an empty protectAdmin() which defaults to checking if token exists and user is admin.
// If a specific module like "Content" is needed, it would be protectAdmin("Content", "Full")
router.get("/admin/all", protectAdmin(), adminGetAllFaqs);
router.post("/", protectAdmin(), createFaq);
router.patch("/:id", protectAdmin(), updateFaq);
router.delete("/:id", protectAdmin(), deleteFaq);

export default router;

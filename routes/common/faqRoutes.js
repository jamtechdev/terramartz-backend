import express from "express";
import {
  getAllFaqs,
  getFaqById,
} from "../../controllers/super-admin/faqController.js";

const router = express.Router();

// Public Routes
router.get("/", getAllFaqs);
router.get("/:id", getFaqById);

export default router;

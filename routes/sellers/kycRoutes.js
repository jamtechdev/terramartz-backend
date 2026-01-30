import express from "express";
import {
  submitKYCDocuments,
  getKYCStatus,
  uploadKYCDocument
} from "../../controllers/sellers/kycController.js";
import { restrictToSeller } from "../../middleware/seller/restrictToSeller.js";
import { protect } from "../../controllers/authController.js";
import { upload } from "../../middleware/seller/uploadMiddleware.js";

const router = express.Router();

// All routes require authentication and seller role
router.use(protect);
router.use(restrictToSeller);

// Single document upload
router.post("/upload-document", 
  upload.fields([
    { name: 'document', maxCount: 1 }
  ]), 
  uploadKYCDocument
);

// Bulk document submission
router.post("/submit-documents",
  upload.fields([
    { name: 'documents', maxCount: 10 }
  ]),
  submitKYCDocuments
);

// Get KYC status
router.get("/status", getKYCStatus);

export default router;
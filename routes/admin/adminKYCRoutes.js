import express from "express";
import {
  getPendingKYCApplications,
  reviewKYCApplication,
  verifyAllDocuments,
  getKYCApplicationDetails,
  getKYCStats
} from "../../controllers/admin/adminKYCController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

const router = express.Router();

// All routes require authentication and admin role
router.use(protectAdmin());

// Get KYC statistics
router.get("/stats", getKYCStats);

// Get pending KYC applications
router.get("/applications", getPendingKYCApplications);

// Get specific KYC application details
router.get("/application/:kycId", getKYCApplicationDetails);

// Review KYC application (approve/reject)
router.patch("/application/:kycId/review", reviewKYCApplication);

// Verify all documents at once
router.patch("/application/:kycId/verify-all", verifyAllDocuments);

export default router;
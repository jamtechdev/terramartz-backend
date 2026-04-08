import express from "express";
import {
  createStripeAccount,
  getOnboardingLink,
  getAccountStatus,
  getDashboardLink,
  getRemediationLink,
  checkKYCStatus,
} from "../../controllers/sellers/stripeConnectController.js";
import { restrictToSeller } from "../../middleware/seller/restrictToSeller.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

// All routes require authentication and seller role
router.use(protect);
router.use(restrictToSeller);

// Mutating / sensitive Connect actions require approved KYC (account-status stays open for UI polling)
router.post("/create-account", checkKYCStatus, createStripeAccount);
router.get("/onboarding-link", checkKYCStatus, getOnboardingLink);
router.get("/dashboard-link", checkKYCStatus, getDashboardLink);
router.get("/remediation-link", checkKYCStatus, getRemediationLink);

// Get Account Status (no KYC gate — dashboard can show Connect state before/after KYC)
router.get("/account-status", getAccountStatus);

export default router;

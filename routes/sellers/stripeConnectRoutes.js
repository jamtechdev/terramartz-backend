import express from "express";
import {
  createStripeAccount,
  getOnboardingLink,
  getAccountStatus,
  getDashboardLink,
} from "../../controllers/sellers/stripeConnectController.js";
import { restrictToSeller } from "../../middleware/seller/restrictToSeller.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

// All routes require authentication and seller role
router.use(protect);
router.use(restrictToSeller);

// Create Stripe Express Account
router.post("/create-account", createStripeAccount);

// Get Onboarding Link
router.get("/onboarding-link", getOnboardingLink);

// Get Account Status
router.get("/account-status", getAccountStatus);

// Get Dashboard Link (Stripe Express Dashboard)
router.get("/dashboard-link", getDashboardLink);

export default router;


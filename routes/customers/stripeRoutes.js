import express from "express";
import * as stripeController from "../../controllers/customers/stripeController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();
router.use(protect);

// create paymentIntent (custom form)
router.post("/create-payment-intent", stripeController.createPaymentIntent);

// create checkout session (Stripe hosted page)
router.post("/create-checkout-session", stripeController.createCheckoutSession);

// create order immediately after payment (called from frontend)
router.post(
  "/create-order-immediately",
  stripeController.createOrderImmediately,
);

router.post("/refund", stripeController.createRefund);

// Get dispute details for an order
router.get("/dispute/:orderId", stripeController.getDisputeDetails);

// Submit evidence for a dispute (Seller only)
router.post(
  "/dispute/:orderId/evidence",
  stripeController.submitDisputeEvidence,
);

export default router;

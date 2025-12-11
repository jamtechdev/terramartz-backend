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
router.post("/create-order-immediately", stripeController.createOrderImmediately);

export default router;

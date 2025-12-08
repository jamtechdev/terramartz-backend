import express from "express";
import * as stripeController from "../../controllers/customers/stripeController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();
router.use(protect);

// create paymentIntent (custom form)
router.post("/create-payment-intent", stripeController.createPaymentIntent);

export default router;

import express from "express";
import * as newsletterController from "../../controllers/customers/newsletterController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

// POST - Subscribe (Public - No Auth)
router.post("/subscribe", newsletterController.subscribe);

// GET - Get All Subscribers (Authenticated)
router.get("/subscribers", protect, newsletterController.getAllSubscribers);

export default router;

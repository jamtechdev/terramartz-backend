import express from "express";
import { getSellerPortalStats } from "../../controllers/common/platformStatsController.js";

const router = express.Router();

// Public endpoint for marketing/seller portal stats
router.get("/seller-portal", getSellerPortalStats);

export default router;



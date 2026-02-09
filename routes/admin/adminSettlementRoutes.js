import express from "express";
import { processSettlements } from "../../controllers/sellers/settlementController.js";
import { protect } from "../../controllers/authController.js";
// You might have a restrictToAdmin middleware, let's check
// import { restrictTo } from "../../middleware/authMiddleware.js";

const router = express.Router();

// This endpoint should be called by a cron job
// It processes all pending settlements that are due
router.post("/process", processSettlements);

export default router;

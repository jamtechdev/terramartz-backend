import express from "express";
import { processSettlements } from "../../controllers/sellers/settlementController.js";

const router = express.Router();

router.post("/process", processSettlements);

export default router;

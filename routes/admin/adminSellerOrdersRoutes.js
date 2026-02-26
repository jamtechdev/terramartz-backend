import express from "express";
import {
    getAllSellersWithStats,
    getSellerOrders,
} from "../../controllers/admin/adminSellerOrdersController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

const router = express.Router();

// All routes are protected and restricted to admin
router.get("/sellers", protectAdmin("Payments", "View"), getAllSellersWithStats);
router.get("/:sellerId/orders", protectAdmin("Payments", "View"), getSellerOrders);

export default router;

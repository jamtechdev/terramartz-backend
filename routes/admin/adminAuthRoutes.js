import express from "express";
const router = express.Router();

import * as adminAuthController from "../../controllers/admin/adminAuthController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

// 🔐 ADMIN
router.post("/login", adminAuthController.adminLogin);
router.post("/register", adminAuthController.adminRegister);
router.get("/me", protectAdmin(), adminAuthController.getAdminMe);

export default router;

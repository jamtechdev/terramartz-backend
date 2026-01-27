import express from "express";
const router = express.Router();

import * as adminAuthController from "../../controllers/admin/adminAuthController.js";

// 🔐 ADMIN
router.post("/login", adminAuthController.adminLogin);
router.post("/register", adminAuthController.adminRegister);

export default router;

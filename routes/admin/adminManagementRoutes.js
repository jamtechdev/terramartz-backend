import express from "express";
import * as adminManagementController from "../../controllers/admin/adminManagementController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

const router = express.Router();

// GET - Get All Admins (Super Admin Only)
router.get("/", protectAdmin(), adminManagementController.getAllAdmins);

// GET - Get Specific Admin by ID (Super Admin Only)
router.get("/:id", protectAdmin(), adminManagementController.getAdminById);

export default router;
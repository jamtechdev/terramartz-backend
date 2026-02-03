import express from "express";
import * as adminManagementController from "../../controllers/admin/adminManagementController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

const router = express.Router();

// GET - Get All Admins (Super Admin Only)
router.get(
  "/",
  protectAdmin("Settings", "View"),
  adminManagementController.getAllAdmins,
);

// GET - Get Specific Admin by ID (Super Admin Only)
router.get(
  "/:id",
  protectAdmin("Settings", "View"),
  adminManagementController.getAdminById,
);
// Patch - Update Admin by ID (Super Admin Only)
router.patch(
  "/:id",
  protectAdmin("Settings", "View"),
  adminManagementController.updateStaff,
);
// Delete - Delete Admin by ID (Super Admin Only)
router.delete(
  "/:id",
  protectAdmin("Settings", "View"),
  adminManagementController.deleteStaff,
);
// GET - Toggle Admin Status by ID (Super Admin Only)
router.get(
  "/:id/toggle",
  protectAdmin("Settings", "View"),
  adminManagementController.toggleStaffStatus,
);

export default router;

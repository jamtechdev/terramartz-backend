import express from "express";
import { protectAdmin } from "../../controllers/common/admin/authController.js";
import {
  getAdminSettings,
  updateAdminSettings,
} from "../../controllers/admin/adminSettingsController.js";

const router = express.Router();

router.get("/", protectAdmin("Settings", "View"), getAdminSettings);
router.patch("/", protectAdmin("Settings", "Full"), updateAdminSettings);

export default router;

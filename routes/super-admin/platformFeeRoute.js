import express from "express";
const router = express.Router();

import * as platformFeeController from "../../controllers/super-admin/platformFeeController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";

router.post(
  "/",
  // protectAdmin("Platform Fee", "View"),
  platformFeeController.createPlatformFee,
);

router.patch(
  "/:id",
  protectAdmin("Platform Fee", "View"),
  platformFeeController.updatePlatformFee,
);

router.get("/", platformFeeController.getAllPlatformFees);
router.get("/:id", platformFeeController.getPlatformFeeById);

router.delete(
  "/:id",
  protectAdmin("Platform Fee", "View"),
  platformFeeController.deletePlatformFee,
);

export default router;

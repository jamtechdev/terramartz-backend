import express from "express";
import { protectAdmin } from "../../controllers/common/admin/authController.js";
import { uploadMedia } from "../../controllers/admin/mediaController.js";
import { upload } from "../../middleware/admin/upload.js";

const router = express.Router();

router.post(
  "/upload",
  protectAdmin("Blogs", "Full"),
  upload.single("image"),
  uploadMedia
);

export default router;

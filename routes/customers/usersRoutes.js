import express from "express";
import { upload } from "../../utils/multerConfig.js";
import {
  updatePassword,
  protect,
  enableTwoFactor,
  disableTwoFactor,
  verifyTwoFactor,
  confirmTwoFactorSetup,
} from "../../controllers/authController.js";
import { getLoggedInUser } from "../../controllers/userController.js";

import {
  startUpdateVerification,
  verifyEmailOtp,
  verifyPhoneOtp,
  resendVerificationOtp,
} from "../../controllers/userController.js";

const router = express.Router();

router.route("/updateMyPassword").patch(protect, updatePassword);

router.post(
  "/profile/update",
  protect,
  upload.fields([{ name: "profilePicture", maxCount: 1 }]),
  startUpdateVerification
);
router.post("/profile/update/verify-email", protect, verifyEmailOtp);
router.post("/profile/update/verify-phone", protect, verifyPhoneOtp);
router.post("/profile/update/resend-otp", protect, resendVerificationOtp);

// 2FA routes
router.post("/2fa/enable", protect, enableTwoFactor); // Enable 2FA (email / phone / authenticator)
router.post("/2fa/confirm", protect, confirmTwoFactorSetup); // new
router.post("/2fa/disable", protect, disableTwoFactor); // Disable 2FA
router.post("/2fa/verify", verifyTwoFactor); // Verify 2FA on login
router.get("/me", protect, getLoggedInUser);

export default router;

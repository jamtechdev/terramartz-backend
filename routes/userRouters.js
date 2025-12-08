import express from "express";
const router = express.Router();

import {
  sendEmailVerificationOtp,
  verifyEmail,
} from "../middleware/verifyEmail.js";

import {
  sendPhoneNumberVerificationOtp,
  verifyPhoneNumber,
} from "../middleware/verifyPhoneNumber.js";

import {
  signup,
  login,
  forgotPassword,
  resetPassword,
  protect,
} from "../controllers/authController.js";

import { upload } from "../utils/multerConfig.js";
import { getLoggedInUser } from "../controllers/userController.js";

router.post(
  "/signup",

  upload.fields([
    { name: "profilePicture", maxCount: 1 },
    { name: "shopPicture", maxCount: 1 },
  ]),
  signup
);
router.post("/forgotPassword", forgotPassword);
router.patch("/resetPassword/:token", resetPassword);

// changing here....
router.post("/send-email-otp", sendEmailVerificationOtp);
router.post("/verify-email-otp", verifyEmail);
router.post("/send-phone-otp", sendPhoneNumberVerificationOtp);
router.post("/verify-phone-otp", verifyPhoneNumber);

router.post("/login", login);

//Protect All routes after this middleware

// getLoggedInUser;
router.get("/", protect, getLoggedInUser);

export default router;

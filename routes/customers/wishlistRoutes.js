import express from "express";
import * as wishlistController from "../../controllers/customers/wishlistController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

router.use(protect); // Only logged-in users

router.get("/", wishlistController.getWishlist);
router.post("/:productId", wishlistController.addToWishlist);
router.delete("/:productId", wishlistController.removeFromWishlist);

export default router;

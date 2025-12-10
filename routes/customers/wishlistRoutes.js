import express from "express";
import * as wishlistController from "../../controllers/customers/wishlistController.js";
import { protect } from "../../controllers/authController.js";
import { restrictToSeller } from "../../middleware/seller/restrictToSeller.js";

const router = express.Router();

router.use(protect); // Only logged-in users

// User routes (for normal users)
router.get("/", wishlistController.getWishlist);
router.post("/:productId", wishlistController.addToWishlist);
router.delete("/:productId", wishlistController.removeFromWishlist);

// Seller routes (to see who favorited their products)
router.get("/seller/products", restrictToSeller, wishlistController.getSellerProductFavorites);
router.get("/product/:productId/users", restrictToSeller, wishlistController.getProductFavorites);

export default router;

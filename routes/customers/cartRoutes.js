import express from "express";
import * as cartController from "../../controllers/customers/cartController.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

router.use(protect); // সব route এ login required

router
  .route("/")
  .get(cartController.getAllCartItems)
  .post(cartController.addToCart)
  .delete(cartController.clearAllCartItems);

router
  .route("/:id")
  .get(cartController.getCartItem)
  .patch(cartController.updateCartItem)
  .delete(cartController.deleteCartItem);

export default router;

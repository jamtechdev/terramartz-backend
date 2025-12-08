// const express = require("express");
// const productController = require("../../controllers/sellers/productController");
// const { protect } = require("../../controllers/authController"); // JWT protect middleware
// const {
//   restrictToSeller,
// } = require("../../middleware/seller/restrictToSeller");

// const router = express.Router();

// // ✅ Public marketplace route (anyone can see)
// router.get(
//   "/:slug",
//   protect,
//   restrictToSeller,
//   productController.getProductsBySlug
// );

// module.exports = router;

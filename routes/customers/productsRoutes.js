import express from "express";
import { getProductByProductSlug } from "../../controllers/customers/productsController.js";

const router = express.Router();

router.route("/:productSlug").get(getProductByProductSlug);

export default router;

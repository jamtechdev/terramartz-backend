import express from "express";
import {
  getAllDeliveryPartners,
  getDeliveryPartnerById,
  createDeliveryPartner,
  updateDeliveryPartner,
  deleteDeliveryPartner,
} from "../../controllers/sellers/deliveryPartnersController.js";
import { restrictToSeller } from "../../middleware/seller/restrictToSeller.js";
import { protect } from "../../controllers/authController.js";

const router = express.Router();

// All routes require authentication and seller role
router.use(protect);
router.use(restrictToSeller);

router.get("/", getAllDeliveryPartners);
router.get("/:id", getDeliveryPartnerById);
router.post("/", createDeliveryPartner);
router.patch("/:id", updateDeliveryPartner);
router.delete("/:id", deleteDeliveryPartner);

export default router;

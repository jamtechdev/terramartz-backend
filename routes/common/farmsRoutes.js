import express from "express";
import {
  searchFarms,
  getFarmProductsInformation,
  getFarmsForMap,
} from "../../controllers/sellers/shopSettingsController.js";

const router = express.Router();

router.get("/map-markers", getFarmsForMap);
router.get("/search", searchFarms);
router.get("/:farmId/products", getFarmProductsInformation);

export default router;

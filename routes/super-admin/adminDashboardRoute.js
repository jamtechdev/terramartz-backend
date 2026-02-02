import express from "express";
const router = express.Router();

import * as adminDashboardController from "../../controllers/super-admin/dashboardController.js";

router.get("/section-one", adminDashboardController.sectionOne);
router.get("/section-two", adminDashboardController.sectionTwo);
router.get("/section-three", adminDashboardController.sectionThree);
router.get("/section-four", adminDashboardController.sectionFour);

export default router;

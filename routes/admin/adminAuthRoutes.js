import express from "express";
const router = express.Router();

import * as adminAuthController 
  from "../../controllers/admin/adminAuthController.js";

import { protect } from "../../controllers/authController.js";

// 🔐 ADMIN
router.post("/",
    //  protect,
      adminAuthController.adminLogin);


export default router;

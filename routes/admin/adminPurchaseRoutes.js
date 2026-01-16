import express from "express";
const router = express.Router();

import * as adminPurchaseController 
  from "../../controllers/admin/adminPurchaseController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";


// 🔐 ADMIN
router.get("/",
     protectAdmin, 
     adminPurchaseController.getAllTransactions);


export default router;

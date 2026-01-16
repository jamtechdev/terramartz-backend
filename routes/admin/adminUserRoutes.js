import express from "express";
const router = express.Router();

import * as adminUserController 
  from "../../controllers/admin/adminUserController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";


// 🔐 ADMIN
router.get("/",
     protectAdmin, 
     adminUserController.getAllUsers);


export default router;

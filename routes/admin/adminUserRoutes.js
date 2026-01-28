import express from "express";
const router = express.Router();

import * as adminUserController 
  from "../../controllers/admin/adminUserController.js";
import { protectAdmin } from "../../controllers/common/admin/authController.js";


// 🔐 ADMIN ROUTES
// GET all users with filters and pagination
router.get("/",
     protectAdmin('Users', 'View'), 
     adminUserController.getAllUsers);

// GET single user by ID
router.get("/:id",
     protectAdmin('Users', 'View'),
     adminUserController.getUserById);

// UPDATE user status
router.patch("/:id/status",
     protectAdmin('Users', 'Full'),
     adminUserController.updateUserStatus);

// UPDATE user role
router.patch("/:id/role",
     protectAdmin('Users', 'Full'),
     adminUserController.updateUserRole);

// UPDATE user details
router.patch("/:id",
     protectAdmin('Users', 'Full'),
     adminUserController.updateUserDetails);

// DELETE user (soft delete)
router.delete("/:id",
     protectAdmin('Users', 'Full'),
     adminUserController.deleteUser);


export default router;

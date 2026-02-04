import express from "express";
import { protectAdmin } from "../../controllers/common/admin/authController.js";
import * as adminProductController from "../../controllers/admin/adminProductController.js";

const router = express.Router();

// Protect all routes with admin authentication
// For products, we'll use 'Products' module with appropriate access levels
router.use(protectAdmin('Products', 'View')); // Require at least View access to Products module

// GET all products with filters and pagination
router.route('/')
  .get(protectAdmin('Products', 'View'), adminProductController.getAllProducts);

// GET requested (pending approval) products
router.route('/requested')
  .get(protectAdmin('Products', 'View'), (req, res, next) => {
    req.query.adminApproved = 'false';
    req.query.status = 'pending';
    next();
  }, adminProductController.getAllProducts);

// GET single product by ID
router.route('/:id')
  .get(protectAdmin('Products', 'View'), adminProductController.getProductById);

// UPDATE product status
router.route('/:id/status')
  .patch(protectAdmin('Products', 'Full'), adminProductController.updateProductStatus);

// UPDATE product approval status
router.route('/:id/approval')
  .patch(protectAdmin('Products', 'Full'), adminProductController.updateProductApproval);

// DELETE product (soft delete by archiving)
// router.route('/:id')
//   .delete(protectAdmin('Products', 'Full'), adminProductController.deleteProduct);

export default router;
import { AdminSelection } from "../../models/super-admin/adminSelection.js";
import { Product } from "../../models/seller/product.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

// Admin selects a product for Feature Section
export const selectFeatureProduct = catchAsync(async (req, res, next) => {
  const adminId = req.user._id; // assume admin logged in
  const { productId } = req.body;

  // Check if product exists and active
  const product = await Product.findById(productId);
  if (!product || product.status !== "active") {
    return next(new AppError("Invalid product selected", 400));
  }

  // Check if this product is already selected by admin
  const existingSelection = await AdminSelection.findOne({ productId });
  if (existingSelection) {
    return res.status(200).json({
      status: "success",
      message: "Product is already selected for Feature Section",
      data: existingSelection,
    });
  }

  // Save selection (latest first)
  const selection = await AdminSelection.create({ productId, adminId });

  res.status(201).json({
    status: "success",
    message: "Product selected successfully for Feature Section",
    data: selection,
  });
});

// Delete a selected feature product by admin
export const deleteFeatureProduct = catchAsync(async (req, res, next) => {
  const adminId = req.user._id; // assume admin logged in
  const { productId } = req.body;

  // Check if selection exists
  const existingSelection = await AdminSelection.findOne({
    productId,
    adminId,
  });
  if (!existingSelection) {
    return next(
      new AppError("No selection found for this product by you", 404)
    );
  }

  // Delete the selection
  await AdminSelection.deleteOne({ _id: existingSelection._id });

  res.status(200).json({
    status: "success",
    message: "Feature product selection removed successfully",
  });
});

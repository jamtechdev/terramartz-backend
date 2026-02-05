import { PlatformFee } from "../../models/super-admin/platformFee.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

export const createPlatformFee = catchAsync(async (req, res, next) => {
  const { fee, type } = req.body;

  if (!fee || !type) {
    return next(new AppError("Fee and Fee type are required!", 400));
  }

  const existingFee = await PlatformFee.findOne();
  if (existingFee) {
    return next(
      new AppError("Platform Fee already exists! Use update instead.", 400),
    );
  }

  const platformFee = await PlatformFee.create({
    fee,
    type,
  });

  res.status(201).json({
    status: "success",
    message: "Platform Fee created successfully!",
    data: platformFee,
  });
});

export const getAllPlatformFees = catchAsync(async (req, res, next) => {
  const platformFees = await PlatformFee.find().sort({ createdAt: -1 });

  res.status(200).json({
    status: "success",
    results: platformFees.length,
    data: platformFees,
  });
});

export const getPlatformFeeById = catchAsync(async (req, res, next) => {
  const platformFee = await PlatformFee.findById(req.params.id);

  if (!platformFee) {
    return next(new AppError("No Platform Fee found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    data: platformFee,
  });
});

export const updatePlatformFee = catchAsync(async (req, res, next) => {
  const platformFee = await PlatformFee.findByIdAndUpdate(
    req.params.id,
    req.body,
    {
      new: true,
      runValidators: true,
    },
  );

  if (!platformFee) {
    return next(new AppError("No Platform Fee found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    message: "Platform Fee updated successfully!",
    data: platformFee,
  });
});

export const deletePlatformFee = catchAsync(async (req, res, next) => {
  const platformFee = await PlatformFee.findByIdAndDelete(req.params.id);

  if (!platformFee) {
    return next(new AppError("No Platform Fee found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    message: "Platform Fee deleted successfully!",
  });
});

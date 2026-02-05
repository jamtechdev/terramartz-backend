import { DeliveryPartners } from "../../models/seller/deliveryPartners.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

export const createDeliveryPartner = catchAsync(async (req, res, next) => {
  const { name } = req.body;

  if (!name) {
    return next(new AppError("Name is required!", 400));
  }

  const deliveryPartner = await DeliveryPartners.create({
    name,
    seller: req.user ? req.user.id : null,
  });

  res.status(201).json({
    status: "success",
    message: "Delivery partner created successfully!",
    data: deliveryPartner,
  });
});

export const getAllDeliveryPartners = catchAsync(async (req, res, next) => {
  const deliveryPartners = await DeliveryPartners.find({
    seller: req.user.id,
  }).sort({ createdAt: -1 });

  res.status(200).json({
    status: "success",
    results: deliveryPartners.length,
    data: deliveryPartners,
  });
});

export const getDeliveryPartnerById = catchAsync(async (req, res, next) => {
  const deliveryPartner = await DeliveryPartners.findOne({
    _id: req.params.id,
    seller: req.user.id,
  });

  if (!deliveryPartner) {
    return next(new AppError("No delivery partner found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    data: deliveryPartner,
  });
});

export const updateDeliveryPartner = catchAsync(async (req, res, next) => {
  const deliveryPartner = await DeliveryPartners.findOneAndUpdate(
    { _id: req.params.id, seller: req.user.id },
    req.body,
    {
      new: true,
      runValidators: true,
    },
  );

  if (!deliveryPartner) {
    return next(new AppError("No delivery partner found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    message: "Delivery partner updated successfully!",
    data: deliveryPartner,
  });
});

export const deleteDeliveryPartner = catchAsync(async (req, res, next) => {
  const deliveryPartner = await DeliveryPartners.findOneAndDelete({
    _id: req.params.id,
    seller: req.user.id,
  });

  if (!deliveryPartner) {
    return next(new AppError("No delivery partner found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    message: "Delivery partner deleted successfully!",
  });
});

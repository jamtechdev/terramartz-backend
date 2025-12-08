import mongoose from "mongoose";
import { TaxConfig } from "../../models/super-admin/taxWithAdminDiscountConfig.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

export const updateTaxRate = catchAsync(async (req, res, next) => {
  const { rate, limitedTimeOffer } = req.body;
  if (rate === undefined) return next(new AppError("Rate is required", 400));

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 🔹 আগের active tax config খুঁজে নাও
    let taxConfig = await TaxConfig.findOne({ active: true }).session(session);

    if (taxConfig) {
      // 🔹 আগের active config update করো
      taxConfig.rate = rate;
      taxConfig.limitedTimeOffer = limitedTimeOffer || {};
      await taxConfig.save({ session });
    } else {
      // 🔹 যদি কোনো active config না থাকে, নতুন বানাও
      taxConfig = await TaxConfig.create(
        [
          {
            rate,
            active: true,
            limitedTimeOffer: limitedTimeOffer || {},
          },
        ],
        { session }
      );
      taxConfig = taxConfig[0]; // create returns array
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ status: "success", data: taxConfig });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("Transaction failed:", err);
    return next(new AppError(err.message || "Transaction failed", 500));
  }
});

export const getActiveTax = catchAsync(async (req, res, next) => {
  const tax = await TaxConfig.findOne({ active: true });
  if (!tax) return next(new AppError("No active tax found", 404));

  const response = {
    rate: tax.rate,
    active: tax.active,
    limitedTimeOffer: tax.limitedTimeOffer || {}, // 🆕 Limited Time Offer
    createdAt: tax.createdAt,
    updatedAt: tax.updatedAt,
  };

  res.status(200).json({ status: "success", data: response });
});

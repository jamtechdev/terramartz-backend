import { TaxConfig } from "../../models/super-admin/taxWithAdminDiscountConfig.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

const DEFAULT_LOYALTY_POINT_VALUE = 0.1;

export const getAdminSettings = catchAsync(async (req, res, next) => {
  const activeTax =
    (await TaxConfig.findOne({ active: true })) ||
    (await TaxConfig.findOne({ isActive: true }));

  res.status(200).json({
    status: "success",
    data: {
      loyaltyPointValue:
        typeof activeTax?.loyaltyPointValue === "number"
          ? activeTax.loyaltyPointValue
          : DEFAULT_LOYALTY_POINT_VALUE,
    },
  });
});

export const updateAdminSettings = catchAsync(async (req, res, next) => {
  const { loyaltyPointValue } = req.body;

  const parsedValue = Number(loyaltyPointValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return next(
      new AppError("Loyalty point value must be a positive number", 400),
    );
  }

  if (parsedValue > 1000) {
    return next(new AppError("Loyalty point value is unrealistically high", 400));
  }

  let activeTax =
    (await TaxConfig.findOne({ active: true })) ||
    (await TaxConfig.findOne({ isActive: true }));

  if (!activeTax) {
    activeTax = await TaxConfig.create({
      rate: 0,
      active: true,
      loyaltyPointValue: parsedValue,
    });
  } else {
    activeTax.loyaltyPointValue = parsedValue;
    await activeTax.save();
  }

  res.status(200).json({
    status: "success",
    message: "Admin settings updated successfully",
    data: {
      loyaltyPointValue: activeTax.loyaltyPointValue,
    },
  });
});

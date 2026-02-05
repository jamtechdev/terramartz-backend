import mongoose from "mongoose";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import APIFeatures from "../../utils/apiFeatures.js";
import { PromoCode } from "../../models/seller/promoCodes.js";
import { CustomerPromoCodeUse } from "../../models/customers/customerPromoCodeUse.js";

// =================== CREATE PROMO CODE ===================
export const createPromoCode = catchAsync(async (req, res, next) => {
  if (!req.user || req.user.role !== "seller") {
    return next(new AppError("Not authorized to create promo codes", 403));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      code,
      discount,
      expiresAt,
      minOrderAmount,
      type,
      isActive,
      usageLimit,
      perUserLimit,
      sellerId,
    } = req.body;

    if (!code || !type) {
      throw new AppError("Code and type are required", 400);
    }

    // Ensure unique code per seller (or globally if admin)
    const existing = await PromoCode.findOne({
      code,
      sellerId: req.user._id,
    }).session(session);
    if (existing) {
      throw new AppError("Promo code already exists", 400);
    }

    const promo = await PromoCode.create(
      [
        {
          code,
          discount,
          expiresAt,
          minOrderAmount,
          type,
          isActive,
          usageLimit,
          perUserLimit,
          sellerId: req.user._id,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      status: "success",
      promoCode: promo[0],
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
});

// =================== GET ALL PROMO CODES ===================
export const getAllPromoCodes = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, search, type, isActive } = req.query;

  let queryObj = {};
  // Restrict to seller's own promo codes unless admin
  if (req.user && req.user.role === "seller") {
    queryObj.sellerId = req.user._id;
  }
  if (search) {
    queryObj.code = { $regex: new RegExp(search, "i") };
  }
  if (type) queryObj.type = type;
  if (isActive !== undefined) queryObj.isActive = isActive === "true";

  const query = PromoCode.find(queryObj);
  const features = new APIFeatures(query, req.query).paginate();
  const promoCodes = await features.query;

  const total = await PromoCode.countDocuments(queryObj);

  res.status(200).json({
    status: "success",
    page: Number(page),
    limit: Number(limit),
    total,
    results: promoCodes.length,
    promoCodes,
  });
});

// =================== GET SINGLE PROMO CODE ===================
export const getPromoCode = catchAsync(async (req, res, next) => {
  const promo = await PromoCode.findById(req.params.id);
  if (!promo) return next(new AppError("Promo code not found", 404));
  res.status(200).json({ status: "success", promoCode: promo });
});

// =================== UPDATE PROMO CODE ===================
export const updatePromoCode = catchAsync(async (req, res, next) => {
  if (!req.user || req.user.role !== "seller") {
    return next(new AppError("Not authorized to update promo codes", 403));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const promo = await PromoCode.findById(req.params.id).session(session);
    if (
      req.user.role === "seller" &&
      promo.sellerId &&
      promo.sellerId.toString() !== req.user._id.toString()
    ) {
      throw new AppError("Not authorized to update this promo code", 403);
    }
    if (!promo) throw new AppError("Promo code not found", 404);

    const updatableFields = [
      "code",
      "discount",
      "expiresAt",
      "minOrderAmount",
      "type",
      "isActive",
    ];
    updatableFields.forEach((field) => {
      if (req.body[field] !== undefined) promo[field] = req.body[field];
    });

    await promo.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ status: "success", promoCode: promo });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
});

// =================== VALIDATE PROMO CODE ===================
export const validatePromoCode = catchAsync(async (req, res, next) => {
  // Only customers/users can validate promo codes
  if (req.user && req.user.role !== "user") {
    return next(new AppError("Only customers can validate promo codes", 403));
  }
  
  const { code, subtotal, userId } = req.body;
  
  if (!code) return next(new AppError("Promo code is required", 400));
  
  const promo = await PromoCode.findOne({ code, isActive: true });
  if (!promo) return next(new AppError("Invalid promo code", 400));
  
  // Check expiry
  if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
    return next(new AppError("Promo code has expired", 400));
  }
  
  // Check min order amount
  if (promo.minOrderAmount && subtotal < promo.minOrderAmount) {
    return next(new AppError(`Minimum order amount is $${promo.minOrderAmount}`, 400));
  }
  
  // Check total usage limit
  if (promo.usageLimit && promo.usedCount >= promo.usageLimit) {
    return next(new AppError("Promo code usage limit reached", 400));
  }
  
  // Check per-user limit
  if (userId) {
    const userUsageCount = await CustomerPromoCodeUse.countDocuments({
      user_id: userId,
      promoCodeId: promo._id
    });
    if (userUsageCount >= promo.perUserLimit) {
      return next(new AppError("You have already used this promo code", 400));
    }
  }
  
  // Calculate discount
  let discount = 0;
  if (promo.type === "fixed") {
    discount = promo.discount;
  } else if (promo.type === "percentage") {
    discount = (subtotal * promo.discount) / 100;
  }
  
  res.status(200).json({
    status: "success",
    valid: true,
    discount,
    promoCode: promo
  });
});

// =================== APPLY PROMO CODE ===================
export const applyPromoCode = catchAsync(async (req, res, next) => {
  // Only customers/users can apply promo codes
  if (!req.user || req.user.role !== "user") {
    return next(new AppError("Only customers can apply promo codes", 403));
  }
  
  const { promoCodeId, userId, purchaseId } = req.body;
  
  // Verify the requesting user matches the userId in request body
  if (userId !== req.user._id.toString()) {
    return next(new AppError("Unauthorized to apply promo code for another user", 403));
  }
  
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const promo = await PromoCode.findById(promoCodeId).session(session);
    if (!promo) throw new AppError("Promo code not found", 404);
    
    // Record usage
    await CustomerPromoCodeUse.create([{
      user_id: userId,
      promoCodeId: promoCodeId,
      purchase_id: purchaseId
    }], { session });
    
    // Update promo code usage count
    await PromoCode.findByIdAndUpdate(
      promoCodeId,
      { 
        $inc: { usedCount: 1 }
      },
      { session }
    );
    
    await session.commitTransaction();
    session.endSession();
    
    res.status(200).json({
      status: "success",
      message: "Promo code applied successfully"
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
});

// =================== GET PROMO CODE USAGE ===================
export const getPromoCodeUsage = catchAsync(async (req, res, next) => {
  const promoCodeId = req.params.id;
  
  const usage = await CustomerPromoCodeUse.find({ promoCodeId })
    .populate("user_id", "name email")
    .populate("purchase_id", "totalAmount status");
  
  const totalUses = usage.length;
  const uniqueUsers = [...new Set(usage.map(u => u.user_id._id.toString()))].length;
  
  res.status(200).json({
    status: "success",
    totalUses,
    uniqueUsers,
    usageDetails: usage
  });
});

// =================== DELETE PROMO CODE ===================
export const deletePromoCode = catchAsync(async (req, res, next) => {
  if (!req.user || req.user.role !== "seller") {
    return next(new AppError("Not authorized to delete promo codes", 403));
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const promo = await PromoCode.findById(req.params.id).session(session);
    if (!promo) throw new AppError("Promo code not found", 404);
    // Ensure seller owns the promo code unless admin
    if (
      req.user.role === "seller" &&
      promo.sellerId &&
      promo.sellerId.toString() !== req.user._id.toString()
    ) {
      throw new AppError("Not authorized to delete this promo code", 403);
    }
    await PromoCode.findByIdAndDelete(req.params.id).session(session);
    await session.commitTransaction();
    session.endSession();
    res.status(204).json({ status: "success", message: "Promo code deleted" });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
});

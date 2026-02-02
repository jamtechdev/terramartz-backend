import { Admin } from "../../models/super-admin/admin.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import APIFeatures from "../../utils/apiFeatures.js";

// GET - Get All Admins (Super Admin Only)
export const getAllAdmins = catchAsync(async (req, res, next) => {
  // Only Super Admins can view all admins
  if (req.user.role !== "Super Admin") {
    return next(
      new AppError("Only Super Admins can access this resource", 403)
    );
  }

  const features = new APIFeatures(Admin.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const admins = await features.query;

  const total = await Admin.countDocuments(features.queryString);

  res.status(200).json({
    status: "success",
    results: admins.length,
    total,
    pagination: {
      page: req.query.page * 1 || 1,
      limit: req.query.limit * 1 || 10,
      totalPages: Math.ceil(total / (req.query.limit * 1 || 10)),
    },
    data: {
      admins: admins.map(admin => ({
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        phoneNumber: admin.phoneNumber,
        role: admin.role,
        isActive: admin.isActive,
        permissions: admin.permissions,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt
      })),
    },
  });
});

// GET - Get Specific Admin by ID (Super Admin Only)
export const getAdminById = catchAsync(async (req, res, next) => {
  // Only Super Admins can view specific admin details
  if (req.user.role !== "Super Admin") {
    return next(
      new AppError("Only Super Admins can access this resource", 403)
    );
  }

  const admin = await Admin.findById(req.params.id);

  if (!admin) {
    return next(new AppError("Admin not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        phoneNumber: admin.phoneNumber,
        role: admin.role,
        isActive: admin.isActive,
        permissions: admin.permissions,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt
      },
    },
  });
});
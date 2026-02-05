import { Admin } from "../../models/super-admin/admin.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import APIFeatures from "../../utils/apiFeatures.js";

// GET - Get All Admins (Super Admin Only)
export const getAllAdmins = catchAsync(async (req, res, next) => {
const features = new APIFeatures(Admin.find(), req.query)
    .search()
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
      admins: admins.map((admin) => ({
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        phoneNumber: admin.phoneNumber,
        role: admin.role,
        isActive: admin.isActive,
        permissions: admin.permissions,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
      })),
    },
  });
});

// GET - Get Specific Admin by ID (Super Admin Only)
export const getAdminById = catchAsync(async (req, res, next) => {
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
        updatedAt: admin.updatedAt,
      },
    },
  });
});

// ✅ Update staff member
export const updateStaff = catchAsync(async (req, res, next) => {
  const { name, phoneNumber, role } = req.body;
  const updateData = {};

  if (name !== undefined) updateData.name = name;
  if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
  if (role !== undefined) updateData.role = role;

  const staff = await Admin.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });

  if (!staff) {
    return next(new AppError("No staff member found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    message: "Staff member updated successfully!",
    data: staff,
  });
});

// ✅ Toggle staff status
export const toggleStaffStatus = catchAsync(async (req, res, next) => {
  const staff = await Admin.findById(req.params.id);

  if (!staff) {
    return next(new AppError("No staff member found with that ID!", 404));
  }

  staff.isActive = !staff.isActive;
  await staff.save();

  res.status(200).json({
    status: "success",
    message: `Staff member ${staff.isActive ? "activated" : "deactivated"} successfully!`,
    data: staff,
  });
});

// ✅ Delete staff member
export const deleteStaff = catchAsync(async (req, res, next) => {
  const staff = await Admin.findByIdAndDelete(req.params.id);

  if (!staff) {
    return next(new AppError("No staff member found with that ID!", 404));
  }

  res.status(200).json({
    status: "success",
    message: "Staff member deleted successfully!",
  });
});

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Admin } from "../../models/super-admin/admin.js";

// {
//     "email": "admin@terramartz.com",
//     "password": "Admin@123"
//   }

// Admin login
export const adminLogin = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError("Email and password are required", 400));
  }

  const user = await Admin.findOne({ email });

  if (!user) {
    return next(new AppError("Invalid credentials", 401));
  }

  if (!user.isActive) {
    return next(new AppError("Account is deactivated", 401));
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return next(new AppError("Invalid credentials", 401));
  }

  const token = jwt.sign(
    { id: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  res.status(200).json({
    status: "success",
    token,
    data: {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: Number.parseInt(user.phoneNumber),
        role: user.role,
        isActive: user.isActive,
        permissions: user.permissions,
      },
    },
  });
});

export const adminRegister = catchAsync(async (req, res, next) => {
  const { name, email, phoneNumber, password, role } = req.body;

  if (!name || !email || !password) {
    return next(new AppError("Name, email and password are required", 400));
  }

  const existingAdmin = await Admin.findOne({ email });
  if (existingAdmin) {
    return next(new AppError("Email already exists", 400));
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const newAdmin = await Admin.create({
    name,
    email,
    phoneNumber,
    password: hashedPassword,
    role: role || "Read-Only",
  });

  const token = jwt.sign(
    { id: newAdmin._id.toString(), role: newAdmin.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  res.status(201).json({
    status: "success",
    token,
    data: {
      user: {
        _id: newAdmin._id,
        name: newAdmin.name,
        email: newAdmin.email,
        phoneNumber: newAdmin.phoneNumber,
        role: newAdmin.role,
        isActive: newAdmin.isActive,
        permissions: newAdmin.permissions,
      },
    },
  });
});

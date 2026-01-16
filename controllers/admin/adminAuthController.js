import { User } from "../../models/users.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// {
//     "email": "admin@terramartz.com",
//     "password": "Admin@123"
//   }

// Admin login
export const adminLogin = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // ✅ Validate input
  if (!email || !password) {
    return next(new AppError("Email and password are required", 400));
  }

  // ✅ Find admin user
  const user = await User.findOne({ email, role: "admin" }).select("+password");
  if (!user) {
    return next(new AppError("Invalid credentials", 401));
  }

  // ✅ Check password
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return next(new AppError("Invalid credentials", 401));
  }

  // ✅ Generate JWT with string _id
  const token = jwt.sign(
    { id: user._id.toString(), role: user.role }, // always string
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  // ✅ Send response
  res.status(200).json({
    status: "success",
    token,
    data: {
      user: {
        _id: user._id,
        email: user.email,
        role: user.role,
      },
    },
  });
});;

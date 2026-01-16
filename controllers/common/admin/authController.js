import jwt from "jsonwebtoken";
import AppError from "../../../utils/apperror.js";
import catchAsync from "../../../utils/catchasync.js";
import { User } from "../../../models/users.js";

export const protectAdmin = catchAsync(async (req, res, next) => {
  // 1️⃣ Get token
  const token = req.headers.authorization?.startsWith("Bearer")
    ? req.headers.authorization.split(" ")[1]
    : req.cookies?.token || req.cookies?.jwt;
  if (!token) {
    return next(
      new AppError("You are not logged in! Please login to get access.", 401)
    );
  }

  // 2️⃣ Verify token
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(
      new AppError("Invalid or expired token. Please login again.", 401)
    );
  }

  // 3️⃣ Find user in DB
  const user = await User.findOne({ _id: decoded.id });
  if (!user) {
    return next(
      new AppError("The user belonging to this token no longer exists.", 401)
    );
  }

  // 4️⃣ Check admin role
  if (user.role !== "admin") {
    return next(
      new AppError("You are not authorized to access this resource.", 403)
    );
  }

  // 5️⃣ Grant access
  req.user = user;
  res.locals.user = user;
  next();
});

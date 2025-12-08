import AppError from "../../utils/apperror.js";

export const restrictToAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return next(
      new AppError("You are not authorized to perform this action.", 403)
    );
  }
  next();
};

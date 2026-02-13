import AppError from "../utils/apperror.js";
// import logger from "../utils/logger.js";

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join(" ")}`;
  return new AppError(message, 400);
};

const handleDuplicateKeyErrorDB = (err) => {
  let message = "";

  Object.entries(err.keyValue).forEach(([key, value]) => {
    message = message + `${key}: ${value} is already exist. `;
  });

  return new AppError(message, 400);
};
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400);
};
const handleJWTError = (err) =>
  new AppError("Invalid token. Please log in again", 401);
const handleJWTExpiredError = (err) =>
  new AppError("Your token has expired! please log in again!", 401);

//development error middleware
function developmentError(err, req, res) {
  console.log("Global Error For ErrorController");
  console.log(err);
  // ✨ Log error
  // logger.error({
  //   timestamp: new Date().toISOString(),
  //   method: req.method,
  //   url: req.originalUrl,
  //   message: err.message,
  //   stack: err.stack,
  //   status: err.status,
  //   statusCode: err.statuscode,
  // });
  res.status(err.statuscode).json({
    status: err.status,
    message: err.message,
    err,
  });
}
//production error middleware
function productionError(err, req, res) {
  console.log("Global Error For ErrorController");
  console.log(err);

  // ✨ Log error
  // logger.error({
  //   timestamp: new Date().toISOString(),
  //   method: req.method,
  //   url: req.originalUrl,
  //   message: err.message,
  //   stack: err.stack,
  //   status: err.status,
  //   statusCode: err.statuscode,
  // });

  if (err.isoperational) {
    res.status(err.statuscode).json({
      status: err.status,
      message: err.message,
    });
  } else {
    res.status(500).json({
      status: "error",
      message: "something went error!!!",
    });
  }
}

export default (err, req, res, next) => {
  err.statuscode = err.statuscode || 500;
  err.status = err.status || "error";
  if (process.env.NODE_ENV === "development") {
    if (err?.errorResponse?.code === 11000) {
      let error = handleDuplicateKeyErrorDB(err);
      developmentError(error, req, res);
    } else if (err?.name === "CastError") {
      let error = handleCastErrorDB(err);
      developmentError(error, req, res);
    } else if (err?.name === "ValidationError") {
      let error = handleValidationErrorDB(err);
      developmentError(error, req, res);
    } else {
      developmentError(err, req, res);
    }
  } else if (process.env.NODE_ENV === "production") {
    if (err?.errorResponse?.code === 11000) {
      let error = handleDuplicateKeyErrorDB(err);
      productionError(error, req, res);
    } else if (err?.name === "CastError") {
      let error = handleCastErrorDB(err);
      productionError(error, req, res);
    } else if (err.name === "JsonWebTokenError") {
      let error = handleJWTError(err);
      productionError(error, req, res);
    } else if (err.name === "TokenExpiredError") {
      let error = handleJWTExpiredError(err);
      productionError(error, req, res);
    } else if (err?.name === "ValidationError") {
      let error = handleValidationErrorDB(err);
      productionError(error, req, res);
    } else {
      productionError(err, req, res);
    }
  }

  return next();
};

class AppError extends Error {
  constructor(message, statuscode) {
    super(message);
    this.statuscode = statuscode;
    this.status = `${this.statuscode}`.startsWith("4") ? "fail" : "error";
    this.isoperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ES Module export
export default AppError;

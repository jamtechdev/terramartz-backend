import AppError from "../../../utils/apperror.js";
import catchAsync from "../../../utils/catchasync.js";
import jwt from "jsonwebtoken";
import { Admin } from "../../../models/super-admin/admin.js";
import { adminLogger } from "../../../utils/logger.js";

/**
 * @desc Middleware to protect admin routes with role-based access control (RBAC)
 * @param {string|null} module - The module name to check permissions for (e.g., 'Orders', 'Dashboard')
 * @param {string|null} requiredAccess - The minimum access level required ('View' or 'Full')
 *
 * @returns {Function} Express middleware function
 *
 * @throws {AppError} 401 - If no token provided or token is invalid
 * @throws {AppError} 403 - If user account is inactive or lacks required permissions
 *
 * @example
 * // Allow any authenticated admin (no module check)
 * router.get('/profile', protectAdmin(), getProfile);
 *
 * @example
 * // Require at least View access to Orders module
 * // Users with 'View' OR 'Full' access will be allowed
 * router.get('/orders', protectAdmin('Orders', 'View'), getOrders);
 *
 * @example
 * // Require Full access to Orders module
 * // Only users with 'Full' access will be allowed
 * router.post('/orders', protectAdmin('Orders', 'Full'), createOrder);
 *
 * @how_it_works
 * 1. Extracts JWT token from Authorization header or cookies
 * 2. Verifies token and finds the admin user in database
 * 3. Checks if user account is active
 * 4. If module and requiredAccess are specified:
 *    - Looks up user's permission for that module from ROLE_PERMISSIONS matrix
 *    - Checks if user's permission level meets or exceeds required level
 *    - 'Full' access satisfies both 'View' and 'Full' requirements
 *    - 'View' access only satisfies 'View' requirements
 * 5. Attaches user object to req.user and res.locals.user for downstream use
 *
 * @permission_logic
 * - No access ('No'): User cannot access the module at all
 * - View access: User can read/view data but cannot modify
 * - Full access: User can read, create, update, and delete (includes View)
 */
export const protectAdmin = (module = null, requiredAccess = null) => {
  return catchAsync(async (req, res, next) => {
    // Extract token from Authorization header or cookies
    const token = req.headers.authorization?.startsWith("Bearer")
      ? req.headers.authorization.split(" ")[1]
      : req.cookies?.token || req.cookies?.jwt;

    if (!token) {
      return next(
        new AppError("You are not logged in! Please login to get access.", 401),
      );
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.log(err);

      return next(
        new AppError("Invalid or expired token. Please login again.", 401),
      );
    }

    // Find admin user by ID from token
    const user = await Admin.findOne({ _id: decoded.id });
    if (!user) {
      return next(
        new AppError("The user belonging to this token no longer exists.", 401),
      );
    }

    // Verify account is active
    if (!user.isActive) {
      return next(
        new AppError(
          "Your account has been deactivated. Contact administrator.",
          403,
        ),
      );
    }

    // Check module-specific permissions if specified
    if (module && requiredAccess) {
      // Use the hasPermission method from Admin schema
      // This checks the ROLE_PERMISSIONS matrix to see if user's role
      // has the required access level for the specified module
      const hasAccess = user.hasPermission(module, requiredAccess);

      if (!hasAccess) {
        return next(
          new AppError(
            `You do not have ${requiredAccess} access to the ${module} module.`,
            403,
          ),
        );
      }
    }

    // Attach authenticated user to request and response locals
    req.user = user;
    res.locals.user = user;
    next();
  });
};

// how to use this
// router.get('/orders', protectAdmin('Orders', 'View'), getOrders);

export const adminAuditLogger = (req, res, next) => {
  const start = Date.now();

  const maskSensitive = (obj) => {
    const copy = JSON.parse(JSON.stringify(obj || {}));
    const keysToMask = ["password", "token", "secret", "otp"];
    keysToMask.forEach((k) => {
      if (copy && Object.prototype.hasOwnProperty.call(copy, k)) {
        copy[k] = "[REDACTED]";
      }
    });
    return copy;
  };

  res.on("finish", () => {
    const entry = {
      time: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
      ip: req.ip,
      adminId: req.user?._id || null,
      adminEmail: (req.user && req.user.email) || req.body?.email || null,
      body: maskSensitive(req.body),
      query: req.query || {},
      params: req.params || {},
      userAgent: req.headers["user-agent"] || "",
    };
    try {
      adminLogger.info(JSON.stringify(entry));
    } catch (e) {
      // swallow logging errors
    }
  });

  next();
};

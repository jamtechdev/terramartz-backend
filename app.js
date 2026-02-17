import express from "express";
import swaggerUi from "swagger-ui-express";
import fs from "fs";

// =====================
// Required Imports
// =====================
import morgan from "morgan";
import path from "path";
import cors from "cors";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url"; // <-- ES Module
import AppError from "./utils/apperror.js";
// import logger from "./utils/logger.js"; // logger import
import GlobalError from "./controllers/errorcontroller.js";

import userRouter from "./routes/userRouters.js";
import categoryRouter from "./routes/super-admin/categoryRoutes.js";
import productRouter from "./routes/productRoutes.js";
import cartRouter from "./routes/customers/cartRoutes.js";
import purchaseRouter from "./routes/customers/stripeRoutes.js";
import * as stripeController from "./controllers/customers/stripeController.js";
import farmsRouter from "./routes/common/farmsRoutes.js";
import adminRoutes from "./routes/super-admin/adminRoutes.js";
import reviewRouter from "./routes/common/reviewRoutes.js";
import salesRoutes from "./routes/seller/salesRoutes.js";
import faqRoutes from "./routes/common/faqRoutes.js";
import newsletterRoutes from "./routes/customers/newsletterRoutes.js";
import contactInquiryRoutes from "./routes/common/contactInquiryRoutes.js";
import notificationRoutes from "./routes/common/notificationRoutes.js";
import customersWishlistRoutes from "./routes/customers/wishlistRoutes.js";
import customersDashboardRoutes from "./routes/customers/dashboardRoutes.js";
import sellerStoreDetailRoutes from "./routes/seller/sellerStoreDetailRoutes.js";
import stripeConnectRoutes from "./routes/sellers/stripeConnectRoutes.js";
import userLatestRoutes from "./routes/customers/usersRoutes.js";
// KYC Routes
import kycRoutes from "./routes/sellers/kycRoutes.js";
import adminKYCRoutes from "./routes/admin/adminKYCRoutes.js";
// new api design part
import customersCategoriesRoutes from "./routes/customers/categoriesRoutes.js";
import customersProductsRoutes from "./routes/customers/productsRoutes.js";
import platformStatsRoutes from "./routes/common/platformStatsRoutes.js";
import adminCategoriesRoutes from "./routes/admin/adminCategoriesRoutes.js";
import adminPurchaseRoutes from "./routes/admin/adminPurchaseRoutes.js";
import adminUserRoutes from "./routes/admin/adminUserRoutes.js";
import adminAuthRoutes from "./routes/admin/adminAuthRoutes.js";
import adminProductRoutes from "./routes/admin/adminProductRoutes.js";
import adminManagementRoutes from "./routes/admin/adminManagementRoutes.js";
import sellerPromoCodeRoute from "./routes/seller/promoCodeRoute.js";
import sellerProductRoutes from "./routes/seller/productsRoutes.js";
import adminPlatformFeeRoute from "./routes/super-admin/platformFeeRoute.js";
import adminDashboardRoute from "./routes/super-admin/adminDashboardRoute.js";
import sellerDeliveryPartnersRoute from "./routes/sellers/deliveryPartnersRoute.js";
import { adminAuditLogger } from "./controllers/common/admin/authController.js";

// Blog Management Routes
import adminBlogCategoryRoutes from "./routes/admin/blogCategoryRoutes.js";
import adminBlogRoutes from "./routes/admin/blogRoutes.js";
import adminMediaRoutes from "./routes/admin/mediaRoutes.js";
import adminSettlementRoutes from "./routes/admin/adminSettlementRoutes.js";
import adminLogsRoutes from "./routes/admin/adminLogsRoutes.js";
import blogPublicRoutes from "./routes/common/blogPublicRoutes.js";

// =====================
// __dirname setup
// =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================
// Express App
// =====================
const app = express();
// Morgan → auto log each request
// app.use(
//   morgan("combined", {
//     stream: { write: (message) => logger.info(message.trim()) },
//   })
// );

// Stripe webhook
app.use(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeController.webhookPayment,
);

// Views & Static
app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Middlewares
app.use(cookieParser());

// Increase body size limits for file uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// CORS configuration - explicitly allow frontend origin
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      // List of allowed origins
      const allowedOrigins = [
        "http://35.168.8.254.nip.io",
        "https://35.168.8.254.nip.io",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://admin.35.168.8.254.nip.io",
      ];

      // Check if origin is allowed
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // For development, allow all origins
        if (process.env.NODE_ENV !== "production") {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// =====================
// API Routes
// =====================
//seller routes and connected to file "/terrmraz/admin/farms"
app.use("/api/users", userRouter);
app.use("/api/category", categoryRouter);
app.use("/api/categories", categoryRouter); // Alias for backward compatibility
app.use("/api/products", productRouter);
app.use("/api/cart", cartRouter);
app.use("/api/purchase", purchaseRouter);
app.use("/api/reviews", reviewRouter);
app.use("/api/newsletter", newsletterRoutes);
app.use("/api/contact", contactInquiryRoutes);
app.use("/api/notifications", notificationRoutes);

app.use("/api/faqs", faqRoutes);
app.use("/api/farms", farmsRouter);
app.use("/api/seller", salesRoutes);
app.use("/api/seller/stripe-connect", stripeConnectRoutes);
// KYC Routes
app.use("/api/seller/kyc", kycRoutes);
app.use("/api/seller/delivery-partners", sellerDeliveryPartnersRoute);
app.use("/api/admin/kyc", adminKYCRoutes);

// new api design
app.use("/api/terramartz/users", userLatestRoutes);
app.use("/api/terramartz/categories", customersCategoriesRoutes);
app.use("/api/terramartz/products", customersProductsRoutes);
app.use("/api/terramartz/wishlist", customersWishlistRoutes);
app.use("/api/terramartz/customer", customersDashboardRoutes);
app.use("/api/terramartz/sellers", sellerStoreDetailRoutes);
app.use("/api/stats", platformStatsRoutes);

//admin routes
app.use("/api/admin", adminAuditLogger);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/categories", adminCategoriesRoutes);
app.use("/api/admin/user-transactions", adminPurchaseRoutes);
app.use("/api/admin/users", adminUserRoutes);
app.use("/api/admin/products", adminProductRoutes);
app.use("/api/admin/accounts", adminManagementRoutes);
app.use("/api/seller/promo-code", sellerPromoCodeRoute);
app.use("/api/seller/products", sellerProductRoutes);
app.use("/api/admin/platform-fee", adminPlatformFeeRoute);
app.use("/api/admin/dashboard", adminDashboardRoute);
app.use("/api/admin/logs", adminLogsRoutes);

// Blog Routes
app.use("/api/admin/blog-categories", adminBlogCategoryRoutes);
app.use("/api/admin/blogs", adminBlogRoutes);
app.use("/api/admin/media", adminMediaRoutes);
app.use("/api/admin/settlements", adminSettlementRoutes);
app.use("/api/blogs", blogPublicRoutes);

// =====================
// Swagger UI
// =====================
// Vercel-compatible absolute path
const swaggerFilePath = path.join(process.cwd(), "swagger_output.json");

let swaggerFile = {};
try {
  swaggerFile = JSON.parse(fs.readFileSync(swaggerFilePath, "utf8"));
} catch (err) {
  console.warn(
    "⚠️ swagger_output.json not found. Make sure you run 'node swagger.js' locally and commit the file.",
  );
}

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerFile));

// =====================
// 404 Handler
// =====================
app.all("*", (req, res, next) => {
  return next(new AppError(`Cannot find this URL: ${req.originalUrl}`, 404));
});

// Global Error Middleware
app.use(GlobalError);

export default app;

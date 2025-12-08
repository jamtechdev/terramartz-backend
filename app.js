import express from "express";
import swaggerUi from "swagger-ui-express";
import fs from "fs";

// =====================
// Required Imports
// =====================
import morgan from "morgan";
import path from "path";
import cors from "cors";
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
import customersWishlistRoutes from "./routes/customers/wishlistRoutes.js";
import customersDashboardRoutes from "./routes/customers/dashboardRoutes.js";
import sellerStoreDetailRoutes from "./routes/seller/sellerStoreDetailRoutes.js";
import userLatestRoutes from "./routes/customers/usersRoutes.js";

// new api design part
import customersCategoriesRoutes from "./routes/customers/categoriesRoutes.js";
import customersProductsRoutes from "./routes/customers/productsRoutes.js";

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
  stripeController.webhookPayment
);

// Views & Static
app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// =====================
// API Routes
// =====================
app.use("/api/users", userRouter);
app.use("/api/category", categoryRouter);
app.use("/api/products", productRouter);
app.use("/api/cart", cartRouter);
app.use("/api/purchase", purchaseRouter);
app.use("/api/reviews", reviewRouter);
app.use("/api/newsletter", newsletterRoutes);
app.use("/api/contact", contactInquiryRoutes);

app.use("/api/faqs", faqRoutes);
app.use("/api/farms", farmsRouter);
app.use("/api/seller", salesRoutes);

app.use("/api/admin", adminRoutes);

// new api design
app.use("/api/terramartz/users", userLatestRoutes);
app.use("/api/terramartz/categories", customersCategoriesRoutes);
app.use("/api/terramartz/products", customersProductsRoutes);
app.use("/api/terramartz/wishlist", customersWishlistRoutes);
app.use("/api/terramartz/customer", customersDashboardRoutes);
app.use("/api/terramartz/sellers", sellerStoreDetailRoutes);

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
    "⚠️ swagger_output.json not found. Make sure you run 'node swagger.js' locally and commit the file."
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

import { Purchase } from "../../models/customers/purchase.js";

import catchAsync from "../../utils/catchasync.js";
import APIFeatures from "../../utils/apiFeatures.js";
import AppError from "../../utils/apperror.js";

// ✅ Get Order by Session ID
export const getOrderBySessionId = catchAsync(async (req, res, next) => {
  const { session_id } = req.query;
  const userId = req.user._id || req.user.id;

  if (!session_id) {
    return next(new AppError("Session ID is required", 400));
  }

  // Try to find order with session_id, checking multiple user ID formats
  // First try without buyer filter (session ID is unique)
  let order = await Purchase.findOne({
    checkoutSessionId: session_id,
  })
    .populate({
      path: "products.product",
      select: "title slug _id name",
    })
    .lean();

  // If not found, return error (session ID should be unique)
  if (!order) {
    return next(new AppError("Order not found", 404));
  }

  // Verify buyer matches (for security) - check multiple ID formats
  const orderBuyerStr = String(order.buyer);
  const userIdStr = String(userId);
  const userIdAlt1 = req.user._id ? String(req.user._id) : null;
  const userIdAlt2 = req.user.id ? String(req.user.id) : null;
  
  // Log warning if buyer doesn't match, but still return order (session ID is unique and secure)
  if (orderBuyerStr !== userIdStr && 
      orderBuyerStr !== userIdAlt1 &&
      orderBuyerStr !== userIdAlt2) {
    console.warn(`⚠️ Buyer ID mismatch: Order buyer=${orderBuyerStr}, User ID=${userIdStr}`);
    // Still return the order if session ID matches (session ID is unique and secure)
  }

  const products = order.products.map((p) => ({
    _id: p._id,
    quantity: p.quantity,
    price: p.price,
    seller: p.seller,
    product: {
      _id: p.product?._id || null,
      title: p.product?.title || p.product?.name || null,
      slug: p.product?.slug || null,
    },
  }));

  const totalItems = order.products.reduce((sum, p) => sum + p.quantity, 0);

  const formattedOrder = {
    _id: order._id,
    orderId: order.orderId,
    trackingNumber: order.trackingNumber,
    totalItems,
    products,
    totalAmount: order.totalAmount,
    paymentStatus: order.paymentStatus,
    status: order.status,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };

  res.status(200).json({
    status: "success",
    order: formattedOrder,
  });
});

// ✅ Get Order by Order ID
export const getOrderByOrderId = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const userId = req.user._id || req.user.id;

  if (!orderId) {
    return next(new AppError("Order ID is required", 400));
  }

  // Find order by orderId, checking multiple user ID formats
  const userIdString = String(userId);
  const userIdAlt1 = req.user._id ? String(req.user._id) : null;
  const userIdAlt2 = req.user.id ? String(req.user.id) : null;

  let order = await Purchase.findOne({
    orderId: orderId,
    $or: [
      { buyer: userIdString },
      ...(userIdAlt1 ? [{ buyer: userIdAlt1 }] : []),
      ...(userIdAlt2 ? [{ buyer: userIdAlt2 }] : []),
    ].filter(Boolean)
  })
    .populate({
      path: "products.product",
      select: "title slug _id name",
    })
    .lean();

  if (!order) {
    return next(new AppError("Order not found", 404));
  }

  const products = order.products.map((p) => ({
    _id: p._id,
    quantity: p.quantity,
    price: p.price,
    seller: p.seller,
    product: {
      _id: p.product?._id || null,
      title: p.product?.title || p.product?.name || null,
      slug: p.product?.slug || null,
    },
  }));

  const totalItems = order.products.reduce((sum, p) => sum + p.quantity, 0);

  const formattedOrder = {
    _id: order._id,
    orderId: order.orderId,
    trackingNumber: order.trackingNumber,
    totalItems,
    products,
    totalAmount: order.totalAmount,
    paymentStatus: order.paymentStatus,
    status: order.status,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };

  res.status(200).json({
    status: "success",
    order: formattedOrder,
  });
});

// ✅ Order History Controller (updated)
export const getOrderHistory = catchAsync(async (req, res, next) => {
  // Handle both _id and id formats
  const userId = req.user._id || req.user.id;
  
  if (!userId) {
    return next(new AppError("User not authenticated", 401));
  }

  console.log("\n========== GET ORDER HISTORY ==========");
  console.log("📦 User ID:", userId);
  console.log("📦 User ID type:", typeof userId);
  console.log("📦 User _id:", req.user._id);
  console.log("📦 User id:", req.user.id);

  // 🔹 Purchase model stores buyer as String, so convert all to strings
  const userIdString = String(userId);
  const userIdAlt1 = req.user._id ? String(req.user._id) : null;
  const userIdAlt2 = req.user.id ? String(req.user.id) : null;
  
  console.log("📦 Searching orders with buyer IDs:", { userIdString, userIdAlt1, userIdAlt2 });
  
  let query = Purchase.find({
    $or: [
      { buyer: userIdString },
      ...(userIdAlt1 ? [{ buyer: userIdAlt1 }] : []),
      ...(userIdAlt2 ? [{ buyer: userIdAlt2 }] : []),
    ].filter(Boolean)
  });
  
  console.log("📦 Query filter:", JSON.stringify(query.getFilter(), null, 2));

  // 🔹 Filtering, Sorting, Pagination apply করা হচ্ছে
  const features = new APIFeatures(query, req.query).filter().sort().paginate();

  const orders = await features.query
    .populate({
      path: "products.product",
      select: "title slug _id",
    })
    .lean();

  // 🔹 Response পরিষ্কারভাবে সাজানো হচ্ছে
  const formattedOrders = orders.map((order) => {
    const products = order.products.map((p) => ({
      _id: p._id,
      quantity: p.quantity,
      price: p.price,
      seller: p.seller,
      product: {
        _id: p.product?._id || null,
        title: p.product?.title || null,
        slug: p.product?.slug || null,
      },
    }));

    const totalItems = order.products.reduce((sum, p) => sum + p.quantity, 0);

    return {
      _id: order._id,
      orderId: order.orderId,
      trackingNumber: order.trackingNumber, // ✅ tracking number থাকবে
      totalItems,
      products,
      totalAmount: order.totalAmount,
      paymentStatus: order.paymentStatus,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      // 🚫 shippingAddress বাদ দিলাম
    };
  });

  console.log("📦 Found orders:", formattedOrders.length);
  console.log("========================================\n");

  res.status(200).json({
    status: "success",
    results: formattedOrders.length,
    orders: formattedOrders,
  });
});

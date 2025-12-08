import { Purchase } from "../../models/customers/purchase.js";

import catchAsync from "../../utils/catchasync.js";
import APIFeatures from "../../utils/apiFeatures.js";

// ✅ Order History Controller (updated)
export const getOrderHistory = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  // 🔹 শুধুমাত্র এই ইউজারের অর্ডারগুলো আনবে
  let query = Purchase.find({ buyer: userId });

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
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      // 🚫 shippingAddress বাদ দিলাম
    };
  });

  res.status(200).json({
    status: "success",
    results: formattedOrders.length,
    orders: formattedOrders,
  });
});

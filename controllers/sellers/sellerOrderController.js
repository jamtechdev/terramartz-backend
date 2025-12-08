import { Purchase } from "../../models/customers/purchase.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

// https://terramartz-backend-v2.onrender.com/api/seller/orders?page=1&limit=10&sort=recent
// https://terramartz-backend-v2.onrender.com/api/seller/orders?page=1&limit=10&sort=oldest
export const getSellerOrdersPerfect = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;

  // if (!sellerId) return next(new AppError("Seller not authenticated", 401));

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  // ✅ শুধু এই এক লাইন নতুন
  const sortType = req.query.sort === "oldest" ? 1 : -1;
  // যদি ?sort=oldest থাকে → ascending
  // না থাকলে default → recent (-1)

  const ordersAggregation = [
    { $unwind: "$products" },
    { $match: { "products.seller": sellerId } },

    // ProductPerformance
    {
      $lookup: {
        from: "productperformances",
        localField: "products.product",
        foreignField: "product",
        as: "products.performance",
      },
    },

    // Product info
    {
      $lookup: {
        from: "products",
        localField: "products.product",
        foreignField: "_id",
        as: "products.productInfo",
      },
    },

    // Product Seller info (hide password)
    {
      $lookup: {
        from: "users",
        localField: "products.productInfo.createdBy",
        foreignField: "_id",
        as: "products.productInfo.sellerInfo",
      },
    },

    // Buyer info (hide password)
    {
      $lookup: {
        from: "users",
        localField: "buyer",
        foreignField: "_id",
        as: "buyerInfo",
      },
    },

    // Project only required fields
    {
      $project: {
        orderId: 1,
        shippingAddress: 1,
        paymentStatus: 1,
        status: 1,
        createdAt: 1,
        updatedAt: 1,
        products: {
          product: 1,
          quantity: 1,
          price: 1,
          seller: 1,
          performance: 1,
          productInfo: {
            _id: 1,
            title: 1,
            description: 1,
            price: 1,
            originalPrice: 1,
            stockQuantity: 1,
            productImages: 1,
            tags: 1,
            organic: 1,
            featured: 1,
            productType: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            sellerInfo: {
              _id: 1,
              firstName: 1,
              lastName: 1,
              email: 1,
              phoneNumber: 1,
              role: 1,
              accountType: 1,
              sellerProfile: 1,
              status: 1,
              isAccountVerified: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        },
        buyer: {
          $arrayElemAt: [
            [
              {
                _id: { $arrayElemAt: ["$buyerInfo._id", 0] },
                firstName: { $arrayElemAt: ["$buyerInfo.firstName", 0] },
                lastName: { $arrayElemAt: ["$buyerInfo.lastName", 0] },
                email: { $arrayElemAt: ["$buyerInfo.email", 0] },
                phoneNumber: { $arrayElemAt: ["$buyerInfo.phoneNumber", 0] },
                role: { $arrayElemAt: ["$buyerInfo.role", 0] },
                accountType: { $arrayElemAt: ["$buyerInfo.accountType", 0] },
                sellerProfile: {
                  $arrayElemAt: ["$buyerInfo.sellerProfile", 0],
                },
                status: { $arrayElemAt: ["$buyerInfo.status", 0] },
                isAccountVerified: {
                  $arrayElemAt: ["$buyerInfo.isAccountVerified", 0],
                },
                createdAt: { $arrayElemAt: ["$buyerInfo.createdAt", 0] },
                updatedAt: { $arrayElemAt: ["$buyerInfo.updatedAt", 0] },
              },
            ],
            0,
          ],
        },
      },
    },

    // ✅ শুধু এই লাইন পরিবর্তন (dynamic sort)
    { $sort: { createdAt: sortType } },
    { $skip: skip },
    { $limit: limit },
  ];

  const orders = await Purchase.aggregate(ordersAggregation);

  const totalOrders = await Purchase.countDocuments({
    "products.seller": sellerId,
  });

  res.status(200).json({
    status: "success",
    results: orders.length,
    totalOrders,
    page,
    limit,
    sortType: sortType === -1 ? "recent" : "oldest", // ✅ extra info
    data: orders,
  });
});

// ✅ Seller updates product status & auto-updates overall order status

export const updateOrderStatus = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id; // seller UUID
  const { orderId } = req.params;
  const { productId, status, location, deliveryTime, deliveryDate } = req.body;

  if (!status) return next(new AppError("Status is required", 400));
  if (!productId) return next(new AppError("productId is required", 400));

  // 1️⃣ Find order by orderId
  const order = await Purchase.findOne({ _id: orderId });
  if (!order) return next(new AppError("Order not found", 404));

  // 2️⃣ Find specific product for this seller
  const product = order.products.find(
    (p) => p.product === productId && p.seller === sellerId
  );
  if (!product)
    return next(new AppError("You cannot update this product", 403));

  // ❗️3️⃣ PREVENT SAME STATUS UPDATE AGAIN
  const latestEvent = product.timeline?.[product.timeline.length - 1]?.event;
  if (latestEvent === status) {
    return next(
      new AppError(`Status "${status}" is already applied earlier!`, 400)
    );
  }

  // 4️⃣ Update product timeline (individual timeline)
  product.timeline.push({
    event: status,
    timestamp: new Date(),
    location: location || "Seller Hub",
  });

  // 4.5️⃣ 🔥 GLOBAL ORDER TIMELINE UPDATE (top level)
  order.orderTimeline.push({
    event: status,
    timestamp: new Date(),
    location: location || "Seller Hub",
  });

  // 5️⃣ Update overall order status
  const allDelivered = order.products.every(
    (p) => p.timeline[p.timeline.length - 1].event === "delivered"
  );

  if (allDelivered) {
    order.status = "delivered";
  } else if (
    order.products.some((p) =>
      ["shipped", "in_transit"].includes(
        p.timeline[p.timeline.length - 1].event
      )
    )
  ) {
    order.status = "in_transit";
  } else {
    order.status = status;
  }

  // 6️⃣ OLD CODE — KEEP IT AS IS (NO REMOVE 🔄)
  if (deliveryTime) {
    order.shippingAddress.deliveryTime = new Date(deliveryTime);
  } else if (!order.shippingAddress.deliveryTime) {
    const now = new Date();
    now.setDate(now.getDate() + 2);
    order.shippingAddress.deliveryTime = now;
  }

  // 7️⃣ NEW deliveryDate LOGIC  🔥🔥🔥
  if (deliveryDate) {
    const parsedDate = new Date(deliveryDate);
    if (!isNaN(parsedDate.getTime())) {
      order.shippingAddress.deliveryDate = parsedDate;
    } else {
      return next(new AppError("Invalid deliveryDate format", 400));
    }
  } else if (!order.shippingAddress.deliveryDate) {
    const now = new Date();
    now.setDate(now.getDate() + 2);
    order.shippingAddress.deliveryDate = now;
  }

  await order.save();

  res.status(200).json({
    status: "success",
    message: `Product status updated to "${status}" and order status auto-updated to "${order.status}"`,
    data: order,
  });
});

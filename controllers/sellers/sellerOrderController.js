import { Purchase } from "../../models/customers/purchase.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

// https://terramartz-backend-v2.onrender.com/api/seller/orders?page=1&limit=10&sort=recent
// https://terramartz-backend-v2.onrender.com/api/seller/orders?page=1&limit=10&sort=oldest
export const getSellerOrdersPerfect = catchAsync(async (req, res, next) => {
  // Use _id instead of id to ensure ObjectId format matching
  const sellerId = req.user._id || req.user.id;

  if (!sellerId) {
    return next(new AppError("Seller not authenticated", 401));
  }

  // console.log("\n========== GET SELLER ORDERS ==========");
  // console.log("📦 Seller ID:", sellerId);
  // console.log("📦 Seller ID type:", typeof sellerId);
  // console.log("📦 Seller _id:", req.user._id);
  // console.log("📦 Seller id:", req.user.id);

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;
  const { status } = req.query;

  // ✅ শুধু এই এক লাইন নতুন
  const sortType = req.query.sort === "oldest" ? 1 : -1;
  // যদি ?sort=oldest থাকে → ascending
  // না থাকলে default → recent (-1)

  // Import mongoose for ObjectId conversion (only once)
  const mongoose = (await import("mongoose")).default;

  // Purchase model stores seller as String, but old orders might have ObjectId
  // So we need to match both String and ObjectId formats
  const sellerIdString = String(sellerId);
  const sellerIdAlt1 = req.user._id ? String(req.user._id) : null;
  const sellerIdAlt2 = req.user.id ? String(req.user.id) : null;

  // Also try ObjectId format for backward compatibility
  let sellerObjectId = null;
  try {
    if (mongoose.Types.ObjectId.isValid(sellerId)) {
      sellerObjectId = new mongoose.Types.ObjectId(sellerId);
    }
  } catch (err) {
    // Ignore
  }

  // console.log("📦 Seller IDs for matching (String + ObjectId):", {
  //   sellerIdString,
  //   sellerIdAlt1,
  //   sellerIdAlt2,
  //   sellerObjectId,
  //   originalSellerId: sellerId,
  //   originalType: typeof sellerId
  // });

  const ordersAggregation = [
    { $unwind: "$products" },
    {
      $match: {
        $or: [
          { "products.seller": sellerIdString },
          ...(sellerIdAlt1 ? [{ "products.seller": sellerIdAlt1 }] : []),
          ...(sellerIdAlt2 ? [{ "products.seller": sellerIdAlt2 }] : []),
          ...(sellerObjectId ? [{ "products.seller": sellerObjectId }] : []),
        ].filter(Boolean),
      },
    },
    ...(status ? [{ $match: { status } }] : []),

    // ProductPerformance
    {
      $lookup: {
        from: "productperformances",
        localField: "products.product",
        foreignField: "product",
        as: "products.performance",
      },
    },

    // Product info - Products use UUID strings, not ObjectId, so match directly
    {
      $lookup: {
        from: "products",
        localField: "products.product",
        foreignField: "_id",
        as: "products.productInfo",
      },
    },
    // Extract productInfo from array
    {
      $addFields: {
        "products.productInfo": {
          $cond: {
            if: { $gt: [{ $size: "$products.productInfo" }, 0] },
            then: { $arrayElemAt: ["$products.productInfo", 0] },
            else: null,
          },
        },
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
    // Extract sellerInfo from array
    {
      $addFields: {
        "products.productInfo.sellerInfo": {
          $cond: {
            if: { $gt: [{ $size: "$products.productInfo.sellerInfo" }, 0] },
            then: { $arrayElemAt: ["$products.productInfo.sellerInfo", 0] },
            else: null,
          },
        },
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

    // ✅ Lookup SellerSettlement for this seller's refund status
    {
      $lookup: {
        from: "sellersettlements",
        let: { purchaseId: "$_id", sellerId: "$products.seller" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$purchaseId", "$$purchaseId"] },
                  { $eq: ["$sellerId", "$$sellerId"] },
                ],
              },
            },
          },
        ],
        as: "sellerSettlement",
      },
    },
    // Extract sellerSettlement from array
    {
      $addFields: {
        sellerSettlement: {
          $cond: {
            if: { $gt: [{ $size: "$sellerSettlement" }, 0] },
            then: { $arrayElemAt: ["$sellerSettlement", 0] },
            else: null,
          },
        },
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
        totalAmount: 1,
        refundAmount: 1,
        refundedAt: 1,
        refundReason: 1,
        refundRequestedAt: 1,
        refundRejectReason: 1,
        trackingNumber: 1,
        disputeId: 1,
        disputeStatus: 1,
        disputeReason: 1,
        disputeAmount: 1,
        disputeCreatedAt: 1,
        disputeClosedAt: 1,
        platformFeeAmount: 1,
        platformFeeRefunded: 1,
        // ✅ Seller-specific refund status from SellerSettlement (with defaults)
        sellerRefundStatus: {
          $ifNull: ["$sellerSettlement.refundStatus", "none"]
        },
        sellerSettlementStatus: {
          $ifNull: ["$sellerSettlement.status", "pending"]
        },
        sellerRefundDeductions: {
          $ifNull: ["$sellerSettlement.refundDeductions", 0]
        },
        products: {
          product: 1,
          quantity: 1,
          price: 1,
          seller: 1,
          performance: 1,
          // productInfo is now already extracted as an object
          productInfo: {
            _id: "$products.productInfo._id",
            title: "$products.productInfo.title",
            name: "$products.productInfo.name",
            description: "$products.productInfo.description",
            price: "$products.productInfo.price",
            originalPrice: "$products.productInfo.originalPrice",
            stockQuantity: "$products.productInfo.stockQuantity",
            productImages: "$products.productInfo.productImages",
            tags: "$products.productInfo.tags",
            organic: "$products.productInfo.organic",
            featured: "$products.productInfo.featured",
            productType: "$products.productInfo.productType",
            status: "$products.productInfo.status",
            createdAt: "$products.productInfo.createdAt",
            updatedAt: "$products.productInfo.updatedAt",
            createdBy: "$products.productInfo.createdBy",
            sellerInfo: {
              _id: "$products.productInfo.sellerInfo._id",
              firstName: "$products.productInfo.sellerInfo.firstName",
              lastName: "$products.productInfo.sellerInfo.lastName",
              email: "$products.productInfo.sellerInfo.email",
              phoneNumber: "$products.productInfo.sellerInfo.phoneNumber",
              role: "$products.productInfo.sellerInfo.role",
              accountType: "$products.productInfo.sellerInfo.accountType",
              sellerProfile: "$products.productInfo.sellerInfo.sellerProfile",
              status: "$products.productInfo.sellerInfo.status",
              isAccountVerified:
                "$products.productInfo.sellerInfo.isAccountVerified",
              createdAt: "$products.productInfo.sellerInfo.createdAt",
              updatedAt: "$products.productInfo.sellerInfo.updatedAt",
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

    // Group back by order ID to get unique orders (since we unwound products)
    {
      $group: {
        _id: "$_id",
        orderId: { $first: "$orderId" },
        shippingAddress: { $first: "$shippingAddress" },
        paymentStatus: { $first: "$paymentStatus" },
        status: { $first: "$status" },
        createdAt: { $first: "$createdAt" },
        updatedAt: { $first: "$updatedAt" },
        buyer: { $first: "$buyer" },
        totalAmount: { $first: "$totalAmount" },
        refundAmount: { $first: "$refundAmount" },
        refundedAt: { $first: "$refundedAt" },
        refundReason: { $first: "$refundReason" },
        refundRequestedAt: { $first: "$refundRequestedAt" },
        refundRejectReason: { $first: "$refundRejectReason" },
        trackingNumber: { $first: "$trackingNumber" },
        disputeId: { $first: "$disputeId" },
        disputeStatus: { $first: "$disputeStatus" },
        disputeReason: { $first: "$disputeReason" },
        disputeAmount: { $first: "$disputeAmount" },
        disputeCreatedAt: { $first: "$disputeCreatedAt" },
        disputeClosedAt: { $first: "$disputeClosedAt" },
        platformFeeAmount: { $first: "$platformFeeAmount" },
        platformFeeRefunded: { $first: "$platformFeeRefunded" },
        // ✅ Preserve seller-specific refund status
        sellerRefundStatus: { $first: "$sellerRefundStatus" },
        sellerSettlementStatus: { $first: "$sellerSettlementStatus" },
        sellerRefundDeductions: { $first: "$sellerRefundDeductions" },
        products: { $push: "$products" },
      },
    },

    // ✅ Compute seller-specific amounts (only this seller's products are in the group)
    {
      $addFields: {
        // Sum of (price * quantity) for this seller's products only
        sellerSubtotal: {
          $reduce: {
            input: "$products",
            initialValue: 0,
            in: {
              $add: [
                "$$value",
                { $multiply: ["$$this.price", "$$this.quantity"] },
              ],
            },
          },
        },
      },
    },
    {
      $addFields: {
        // Seller's proportional share of the refund amount
        sellerRefundAmount: {
          $cond: {
            if: {
              $and: [
                { $gt: ["$refundAmount", 0] },
                { $gt: ["$totalAmount", 0] },
              ],
            },
            then: {
              $round: [
                {
                  $multiply: [
                    "$refundAmount",
                    { $divide: ["$sellerSubtotal", "$totalAmount"] },
                  ],
                },
                2,
              ],
            },
            else: 0,
          },
        },
      },
    },

    // ✅ শুধু এই লাইন পরিবর্তন (dynamic sort)
    { $sort: { createdAt: sortType } },
    { $skip: skip },
    { $limit: limit },
  ];

  const orders = await Purchase.aggregate(ordersAggregation);

  // console.log("📦 Aggregated orders count:", orders.length);
  // if (orders.length > 0) {
  //   console.log("📦 Sample order structure:", JSON.stringify({
  //     _id: orders[0]._id,
  //     orderId: orders[0].orderId,
  //     productsCount: orders[0].products?.length || 0,
  //     firstProduct: orders[0].products?.[0] || null
  //   }, null, 2));
  // }

  // Count total orders with same matching logic (String + ObjectId for backward compatibility)
  const countQuery = {
    $or: [
      { "products.seller": sellerIdString },
      ...(sellerIdAlt1 ? [{ "products.seller": sellerIdAlt1 }] : []),
      ...(sellerIdAlt2 ? [{ "products.seller": sellerIdAlt2 }] : []),
      ...(sellerObjectId ? [{ "products.seller": sellerObjectId }] : []),
    ].filter(Boolean)
  };

  if (status) {
    countQuery.status = status;
  }

  const totalOrders = await Purchase.countDocuments(countQuery);

  // console.log("📦 Found orders:", orders.length);
  // console.log("📦 Total orders:", totalOrders);
  if (orders.length > 0) {
    const firstOrder = orders[0];
    // console.log("📦 First order structure:", {
    //   _id: firstOrder._id,
    //   orderId: firstOrder.orderId,
    //   productsIsArray: Array.isArray(firstOrder.products),
    //   productsLength: Array.isArray(firstOrder.products) ? firstOrder.products.length : 'N/A',
    //   firstProduct: firstOrder.products?.[0] ? {
    //     product: firstOrder.products[0].product,
    //     productInfo: firstOrder.products[0].productInfo ? {
    //       _id: firstOrder.products[0].productInfo._id,
    //       title: firstOrder.products[0].productInfo.title,
    //       name: firstOrder.products[0].productInfo.name
    //     } : null
    //   } : null
    // });
    // console.log("📦 First order full products:", JSON.stringify(firstOrder.products || "No products", null, 2));
  } else {
    // console.log("⚠️ No orders found! Checking why...");
    // console.log("📦 Seller ID used in query:", {
    //   sellerIdString,
    //   sellerIdAlt1,
    //   sellerIdAlt2,
    //   originalSellerId: sellerId,
    //   originalType: typeof sellerId
    // });

    // Check if any orders exist with this seller
    const testQuery = await Purchase.aggregate([
      { $unwind: "$products" },
      { $group: { _id: "$products.seller", count: { $sum: 1 } } },
      { $limit: 10 },
    ]);
    // console.log("📦 Sample seller IDs in database:", testQuery);
  }
  // console.log("========================================\n");

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
    (p) => p.product === productId && p.seller === sellerId,
  );
  if (!product)
    return next(new AppError("You cannot update this product", 403));

  // ❗️3️⃣ PREVENT SAME STATUS UPDATE AGAIN
  const latestEvent = product.timeline?.[product.timeline.length - 1]?.event;
  if (latestEvent === status) {
    return next(
      new AppError(`Status "${status}" is already applied earlier!`, 400),
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
    (p) => p.timeline[p.timeline.length - 1].event === "delivered",
  );

  if (allDelivered) {
    order.status = "delivered";
  } else if (
    order.products.some((p) =>
      ["shipped"].includes(
        p.timeline[p.timeline.length - 1].event,
      ),
    )
  ) {
    order.status = "shipped";
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

  // ✅ Send notification to buyer about status update
  try {
    const { Notification } =
      await import("../../models/common/notification.js");
    const { User } = await import("../../models/users.js");
    const { Product } = await import("../../models/seller/product.js");

    const buyerId = String(order.buyer);
    const buyer = await User.findById(buyerId);
    const productInfo = await Product.findById(productId);

    if (buyer) {
      const statusMessages = {
        processing: "Your order is now being processed",
        shipped: "Your order has been shipped",
        delivered: "Your order has been delivered",
        new: "Your order has been confirmed",
        cancelled: "Your order has been cancelled",
        refunded: "Your order has been refunded",
      };

      const statusMessage =
        statusMessages[status] ||
        `Your order status has been updated to ${status}`;

      // Create notification in database
      await Notification.create({
        user: buyerId,
        type: "order_status_updated",
        title: "Order Status Updated",
        message: `${statusMessage} for order ${order.orderId}. Product: ${productInfo?.title || productInfo?.name || "Product"}`,
        orderId: order.orderId,
        order: String(order._id),
        productId: productId,
        metadata: {
          status: status,
          productName: productInfo?.title || productInfo?.name || "Product",
          trackingNumber: order.trackingNumber || null,
        },
      });

      // console.log(`✅ Notification sent to buyer ${buyerId} for order ${order.orderId}`);
    }
  } catch (notifError) {
    console.error("⚠️ Failed to send notification:", notifError);
    // Don't fail the request if notification fails
  }

  res.status(200).json({
    status: "success",
    message: `Product status updated to "${status}" and order status auto-updated to "${order.status}". Customer notification sent.`,
    data: order,
  });
});

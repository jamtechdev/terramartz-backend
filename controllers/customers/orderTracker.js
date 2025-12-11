import { Purchase } from "../../models/customers/purchase.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { getPresignedUrl } from "../../utils/awsS3.js";

// Processing
// http://localhost:7345/api/terramartz/customer/order-tracker?status=processing

// Confirmed
// http://localhost:7345/api/terramartz/customer/order-tracker?status=confirmed

// In Transit
// http://localhost:7345/api/terramartz/customer/order-tracker?status=in_transit

// Delivered
// http://localhost:7345/api/terramartz/customer/order-tracker?status=delivered

// Cancelled
// http://localhost:7345/api/terramartz/customer/order-tracker?status=cancelled
// Search by Order ID or Product Name
// Example: Order ID ORD-002
// http://localhost:7345/api/terramartz/customer/order-tracker?search=ORD-002

// Example: Product Name Strawberries
// http://localhost:7345/api/terramartz/customer/order-tracker?search=Strawberries

export const getCustomerOrders = catchAsync(async (req, res, next) => {
  const customerId = req.user._id || req.user.id;

  if (!customerId) {
    return next(new AppError("Invalid customer ID!", 400));
  }

  const { status = "all", search = "", page = 1, limit = 10 } = req.query;
  const skip = (page - 1) * limit;

  // Purchase model stores buyer as String, so convert all to strings for matching
  const customerIdString = String(customerId);
  const customerIdAlt1 = req.user._id ? String(req.user._id) : null;
  const customerIdAlt2 = req.user.id ? String(req.user.id) : null;

  const pipeline = [
    { 
      $match: { 
        $or: [
          { buyer: customerIdString },
          ...(customerIdAlt1 ? [{ buyer: customerIdAlt1 }] : []),
          ...(customerIdAlt2 ? [{ buyer: customerIdAlt2 }] : []),
        ].filter(Boolean)
      } 
    },

    {
      $lookup: {
        from: "products",
        localField: "products.product",
        foreignField: "_id",
        as: "productDetails",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "products.seller",
        foreignField: "_id",
        as: "sellerDetails",
      },
    },
  ];

  // 📌 STATUS FILTER
  if (status.toLowerCase() !== "all") {
    pipeline.push({ $match: { status: status.toLowerCase() } });
  }

  // 🔍 SEARCH FILTER
  if (search) {
    const regex = new RegExp(search, "i");
    pipeline.push({
      $match: {
        $or: [
          { orderId: { $regex: regex } },
          { "productDetails.title": { $regex: regex } },
        ],
      },
    });
  }

  // 📊 COUNT
  const statusCounts = async (st) => {
    const result = await Purchase.aggregate([
      ...pipeline,
      { $match: { status: st } },
      { $count: "total" },
    ]);
    return result[0]?.total || 0;
  };

  const totalOrdersAgg = await Purchase.aggregate([
    ...pipeline,
    { $count: "total" },
  ]);
  const totalOrders = totalOrdersAgg[0]?.total || 0;

  const processingCount = await statusCounts("processing");
  const inTransitCount = await statusCounts("in_transit");
  const deliveredCount = await statusCounts("delivered");
  const cancelledCount = await statusCounts("cancelled");

  // 📌 Pagination + Sorting
  pipeline.push({ $sort: { createdAt: -1 } });
  pipeline.push({ $skip: parseInt(skip) });
  pipeline.push({ $limit: parseInt(limit) });

  // 🏁 Execute Final Query
  const orders = await Purchase.aggregate(pipeline);

  // 🔥 APPLY PRESIGNED URLs (Only modification — nothing removed)
  const ordersWithPresigned = await Promise.all(
    orders.map(async (order) => {
      const productDetailsWithPresigned = await Promise.all(
        order.productDetails.map(async (p) => {
          if (p?.productImages?.length) {
            const presigned = await getPresignedUrl(
              `products/${p.productImages[0]}`
            );
            return {
              ...p,
              productImages: [presigned || p.productImages[0]],
            };
          }
          return p;
        })
      );

      return {
        ...order,
        productDetails: productDetailsWithPresigned,
      };
    })
  );

  // 🧾 MAP OUTPUT DATA (unchanged — same structure)
  const mappedOrders = ordersWithPresigned.map((order) => {
    const firstProductSeller = order.sellerDetails?.[0]?.sellerProfile || {};

    return {
      _id: order._id,
      orderId: order.orderId,
      status: order.status,
      createdAt: order.createdAt,
      totalItems: order.products.reduce((acc, p) => acc + (p.quantity || 0), 0),
      totalAmount: order.totalAmount,
      trackingNumber: order.trackingNumber,
      paymentMethod: order.paymentMethod,

      shippingAddress: order.shippingAddress || {},

      farmDetails: {
        shopName: firstProductSeller.shopName || "Unknown Farm",
        shopSlug: firstProductSeller.shopSlug || null,
      },

      products: order.products.map((p, i) => ({
        productId: order.productDetails?.[i]?._id || null,
        title: order.productDetails?.[i]?.title || "Deleted Product",
        slug: order.productDetails?.[i]?.slug || null,

        // 🔥 PRESIGNED URL IMAGE (same field name "image")
        image:
          order.productDetails?.[i]?.productImages?.[0] ||
          order.productDetails?.[i]?.productImages,

        qty: p.quantity,
        price: p.price,

        sellerShop: order.sellerDetails?.[i]?.sellerProfile?.shopName || null,
        sellerSlug: order.sellerDetails?.[i]?.sellerProfile?.shopSlug || null,
      })),

      orderTimeline:
        order.orderTimeline?.map((event) => ({
          event: event.event,
          timestamp: event.timestamp,
          location: event.location,
        })) || [],
    };
  });

  res.status(200).json({
    status: "success",
    summary: {
      totalOrders,
      processing: processingCount,
      inTransit: inTransitCount,
      delivered: deliveredCount,
      cancelled: cancelledCount,
    },
    data: mappedOrders,
    page: parseInt(page),
    limit: parseInt(limit),
  });
});

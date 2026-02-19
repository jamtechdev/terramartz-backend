import { User } from "../../models/users.js";
import { Purchase } from "../../models/customers/purchase.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

/**
 * @desc Get all sellers with their order statistics
 * @route GET /api/admin/seller-orders/sellers
 * @access Admin
 */
export const getAllSellersWithStats = catchAsync(async (req, res) => {
    const { search, page = 1, limit = 10 } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Base match for sellers
    const match = { role: "seller" };

    // Search filter
    if (search) {
        const regex = new RegExp(search.trim(), "i");
        match.$or = [
            { firstName: regex },
            { middleName: regex },
            { lastName: regex },
            { email: regex },
            { "sellerProfile.shopName": regex },
            { "businessDetails.businessName": regex },
        ];
    }

    // Aggregate stats: Count orders per seller
    // Note: Purchase model has products: [{ seller: String, ... }]
    const pipeline = [
        { $match: match },
        {
            $lookup: {
                from: "purchases",
                let: { sellerId: "$_id" },
                pipeline: [
                    { $unwind: "$products" },
                    { $match: { $expr: { $eq: ["$products.seller", "$$sellerId"] } } },
                    { $count: "count" }
                ],
                as: "orderCountData"
            }
        },
        {
            $addFields: {
                totalOrders: { $ifNull: [{ $arrayElemAt: ["$orderCountData.count", 0] }, 0] }
            }
        },
        { $sort: { totalOrders: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limitNum },
        {
            $project: {
                _id: 1,
                name: {
                    $trim: {
                        input: {
                            $concat: [
                                "$firstName",
                                " ",
                                { $ifNull: ["$middleName", ""] },
                                " ",
                                "$lastName",
                            ],
                        },
                    },
                },
                email: 1,
                shopName: "$sellerProfile.shopName",
                businessName: "$businessDetails.businessName",
                totalOrders: 1,
                createdAt: 1,
                isActive: 1,
            },
        },
    ];

    const sellers = await User.aggregate(pipeline);
    const total = await User.countDocuments(match);

    res.status(200).json({
        status: "success",
        page: pageNum,
        limit: limitNum,
        total,
        results: sellers.length,
        sellers,
    });
});

/**
 * @desc Get orders for a specific seller
 * @route GET /api/admin/seller-orders/:sellerId/orders
 * @access Admin
 */
export const getSellerOrders = catchAsync(async (req, res, next) => {
    const { sellerId } = req.params;
    const { search, status, paymentStatus, page = 1, limit = 10 } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Verify seller exists
    const seller = await User.findById(sellerId);
    if (!seller || seller.role !== "seller") {
        return next(new AppError("Seller not found", 404));
    }

    // Match orders containing products from this seller
    const match = { "products.seller": sellerId };

    if (status) match.status = status;
    if (paymentStatus) match.paymentStatus = paymentStatus;

    // Search by orderId or buyer info
    if (search) {
        const regex = new RegExp(search.trim(), "i");
        match.$or = [
            { orderId: regex },
            { "buyer.firstName": regex },
            { "buyer.lastName": regex },
            { "buyer.email": regex },
        ];
    }

    const pipeline = [
        {
            $lookup: {
                from: "users",
                localField: "buyer",
                foreignField: "_id",
                as: "buyer",
            },
        },
        { $unwind: "$buyer" },
        { $match: match },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limitNum },
        {
            $project: {
                _id: 1,
                orderId: 1,
                buyerName: {
                    $trim: {
                        input: {
                            $concat: [
                                "$buyer.firstName",
                                " ",
                                { $ifNull: ["$buyer.middleName", ""] },
                                " ",
                                "$buyer.lastName",
                            ],
                        },
                    },
                },
                buyerEmail: "$buyer.email",
                totalAmount: 1,
                status: 1,
                paymentStatus: 1,
                createdAt: 1,
                // Filter products to only show ones belonging to this seller
                products: {
                    $filter: {
                        input: "$products",
                        as: "item",
                        cond: { $eq: ["$$item.seller", sellerId] }
                    }
                }
            },
        },
    ];

    const orders = await Purchase.aggregate(pipeline);

    // Count pipeline for pagination
    const countPipeline = [
        {
            $lookup: {
                from: "users",
                localField: "buyer",
                foreignField: "_id",
                as: "buyer",
            },
        },
        { $unwind: "$buyer" },
        { $match: match },
        { $count: "total" },
    ];

    const totalResult = await Purchase.aggregate(countPipeline);
    const total = totalResult[0]?.total || 0;

    res.status(200).json({
        status: "success",
        page: pageNum,
        limit: limitNum,
        total,
        results: orders.length,
        orders,
        seller: {
            name: [seller.firstName, seller.lastName].join(" "),
            shopName: seller.sellerProfile?.shopName,
        }
    });
});

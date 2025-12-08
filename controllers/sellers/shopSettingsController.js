import mongoose from "mongoose";
import crypto from "crypto";
import {
  uploadToS3,
  deleteFileFromS3,
  getPresignedUrl,
} from "../../utils/awsS3.js";
import { User } from "../../models/users.js";
import { Farm } from "../../models/seller/farm.js";
import { Product } from "../../models/seller/product.js";

import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { processImage } from "../../utils/multerConfig.js";

// ✅ Update seller shop settings + farm settings + businessDetails with AWS S3

export const updateShopSettings = catchAsync(async (req, res, next) => {
  const {
    shippingCharges,
    freeShippingThreshold,
    promoCodes,
    businessDetails,
    sellerProfile,
    description,
    location,
    distanceRange,
    certifications,
    product_categories,
    farm_status,
    openingHours,
  } = req.body;

  const shopPictureFile = req?.files?.shopPicture?.[0] || null;
  const profilePictureFile = req?.files?.profilePicture?.[0] || null;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const seller = await User.findById(req.user.id).session(session);
    if (!seller) throw new AppError("Seller not found", 404);

    if (businessDetails !== undefined) {
      seller.businessDetails = {
        ...seller.businessDetails,
        ...businessDetails,
      };
    }

    if (sellerProfile !== undefined) {
      const { shopId, ...otherProfileFields } = sellerProfile;

      // 🔹 Shop picture update
      if (shopPictureFile) {
        if (!seller.sellerProfile) seller.sellerProfile = {};

        // 🔥 Delete existing shopPicture if present
        if (seller.sellerProfile.shopPicture) {
          await deleteFileFromS3(
            `shopPicture/${seller.sellerProfile.shopPicture}`
          );
        }

        const key = `${req.user.id}-${Date.now()}-${crypto
          .randomBytes(8)
          .toString("hex")}.jpeg`;

        await uploadToS3(
          shopPictureFile.buffer,
          `shopPicture/${key}`,
          "image/jpeg"
        );

        otherProfileFields.shopPicture = key;
      }

      // 🔹 Profile picture update
      if (profilePictureFile) {
        if (seller.profilePicture)
          await deleteFileFromS3(`profilePicture/${seller.profilePicture}`);

        const key = `profile-${req.user.id}-${Date.now()}-${crypto
          .randomBytes(8)
          .toString("hex")}.jpeg`;

        await uploadToS3(
          profilePictureFile.buffer,
          `profilePicture/${key}`,
          "image/jpeg"
        );

        seller.profilePicture = key;
      }

      if (shippingCharges !== undefined)
        otherProfileFields.shippingCharges = shippingCharges;

      if (freeShippingThreshold !== undefined)
        otherProfileFields.freeShippingThreshold = freeShippingThreshold;

      if (promoCodes !== undefined) otherProfileFields.promoCodes = promoCodes;

      if (otherProfileFields.shopName) {
        if (!seller.businessDetails) seller.businessDetails = {};
        seller.businessDetails.businessName = otherProfileFields.shopName;
      }

      seller.sellerProfile = {
        ...seller.sellerProfile,
        ...otherProfileFields,
        shopId: seller.sellerProfile.shopId,
      };
    } else {
      // 🔹 Only shopPicture or profilePicture provided without sellerProfile
      if (shopPictureFile) {
        if (!seller.sellerProfile) seller.sellerProfile = {};

        // 🔥 Delete existing shopPicture if present
        if (seller.sellerProfile.shopPicture) {
          await deleteFileFromS3(
            `shopPicture/${seller.sellerProfile.shopPicture}`
          );
        }

        const key = `${req.user.id}-${Date.now()}-${crypto
          .randomBytes(8)
          .toString("hex")}.jpeg`;

        await uploadToS3(
          shopPictureFile.buffer,
          `shopPicture/${key}`,
          "image/jpeg"
        );

        seller.sellerProfile.shopPicture = key;
      }

      if (profilePictureFile) {
        if (seller.profilePicture)
          await deleteFileFromS3(`profilePicture/${seller.profilePicture}`);

        const key = `${req.user.id}-${Date.now()}-${crypto
          .randomBytes(8)
          .toString("hex")}.jpeg`;

        await uploadToS3(
          profilePictureFile.buffer,
          `profilePicture/${key}`,
          "image/jpeg"
        );

        seller.profilePicture = key;
      }
    }

    await seller.save({ session });

    // 🔹 Farm update
    const farm = await Farm.findOne({ owner: req.user.id }).session(session);
    if (!farm) throw new AppError("Farm not found", 404);

    if (description !== undefined) farm.description = description;
    if (location !== undefined) farm.location = location;
    if (distanceRange !== undefined) farm.distanceRange = distanceRange;
    if (certifications !== undefined) farm.certifications = certifications;
    if (product_categories !== undefined)
      farm.product_categories = product_categories;
    if (farm_status !== undefined) farm.farm_status = farm_status;
    if (openingHours !== undefined) farm.openingHours = openingHours;

    await farm.save({ session });

    // 🔹 Commit Transaction
    await session.commitTransaction();
    session.endSession();

    // 🔹 PRESIGNED URL SECTION
    let shopPictureUrl = null;
    let profilePictureUrl = null;

    if (seller.sellerProfile?.shopPicture) {
      shopPictureUrl = await getPresignedUrl(
        `shopPicture/${seller.sellerProfile.shopPicture}`
      );
    }

    if (seller.profilePicture) {
      profilePictureUrl = await getPresignedUrl(
        `profilePicture/${seller.profilePicture}`
      );
    }

    // 🔹 Response same as before
    return res.status(200).json({
      status: "success",
      sellerProfile: {
        ...seller.sellerProfile,
        shopPicture: shopPictureUrl,
      },
      businessDetails: seller.businessDetails,
      profilePicture: profilePictureUrl,
      farm,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("Transaction failed:", err);
    return next(new AppError(err.message || "Transaction failed", 500));
  }
});

const buildFuzzyRegex = (input) => {
  if (!input || input.length < 2) return null;
  const firstTwo = input.slice(0, 2); // প্রথম ২ char
  return new RegExp(`^${firstTwo}`, "i"); // case-insensitive
};

export const searchFarms = async (req, res, next) => {
  try {
    const {
      farmName,
      productName,
      productCategory,
      delivery,
      name,
      city,
      state,
      postalCode,
      country,
      certifications,
      farmStatus,
      latitude,
      longitude,
      distance,
      page = 1,
      limit = 10,
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // 1️⃣ Farm filters
    const farmMatch = {};
    if (farmStatus) farmMatch.farm_status = { $in: farmStatus.split(",") };
    if (certifications)
      farmMatch.certifications = { $in: certifications.split(",") };
    if (name && name.length >= 2)
      farmMatch.description = { $regex: buildFuzzyRegex(name) };

    // 2️⃣ Aggregation Pipeline
    const pipeline = [];

    if (latitude && longitude && distance) {
      pipeline.push({
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          distanceField: "distanceFromUser",
          maxDistance: parseFloat(distance) * 1000,
          spherical: true,
          query: farmMatch,
        },
      });
    } else {
      pipeline.push({ $match: farmMatch });
    }

    // Lookup Users (owner)
    pipeline.push({
      $lookup: {
        from: "users",
        let: { ownerId: "$owner" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$ownerId"] } } },
          {
            $project: {
              password: 0,
              passwordConfirm: 0,
              passwordResetToken: 0,
              passwordResetExpires: 0,
              passwordChangedAt: 0,
              socialLogin: 0,
              provider: 0,
              __v: 0,
            },
          },
        ],
        as: "ownerData",
      },
    });

    pipeline.push({
      $unwind: { path: "$ownerData", preserveNullAndEmptyArrays: true },
    });

    // Seller filters
    const sellerFilters = [];
    if (farmName && farmName.length >= 2)
      sellerFilters.push({
        "ownerData.businessDetails.businessName": {
          $regex: buildFuzzyRegex(farmName),
        },
      });
    if (city && city.length >= 2)
      sellerFilters.push({
        "ownerData.businessDetails.city": { $regex: buildFuzzyRegex(city) },
      });
    if (state && state.length >= 2)
      sellerFilters.push({
        "ownerData.businessDetails.state": { $regex: buildFuzzyRegex(state) },
      });
    if (postalCode && postalCode.length >= 2)
      sellerFilters.push({
        "ownerData.businessDetails.postalCode": {
          $regex: buildFuzzyRegex(postalCode),
        },
      });
    if (country && country.length >= 2)
      sellerFilters.push({
        "ownerData.businessDetails.country": {
          $regex: buildFuzzyRegex(country),
        },
      });

    if (sellerFilters.length > 0) {
      pipeline.push({ $match: { $and: sellerFilters } });
    }

    // Lookup Products
    pipeline.push({
      $lookup: {
        from: "products",
        localField: "products",
        foreignField: "_id",
        as: "products",
      },
    });

    // Filter Products by productName, category and delivery
    pipeline.push({
      $addFields: {
        products: {
          $filter: {
            input: "$products",
            as: "prod",
            cond: {
              $and: [
                productName
                  ? {
                      $regexMatch: {
                        input: "$$prod.title",
                        regex: buildFuzzyRegex(productName),
                      },
                    }
                  : {},
                productCategory
                  ? { $eq: ["$$prod.category", productCategory] }
                  : {},
                delivery ? { $eq: ["$$prod.delivery", delivery] } : {},
              ].filter(Boolean),
            },
          },
        },
      },
    });

    // Lookup ProductPerformance
    pipeline.push({
      $unwind: { path: "$products", preserveNullAndEmptyArrays: true },
    });

    pipeline.push({
      $lookup: {
        from: "productperformances",
        localField: "products._id",
        foreignField: "product",
        as: "products.performance",
      },
    });

    pipeline.push({
      $unwind: {
        path: "$products.performance",
        preserveNullAndEmptyArrays: true,
      },
    });

    // Group back farms
    pipeline.push({
      $group: {
        _id: "$_id",
        description: { $first: "$description" },
        farm_status: { $first: "$farm_status" },
        certifications: { $first: "$certifications" },
        product_categories: { $first: "$product_categories" },
        location: { $first: "$location" },
        ownerData: { $first: "$ownerData" },
        distanceFromUser: { $first: "$distanceFromUser" },
        products: { $push: "$products" },
      },
    });

    pipeline.push({
      $addFields: {
        products: {
          $cond: [
            {
              $eq: [
                {
                  $size: {
                    $filter: {
                      input: "$products",
                      as: "p",
                      cond: { $ne: ["$$p", null] },
                    },
                  },
                },
                0,
              ],
            },
            [],
            {
              $filter: {
                input: "$products",
                as: "p",
                cond: { $ne: ["$$p", null] },
              },
            },
          ],
        },
      },
    });

    pipeline.push({
      $project: {
        description: 1,
        farm_status: 1,
        certifications: 1,
        product_categories: 1,
        location: 1,
        ownerData: 1,
        productCount: { $size: "$products" },
        products: 1,
        distanceFromUser: 1,
      },
    });

    // Pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: Number(limit) });

    // Execute
    const farms = await Farm.aggregate(pipeline);
    const totalFarms = await Farm.countDocuments(farmMatch);

    const totalProducts = farms.reduce(
      (acc, f) => acc + (f.products?.length || 0),
      0
    );

    let avgDistance = "N/A";
    if (latitude && longitude && farms.length > 0) {
      avgDistance = `${(
        farms.reduce((acc, f) => acc + (f.distanceFromUser || 0), 0) /
        farms.length /
        1000
      ).toFixed(1)} km`;
    }

    // 🔹 Presigned URLs apply for farm & product images
    const farmsWithUrls = await Promise.all(
      farms.map(async (farm) => {
        const farmOwner = { ...farm.ownerData };

        // Farm owner profile picture
        if (farmOwner.profilePicture) {
          farmOwner.profilePicture = await getPresignedUrl(
            `profilePicture/${farmOwner.profilePicture}`
          );
        }

        // Seller shop picture
        if (farmOwner.sellerProfile?.shopPicture) {
          farmOwner.sellerProfile.shopPicture = await getPresignedUrl(
            `shopPicture/${farmOwner.sellerProfile.shopPicture}`
          );
        }

        // Products images
        const productsWithUrls = await Promise.all(
          (farm.products || []).map(async (prod) => {
            if (prod.productImages && prod.productImages.length > 0) {
              const presignedImages = await Promise.all(
                prod.productImages.map((img) =>
                  getPresignedUrl(`products/${img}`)
                )
              );
              prod.productImages = presignedImages;
            }
            return prod;
          })
        );

        return {
          ...farm,
          ownerData: farmOwner,
          products: productsWithUrls,
        };
      })
    );

    res.status(200).json({
      success: true,
      pagination: {
        totalFarms,
        totalPages: Math.ceil(totalFarms / limit),
        currentPage: Number(page),
      },
      summary: {
        localFarms: totalFarms,
        freshProducts: totalProducts,
        avgDistance,
      },
      farms: farmsWithUrls,
    });
  } catch (err) {
    console.error(err);
    return next(new AppError(err.message || "Server error", 500));
  }
};

export const getFarmProductsInformation = async (req, res, next) => {
  try {
    const { farmId } = req.params;

    // 1️⃣ Farm এর general info নিয়ে আসা
    const farm = await Farm.findById(farmId)
      .populate("owner") // optional: owner info
      .lean(); // plain JS object

    if (!farm)
      return res
        .status(404)
        .json({ success: false, message: "Farm not found" });

    // 2️⃣ Farm এর products
    let products = await Product.aggregate([
      { $match: { _id: { $in: farm.products } } },
      {
        $lookup: {
          from: "productperformances",
          localField: "_id",
          foreignField: "product",
          as: "performance",
        },
      },
      { $unwind: { path: "$performance", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          title: 1,
          description: 1,
          price: 1,
          stockQuantity: 1,
          productType: 1,
          category: 1,
          productImages: 1,
          performance: 1,
        },
      },
    ]);

    // 🔹 Presigned URL for product images
    products = await Promise.all(
      products.map(async (p) => {
        const imagesWithPresigned = await Promise.all(
          (p.productImages || []).map((img) =>
            getPresignedUrl(`products/${img}`)
          )
        );
        return {
          ...p,
          productImages: imagesWithPresigned,
        };
      })
    );

    // 🔹 Presigned URL for farm owner profile picture & shop picture
    let owner = farm.owner;
    let ownerProfilePictureUrl = null;
    let shopPictureUrl = null;

    if (owner) {
      if (owner.profilePicture) {
        ownerProfilePictureUrl = await getPresignedUrl(
          `profilePicture/${owner.profilePicture}`
        );
      }
      if (owner.sellerProfile?.shopPicture) {
        shopPictureUrl = await getPresignedUrl(
          `shopPicture/${owner.sellerProfile.shopPicture}`
        );
      }

      owner = {
        ...owner,
        profilePicture: ownerProfilePictureUrl,
        sellerProfile: {
          ...owner.sellerProfile,
          shopPicture: shopPictureUrl,
        },
      };
    }

    res.status(200).json({
      success: true,
      farm: {
        _id: farm._id,
        description: farm.description,
        farm_status: farm.farm_status,
        certifications: farm.certifications,
        product_categories: farm.product_categories,
        location: farm.location,
        owner,
        products,
      },
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

// 🗺️ Get All Farms for Map Markers (Public)
export const getFarmsForMap = catchAsync(async (req, res, next) => {
  try {
    const { farmStatus } = req.query; // Optional filter: active, featured, etc.

    // Build match query
    const matchQuery = {};
    if (farmStatus) {
      matchQuery.farm_status = { $in: farmStatus.split(",") };
    } else {
      // Default: only show active and featured farms on map
      matchQuery.farm_status = { $in: ["active", "featured"] };
    }

    // Exclude farms with default coordinates [0, 0]
    matchQuery["location.coordinates"] = { $ne: [0, 0] };

    // Aggregation pipeline for map markers
    const farms = await Farm.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: "users",
          let: { ownerId: "$owner" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$ownerId"] } } },
            {
              $project: {
                firstName: 1,
                lastName: 1,
                "businessDetails.businessName": 1,
                "sellerProfile.shopName": 1,
                "sellerProfile.shopPicture": 1,
              },
            },
          ],
          as: "ownerData",
        },
      },
      {
        $unwind: {
          path: "$ownerData",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          farmName: {
            $ifNull: [
              "$ownerData.businessDetails.businessName",
              "$description",
            ],
          },
          shopName: { $ifNull: ["$ownerData.sellerProfile.shopName", null] },
          ownerName: {
            $concat: [
              { $ifNull: ["$ownerData.firstName", ""] },
              " ",
              { $ifNull: ["$ownerData.lastName", ""] },
            ],
          },
          coordinates: "$location.coordinates", // [longitude, latitude]
          farm_status: 1,
          shopPicture: "$ownerData.sellerProfile.shopPicture",
          description: 1,
        },
      },
      // Lookup Products for each farm
      {
        $lookup: {
          from: "products",
          let: { farmId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$farmId", "$$farmId"] } } },
            {
              $match: {
                status: { $in: ["active"] }, // Only active products
              },
            },
            {
              $project: {
                _id: 1,
                title: 1,
                price: 1,
                productImages: 1,
                productType: 1,
                status: 1,
                stockQuantity: 1,
                slug: 1,
              },
            },
            { $limit: 10 }, // Limit products per farm for map view
          ],
          as: "products",
        },
      },
    ]);

    res.status(200).json({
      success: true,
      count: farms.length,
      farms: farms.map((farm) => ({
        farmId: farm._id,
        farmName: farm.farmName || farm.description || "Farm",
        shopName: farm.shopName,
        ownerName: farm.ownerName?.trim() || "Farm Owner",
        coordinates: farm.coordinates, // [longitude, latitude]
        latitude: farm.coordinates?.[1] || null,
        longitude: farm.coordinates?.[0] || null,
        farmStatus: farm.farm_status,
        shopPicture: farm.shopPicture,
        description: farm.description,
        products: farm.products || [], // ✅ Farm ke products
        productCount: farm.products?.length || 0,
      })),
    });
  } catch (err) {
    console.error("Error fetching farms for map:", err);
    return next(new AppError(err.message || "Server error", 500));
  }
});
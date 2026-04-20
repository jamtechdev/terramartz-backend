import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { Product } from "../../models/seller/product.js";
import catchAsync from "../../utils/catchasync.js";
import { User } from "../../models/users.js";
import { getPresignedUrl } from "../../utils/awsS3.js";

/**
 * Homepage "Featured products" — returns only products the admin marked
 * `featured: true` (active + catalog-approved). Older behavior mixed in
 * best-seller / top-rated slots regardless of the featured flag.
 */
export const getFeatureProducts = catchAsync(async (req, res, next) => {
  const toS3Key = (value, folder) => {
    if (!value || typeof value !== "string") return null;
    if (value.startsWith("http")) return value;
    return value.startsWith(`${folder}/`) ? value : `${folder}/${value}`;
  };

  let sellerFilter = {};
  if (
    req.user &&
    req.user.role === "seller" &&
    req.query.sellerOnly === "true"
  ) {
    sellerFilter.createdBy = req.user._id;
  }

  const buildMatchCondition = (baseMatch, isProductAgg = false) => {
    if (sellerFilter.createdBy) {
      const createdByField = isProductAgg ? "createdBy" : "details.createdBy";
      return { ...baseMatch, [createdByField]: sellerFilter.createdBy };
    }
    return baseMatch;
  };

  const mapProductWithCategory = async (
    product,
    performance,
    categoryTitle,
    seller,
  ) => {
    if (!product) return null;
    const productObj = product.toObject ? product.toObject() : product;

    return {
      ...productObj,
      totalSales: performance?.totalSales || 0,
      totalQuantitySold: performance?.totalQuantitySold || 0,
      views: performance?.views || 0,
      rating: performance?.rating || 0,
      details: {
        ...productObj,
      },
      category_title: categoryTitle,
      shopSlug: seller?.sellerProfile?.shopSlug || null,
      sellerProfile: seller?.sellerProfile || null,
      profilePicture: seller?.profilePicture || null,
    };
  };

  const attachPresignedUrls = async (product) => {
    if (!product) return null;

    if (product.productImages && product.productImages.length > 0) {
      product.productImages = await Promise.all(
        product.productImages.map((img) =>
          getPresignedUrl(toS3Key(img, "products")),
        ),
      );
    }

    if (product.profilePicture) {
      product.profilePicture = await getPresignedUrl(
        toS3Key(product.profilePicture, "profilePicture"),
      );
    }

    if (product.sellerProfile?.shopPicture) {
      product.sellerProfile.shopPicture = await getPresignedUrl(
        toS3Key(product.sellerProfile.shopPicture, "shopPicture"),
      );
    }

    return product;
  };

  const sanitizeCategoryOnProduct = (product) => {
    if (!product || typeof product !== "object") return;
    const c = product.category;
    if (c == null) {
      product.category = null;
      return;
    }
    if (typeof c === "object" && typeof c.name === "string" && c.name.trim()) {
      return;
    }
    product.category = null;
  };

  const match = buildMatchCondition(
    {
      featured: true,
      status: "active",
      adminApproved: true,
    },
    true,
  );

  let candidates = await Product.find(match)
    .sort({ createdAt: -1 })
    .limit(8)
    .populate({
      path: "category",
      select: "name slug description",
    })
    .lean();
  let usedTopRatedFallback = false;

  if (candidates.length === 0) {
    usedTopRatedFallback = true;
    candidates = await Product.aggregate([
      {
        $match: buildMatchCondition(
          {
            status: "active",
            adminApproved: true,
            stockQuantity: { $gt: 0 },
          },
          true,
        ),
      },
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
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "categoryDetails",
        },
      },
      { $unwind: { path: "$categoryDetails", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          _ratingSort: { $ifNull: ["$performance.rating", 0] },
          _salesSort: { $ifNull: ["$performance.totalQuantitySold", 0] },
          _viewsSort: { $ifNull: ["$performance.views", 0] },
          category: "$categoryDetails",
        },
      },
      {
        $sort: {
          _ratingSort: -1,
          _salesSort: -1,
          _viewsSort: -1,
          createdAt: -1,
        },
      },
      { $limit: 8 },
      {
        $project: {
          performance: 0,
          categoryDetails: 0,
          _ratingSort: 0,
          _salesSort: 0,
          _viewsSort: 0,
        },
      },
    ]);
  }

  const data = {};
  let colIndex = 1;

  for (const doc of candidates) {
    const performance =
      (await ProductPerformance.findOne({ product: doc._id }).lean()) || {};
    const seller = await User.findById(doc.createdBy).lean();
    const categoryTitle = usedTopRatedFallback
      ? "Top Rated"
      : doc.category?.name || "Featured";

    let column = await mapProductWithCategory(
      doc,
      performance,
      categoryTitle,
      seller,
    );
    column = await attachPresignedUrls(column);
    if (!column) continue;
    sanitizeCategoryOnProduct(column);
    data[`column${colIndex}`] = column;
    colIndex += 1;
  }

  res.status(200).json({
    status: "success",
    data,
  });
});

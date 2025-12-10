import { WishlistProduct } from "../../models/customers/wishlistProduct.js";
import { Product } from "../../models/seller/product.js";
import { getPresignedUrl } from "../../utils/awsS3.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

// Add product to wishlist
export const addToWishlist = catchAsync(async (req, res, next) => {
  const userId = req.user._id;
  const { productId } = req.params;

  const product = await Product.findById(productId);
  if (!product) return next(new AppError("Product not found", 404));

  const exists = await WishlistProduct.findOne({
    user: userId,
    product: productId,
  });
  if (exists) return next(new AppError("Product already in wishlist", 400));

  const newEntry = await WishlistProduct.create({
    user: userId,
    product: productId,
  });

  res.status(200).json({
    status: "success",
    message: "Product added to wishlist",
    wishlist: newEntry,
  });
});

// Remove product from wishlist
export const removeFromWishlist = catchAsync(async (req, res, next) => {
  const userId = req.user._id;
  const { productId } = req.params;

  const deleted = await WishlistProduct.findOneAndDelete({
    user: userId,
    product: productId,
  });

  if (!deleted) return next(new AppError("Product not found in wishlist", 404));

  res.status(200).json({
    status: "success",
    message: "Product removed from wishlist",
  });
});

// Get all wishlist items of current user with product slug & category info
// export const getWishlist = catchAsync(async (req, res, next) => {
//   const userId = req.user._id;

//   const wishlistItems = await WishlistProduct.find({ user: userId }).populate({
//     path: "product",
//     select:
//       "title slug price stockQuantity productImages organic featured category",
//     populate: {
//       path: "category",
//       select: "_id name slug description image",
//     },
//   });

//   res.status(200).json({
//     status: "success",
//     wishlist: wishlistItems.map((item) => item.product),
//   });
// });

export const getWishlist = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  const wishlistItems = await WishlistProduct.find({ user: userId }).populate({
    path: "product",
    select:
      "title slug price stockQuantity productImages organic featured category",
    populate: {
      path: "category",
      select: "_id name slug description image",
    },
  });

  // 🔹 Presigned URLs apply for each product image & category image
  const productsWithPresignedImages = await Promise.all(
    wishlistItems.map(async (item) => {
      const product = item.product.toObject(); // Mongoose doc → plain object

      // Product images
      if (product?.productImages?.length) {
        const presignedImages = await Promise.all(
          product.productImages.map(async (imgKey) => {
            const url = await getPresignedUrl(`products/${imgKey}`);
            return url || imgKey; // fallback
          })
        );
        product.productImages = presignedImages;
      }

      // Category image
      if (product?.category?.image) {
        const categoryImageUrl = await getPresignedUrl(
          `categories/${product.category.image}`
        );
        product.category.image = categoryImageUrl || product.category.image;
      }

      return product;
    })
  );

  res.status(200).json({
    status: "success",
    wishlist: productsWithPresignedImages,
  });
});

// Get users who favorited a specific product (for sellers)
export const getProductFavorites = catchAsync(async (req, res, next) => {
  const { productId } = req.params;
  const sellerId = req.user._id;

  // Verify that the product belongs to the seller
  const product = await Product.findById(productId);
  if (!product) return next(new AppError("Product not found", 404));
  
  if (product.createdBy.toString() !== sellerId.toString()) {
    return next(new AppError("You can only view favorites for your own products", 403));
  }

  // Get all users who favorited this product
  const favorites = await WishlistProduct.find({ product: productId })
    .populate({
      path: "user",
      select: "firstName lastName email profilePicture",
    })
    .lean();

  // Apply presigned URLs for user profile pictures
  const favoritesWithUrls = await Promise.all(
    favorites.map(async (fav) => {
      if (fav.user?.profilePicture) {
        fav.user.profilePicture = await getPresignedUrl(
          `profilePicture/${fav.user.profilePicture}`
        );
      }
      return fav;
    })
  );

  res.status(200).json({
    status: "success",
    count: favoritesWithUrls.length,
    favorites: favoritesWithUrls,
  });
});

// Get all products favorited by users (for sellers - to see which of their products are favorited)
export const getSellerProductFavorites = catchAsync(async (req, res, next) => {
  const sellerId = req.user._id;

  // Get all products created by this seller
  const sellerProducts = await Product.find({ createdBy: sellerId }).select("_id title");

  const productIds = sellerProducts.map((p) => p._id.toString());

  // Get all wishlist entries for these products
  const favorites = await WishlistProduct.find({
    product: { $in: productIds },
  })
    .populate({
      path: "product",
      select: "title slug productImages",
    })
    .populate({
      path: "user",
      select: "firstName lastName email profilePicture",
    })
    .lean();

  // Group by product
  const productFavoritesMap = {};
  favorites.forEach((fav) => {
    const productId = fav.product._id.toString();
    if (!productFavoritesMap[productId]) {
      productFavoritesMap[productId] = {
        product: fav.product,
        users: [],
      };
    }
    productFavoritesMap[productId].users.push(fav.user);
  });

  // Apply presigned URLs
  const result = await Promise.all(
    Object.values(productFavoritesMap).map(async (item) => {
      // Product images
      if (item.product?.productImages?.length) {
        item.product.productImages = await Promise.all(
          item.product.productImages.map((img) =>
            getPresignedUrl(`products/${img}`)
          )
        );
      }

      // User profile pictures
      item.users = await Promise.all(
        item.users.map(async (user) => {
          if (user?.profilePicture) {
            user.profilePicture = await getPresignedUrl(
              `profilePicture/${user.profilePicture}`
            );
          }
          return user;
        })
      );

      return item;
    })
  );

  res.status(200).json({
    status: "success",
    products: result,
  });
});
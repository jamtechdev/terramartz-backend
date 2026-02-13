import { Cart } from "../../models/customers/cart.js";
import { Product } from "../../models/seller/product.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { getPresignedUrl } from "../../utils/awsS3.js";

// 1️⃣ Add to Cart
export const addToCart = catchAsync(async (req, res, next) => {
  const { product: productId, quantity = 1 } = req.body;

  // Check if product exists
  const product = await Product.findById(productId);
  if (!product) return next(new AppError("Product not found", 404));

  // Handle both _id and id formats for user (Cart model stores user as String)
  const userId = req.user._id || req.user.id;
  const userIdString = String(userId);
  
  // Check if Cart already has this product for this user (try multiple ID formats)
  let cartItem = await Cart.findOne({
    product: productId,
    $or: [
      { user: userIdString },
      { user: userId },
      { user: req.user._id },
      { user: req.user.id },
    ]
  });

  if (cartItem) {
    // Product already in cart → update quantity
    cartItem.quantity += quantity;
    await cartItem.save();
  } else {
    // New cart item - use String format to match Cart model
    cartItem = await Cart.create({
      product: productId,
      user: userIdString, // Store as String to match Cart schema
      quantity,
    });
  }

  res.status(201).json({ status: "success", cartItem });
});

// 2️⃣ Update Cart Item (PATCH)
export const updateCartItem = catchAsync(async (req, res, next) => {
  const { quantity } = req.body;

  if (!quantity || quantity < 1)
    return next(new AppError("Quantity must be at least 1", 400));

  const cartItem = await Cart.findOne({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!cartItem) return next(new AppError("Cart item not found", 404));

  cartItem.quantity = quantity;
  await cartItem.save();

  res.status(200).json({ status: "success", cartItem });
});

// 3️⃣ Delete Cart Item
export const deleteCartItem = catchAsync(async (req, res, next) => {
  const cartItem = await Cart.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!cartItem) return next(new AppError("Cart item not found", 404));

  res.status(204).json({ status: "success", data: null });
});

// 4️⃣ Get Single Cart Item
export const getCartItem = catchAsync(async (req, res, next) => {
  const cartItem = await Cart.findOne({
    _id: req.params.id,
    user: req.user._id,
  }).populate({
    path: "product",
    populate: { path: "category" }
  });

  if (!cartItem) return next(new AppError("Cart item not found", 404));

  // 🔹 Presigned URLs apply
  if (cartItem.product?.productImages?.length) {
    const presignedImages = await Promise.all(
      cartItem.product.productImages.map(async (imgKey) => {
        const url = await getPresignedUrl(`products/${imgKey}`);
        return url || imgKey;
      })
    );
    cartItem.product.productImages = presignedImages;
  }

  res.status(200).json({ status: "success", cartItem });
});

// 5️⃣ Get All Cart Items for current user

export const getAllCartItems = catchAsync(async (req, res, next) => {
  const cartItems = await Cart.find({ user: req.user._id }).populate({
    path: "product",
    populate: { path: "category" }
  });

  // 🔹 Presigned URLs apply for each product image
  await Promise.all(
    cartItems.map(async (item) => {
      if (item.product?.productImages?.length) {
        const presignedImages = await Promise.all(
          item.product.productImages.map(async (imgKey) => {
            const url = await getPresignedUrl(`products/${imgKey}`);
            return url || imgKey;
          })
        );
        item.product.productImages = presignedImages;
      }
    })
  );

  res.status(200).json({
    status: "success",
    results: cartItems.length,
    cartItems,
  });
});

// 6️⃣ Clear All Cart Items for current user
export const clearAllCartItems = catchAsync(async (req, res, next) => {
  const deleted = await Cart.deleteMany({ user: req.user._id });
  
  res.status(200).json({
    status: "success",
    message: "Cart cleared successfully",
    deletedCount: deleted.deletedCount,
  });
});
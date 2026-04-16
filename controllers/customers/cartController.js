import { Cart } from "../../models/customers/cart.js";
import { Product } from "../../models/seller/product.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import { getPresignedUrl } from "../../utils/awsS3.js";

/** Cart.user is stored as string; JWT may expose _id vs id in different shapes */
function cartUserKeys(req) {
  return [
    ...new Set(
      [req.user._id, req.user.id].filter(Boolean).map((x) => String(x)),
    ),
  ];
}

// 1️⃣ Add to Cart
export const addToCart = catchAsync(async (req, res, next) => {
  const { product: productId, quantity = 1 } = req.body;
  const qty = Number(quantity) || 1;
  if (qty < 1) {
    return next(new AppError("Quantity must be at least 1", 400));
  }

  // Check if product exists (fetch only required fields for faster reads)
  const product = await Product.findById(productId).select(
    "_id stockQuantity createdBy",
  );
  if (!product) return next(new AppError("Product not found", 404));

  // Cart model stores user as String; normalize once for indexed lookup
  const userId = req.user._id || req.user.id;
  const userIdString = String(userId);

  // Uses unique compound index on { product, user }
  let cartItem = await Cart.findOne({ product: productId, user: userIdString });

  if (cartItem) {
    // Product already in cart → update quantity
    const totalQuantity = cartItem.quantity + qty;

    // Validate stock
    if (totalQuantity > product.stockQuantity) {
      return next(
        new AppError(
          `Insufficient stock. Only ${product.stockQuantity} items available. You already have ${cartItem.quantity} in your cart.`,
          400
        )
      );
    }

    cartItem.quantity = totalQuantity;
    // Ensure sellerId is set even for old items
    if (!cartItem.sellerId) cartItem.sellerId = product.createdBy;
    await cartItem.save();
  } else {
    // Validate stock for new item
    if (quantity > product.stockQuantity) {
      return next(
        new AppError(
          `Insufficient stock. Only ${product.stockQuantity} items available.`,
          400
        )
      );
    }

    // New cart item - use String format to match Cart model
    cartItem = await Cart.create({
      product: productId,
      user: userIdString, // Store as String to match Cart schema
      quantity: qty,
      sellerId: product.createdBy, // Store product owner as sellerId
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
    user: { $in: cartUserKeys(req) },
  }).populate("product");

  if (!cartItem) return next(new AppError("Cart item not found", 404));

  // Validate stock
  if (quantity > cartItem.product.stockQuantity) {
    return next(
      new AppError(
        `Insufficient stock. Only ${cartItem.product.stockQuantity} items available.`,
        400
      )
    );
  }

  cartItem.quantity = quantity;
  await cartItem.save();

  res.status(200).json({ status: "success", cartItem });
});

// 3️⃣ Delete Cart Item
export const deleteCartItem = catchAsync(async (req, res, next) => {
  const cartItem = await Cart.findOneAndDelete({
    _id: req.params.id,
    user: { $in: cartUserKeys(req) },
  });
  if (!cartItem) return next(new AppError("Cart item not found", 404));

  res.status(204).json({ status: "success", data: null });
});

// 4️⃣ Get Single Cart Item
export const getCartItem = catchAsync(async (req, res, next) => {
  const cartItem = await Cart.findOne({
    _id: req.params.id,
    user: { $in: cartUserKeys(req) },
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
  const cartItems = await Cart.find({ user: { $in: cartUserKeys(req) } }).populate({
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
  const deleted = await Cart.deleteMany({ user: { $in: cartUserKeys(req) } });

  res.status(200).json({
    status: "success",
    message: "Cart cleared successfully",
    deletedCount: deleted.deletedCount,
  });
});
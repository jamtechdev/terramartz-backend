import { Product } from "../../models/seller/product.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import APIFeatures from "../../utils/apiFeatures.js";
import { getDirectUrl } from "../../utils/awsS3.js";

// ==========================
// GET ALL PRODUCTS WITH FILTERS AND PAGINATION
// ==========================
export const getAllProducts = catchAsync(async (req, res) => {
  const { 
    search, 
    status, 
    productType, 
    category, 
    sellerId, 
    farmId, 
    minPrice, 
    maxPrice, 
    organic, 
    featured, 
    adminApproved, 
    page = 1, 
    limit = 10 
  } = req.query;

  const pageNum = Number(page);
  const limitNum = Number(limit);
  const skip = (pageNum - 1) * limitNum;

  // ======================
  // BUILD MATCH OBJECT
  // ======================
  const match = {};

  // Status filter
  if (status) {
    match.status = status;
  }

  // Product type filter
  if (productType) {
    match.productType = productType;
  }

  // Category filter
  if (category) {
    match.category = category;
  }

  // Seller ID filter
  if (sellerId) {
    match.createdBy = sellerId;
  }

  // Farm ID filter
  if (farmId) {
    match.farmId = farmId;
  }

  // Price range filter
  if (minPrice || maxPrice) {
    match.price = {};
    if (minPrice) match.price.$gte = Number(minPrice);
    if (maxPrice) match.price.$lte = Number(maxPrice);
  }

  // Organic filter
  if (organic !== undefined) {
    match.organic = organic === 'true' || organic === true;
  }

  // Featured filter
  if (featured !== undefined) {
    match.featured = featured === 'true' || featured === true;
  }

  // Admin approval filter
  if (adminApproved !== undefined) {
    match.adminApproved = adminApproved === 'true' || adminApproved === true;
  }

  // Search filter (title, description, tags)
  if (search) {
    const words = search.trim().split(/\s+/);
    
    match.$and = words.map((word) => {
      const regex = new RegExp(word, "i");
      return {
        $or: [
          { title: regex },
          { description: regex },
          { tags: { $in: [regex] } },
        ],
      };
    });
  }

  // ======================
  // COUNT TOTAL MATCHES
  // ======================
  const total = await Product.countDocuments(match);

  // ======================
  // EXECUTE QUERY WITH PAGINATION
  // ======================
  const products = await Product.find(match)
    .populate({
      path: 'createdBy',
      select: 'firstName lastName email phoneNumber role'
    })
    .populate({
      path: 'category',
      select: 'name slug description'
    })
    .populate({
      path: 'farmId',
      select: 'name location'
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum);

  // ======================
  // FORMAT RESPONSE
  // ======================
  res.status(200).json({
    status: "success",
    page: pageNum,
    limit: limitNum,
    total,
    results: products.length,
    products: products.map(product => ({
      _id: product._id,
      title: product.title,
      slug: product.slug,
      description: product.description,
      price: product.price,
      originalPrice: product.originalPrice,
      category: product.category,
      stockQuantity: product.stockQuantity,
      productImages: (product.productImages || []).map((img) => getDirectUrl(`products/${img}`)),
      tags: product.tags,
      organic: product.organic,
      featured: product.featured,
      productType: product.productType,
      status: product.status,
      delivery: product.delivery,
      createdBy: product.createdBy ? {
        _id: product.createdBy._id,
        name: `${product.createdBy.firstName || ''} ${product.createdBy.lastName || ''}`.trim(),
        email: product.createdBy.email,
        phoneNumber: product.createdBy.phoneNumber,
        role: product.createdBy.role
      } : null,
      farmInfo: product.farmId ? {
        _id: product.farmId._id,
        name: product.farmId.name,
        location: product.farmId.location
      } : null,
      discount: product.discount,
      discountType: product.discountType,
      discountExpires: product.discountExpires,
      adminApproved: product.adminApproved,
      approvedBy: product.approvedBy,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt
    }))
  });
});

// ==========================
// UPDATE PRODUCT STATUS
// ==========================
export const updateProductStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  // Validate status
  const validStatuses = ['active', 'inactive', 'draft', 'out_of_stock', 'archived'];
  if (!validStatuses.includes(status)) {
    return next(new AppError(`Invalid status. Valid statuses are: ${validStatuses.join(', ')}`, 400));
  }

  const product = await Product.findById(id);
  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  const updatedProduct = await Product.findByIdAndUpdate(
    id,
    { status },
    { new: true, runValidators: true }
  );

  res.status(200).json({
    status: "success",
    data: {
      _id: updatedProduct._id,
      title: updatedProduct.title,
      status: updatedProduct.status,
      updatedAt: updatedProduct.updatedAt
    }
  });
});

// ==========================
// GET SINGLE PRODUCT BY ID
// ==========================
export const getProductById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const product = await Product.findById(id)
    .populate({
      path: 'createdBy',
      select: 'firstName lastName email phoneNumber role'
    })
    .populate({
      path: 'category',
      select: 'name slug description'
    })
    .populate({
      path: 'farmId',
      select: 'name location'
    });

  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: product
  });
});

// ==========================
// UPDATE PRODUCT APPROVAL STATUS
// ==========================
export const updateProductApproval = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { approved, status } = req.body; // Expect explicit approval status

  const product = await Product.findById(id);
  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  let newApprovalStatus;
  let newStatus;

  if (approved !== undefined) {
    newApprovalStatus = approved;
  } else {
    // Fallback to toggle if not provided (though explicit is better)
    newApprovalStatus = !product.adminApproved;
  }

  if (newApprovalStatus) {
    newStatus = 'active';
  } else {
    // If rejecting, set to rejected or keep as pending/draft? 
    // If explicitly rejected, use 'rejected'. If just unapproved (toggle), use 'pending'.
    // If status is provided in body (e.g. 'rejected'), use that.
    newStatus = status || 'rejected';
  }

  const updatedProduct = await Product.findByIdAndUpdate(
    id,
    { 
      adminApproved: newApprovalStatus,
      status: newStatus,
      approvedBy: newApprovalStatus ? (req.user ? req.user._id : null) : null
    },
    { new: true, runValidators: true }
  )
  .populate({
    path: 'createdBy',
    select: 'firstName lastName email phoneNumber role'
  });

  res.status(200).json({
    status: "success",
    data: updatedProduct
  });
});

// ==========================
// DELETE PRODUCT (Soft delete by setting status to archived)
// ==========================
export const deleteProduct = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const product = await Product.findById(id);
  if (!product) {
    return next(new AppError("Product not found", 404));
  }

  // Instead of hard delete, set status to archived
  await Product.findByIdAndUpdate(id, { status: 'archived' });

  res.status(200).json({
    status: "success",
    message: "Product archived successfully"
  });
});
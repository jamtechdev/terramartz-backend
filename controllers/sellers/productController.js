import mongoose from "mongoose";
import {
  uploadToS3,
  deleteFileFromS3,
  getDirectUrl,
} from "../../utils/awsS3.js";
import { Product } from "../../models/seller/product.js";
import { Purchase } from "../../models/customers/purchase.js";
import { ProductPerformance } from "../../models/seller/productPerformance.js";
import { Farm } from "../../models/seller/farm.js";
import { User } from "../../models/users.js";
import { Category } from "../../models/super-admin/category.js";
// import { getPresignedUrl } from "../../utils/awsS3.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import APIFeatures from "../../utils/apiFeatures.js";

// =================== CREATE PRODUCT ===================

export const createProduct = catchAsync(async (req, res, next) => {
  if (req.user.role !== "seller") {
    return next(new AppError("Only sellers can create products!", 403));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    req.body.createdBy = req.user._id;

    // Debug: Log files received and category
    console.log('📸 Files received:', {
      filesCount: req.files?.length || 0,
      files: req.files?.map(f => ({ fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, size: f.size })) || [],
      bodyKeys: Object.keys(req.body),
    });
    
    // Debug: Log category value
    console.log('📂 Category received:', {
      category: req.body.category,
      categoryType: typeof req.body.category,
      hasCategory: !!req.body.category,
    });

    // 🔹 S3 upload for productImages
    if (req.files && req.files.length > 0) {
      req.body.productImages = [];
      await Promise.all(
        req.files.map(async (file, i) => {
          try {
            // ✅ Database-এ শুধু filename store
            const key = `${req.user._id}-${Date.now()}-${i}.jpeg`;
            console.log(`📤 Uploading image ${i + 1}/${req.files.length}: ${key}`);
            await uploadToS3(file.buffer, `products/${key}`, "image/jpeg");
            req.body.productImages.push(key); // ✅ DB-এ শুধু key
            console.log(`✅ Image uploaded successfully: ${key}`);
          } catch (error) {
            console.error(`❌ Error uploading image ${i + 1}:`, error);
            throw error;
          }
        })
      );
      console.log(`✅ Total ${req.body.productImages.length} images uploaded and saved to productImages array`);
    } else {
      console.warn('⚠️ No files received in req.files. Files might not be uploaded properly.');
    }

    // 🔹 Validate category exists
    if (!req.body.category) {
      throw new AppError("Category is required", 400);
    }
    
    // 🔹 Verify category exists in database
    // Category model uses String _id, but database might have ObjectId format from old data
    // Try to find category using the ID as-is (MongoDB will handle the conversion)
    const categoryId = String(req.body.category).trim();
    
    // Try multiple lookup strategies
    let categoryExists = await Category.findOne({ _id: categoryId }).session(session);
    
    // If not found, try without session
    if (!categoryExists) {
      categoryExists = await Category.findOne({ _id: categoryId });
    }
    
    // If still not found and it's a valid ObjectId, try with ObjectId conversion
    // (Some old categories might be stored as ObjectId in MongoDB even though schema says String)
    if (!categoryExists && mongoose.Types.ObjectId.isValid(categoryId)) {
      try {
        // Try with ObjectId - MongoDB might have stored it as ObjectId
        const objectId = new mongoose.Types.ObjectId(categoryId);
        categoryExists = await Category.findById(objectId).session(session) || 
                        await Category.findById(objectId);
      } catch (err) {
        // Ignore ObjectId conversion errors
      }
    }
    
    if (!categoryExists) {
      // Get all categories for debugging
      const allCategories = await Category.find({}).select('_id name').limit(50).lean();
      
      console.error('❌ Category lookup failed:', {
        requestedId: categoryId,
        requestedIdLength: categoryId.length,
        requestedIdFormat: categoryId.includes('-') ? 'UUID-like' : 'ObjectId-like',
        totalCategoriesInDB: allCategories.length,
        sampleCategoryIds: allCategories.slice(0, 5).map(c => ({
          id: String(c._id),
          name: c.name,
          length: String(c._id).length
        }))
      });
      
      throw new AppError(`Category with ID ${categoryId} does not exist. Please select a valid category.`, 400);
    }
    
    console.log('✅ Category verified:', {
      categoryId: categoryExists._id,
      categoryName: categoryExists.name,
      categoryIdType: typeof categoryExists._id,
      categoryIdString: String(categoryExists._id),
    });
    
    // 🔹 Product create (slug auto-generate model pre-save hook এ)
    const productDocs = await Product.create([req.body], { session });
    const product = productDocs[0];
    
    // Debug: Log created product category
    console.log('✅ Product created:', {
      productId: product._id,
      category: product.category,
      categoryType: typeof product.category,
      categoryMatches: product.category === req.body.category,
    });

    // 🔹 ProductPerformance create
    await ProductPerformance.create(
      [{ product: product._id, currentStock: req.body.stockQuantity }],
      { session }
    );

    // 🔹 Seller Farm - Add farmId and farmName to product
    const farm = await Farm.findOne({ owner: req.user._id }).session(session);
    if (!farm) throw new AppError("Seller's farm not found!", 404);
    
    // Add farmId and farmName to product
    product.farmId = farm._id;
    product.farmName = req.user.businessDetails?.businessName || farm.description || "Farm";
    await product.save({ session });
    
    // Also add product to farm's products array (existing relationship)
    if (!farm.products.includes(product._id)) {
      farm.products.push(product._id);
      await farm.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    // 🔹 Populate category for response
    await product.populate({
      path: "category",
      select: "name _id",
    });

    // 🔹 Generate direct S3 URLs for product images
    const productImagesWithUrls = (product.productImages || []).map((img) =>
      getDirectUrl(`products/${img}`)
    );

    // 🔹 Response
    res.status(201).json({
      status: "success",
      message: "Product created successfully",
      product: {
        ...product.toObject(),
        category: product.category
          ? { _id: product.category._id, name: product.category.name }
          : null,
        productImages: productImagesWithUrls, // ✅ presigned URLs applied
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(new AppError(err.message || "Failed to create product", 500));
  }
});

// GET All Products (with search + filter + pagination)
export const getAllProducts = catchAsync(async (req, res, next) => {
  let query = Product.find({ createdBy: req.user._id });

  // 🔍 search support
  if (req.query.search) {
    query = query.find({ $text: { $search: req.query.search } });
  }

  const features = new APIFeatures(query, req.query).paginate();
  const products = await features.query;

  res.status(200).json({
    status: "success",
    results: products.length,
    page: req.query.page * 1 || 1, // current page দেখানো
    limit: req.query.limit * 1 || 100, // প্রতি পেজে কয়টা
    products,
  });
});

// GET Single Product + Performance

export const getProduct = catchAsync(async (req, res, next) => {
  const product = await Product.findById(req.params.id).populate("category");

  if (!product) return next(new AppError("Product not found", 404));

  const performance = await ProductPerformance.findOne({
    product: req.params.id,
  });

  // 🔹 Generate direct S3 URLs
  const productImages = product.productImages
    ? product.productImages.map((img) => getDirectUrl(`products/${img}`))
    : [];

  const category = product.category
    ? {
        ...product.category.toObject(),
        image: product.category.image
          ? getDirectUrl(`categories/${product.category.image}`)
          : null,
        logo: product.category.logo
          ? getDirectUrl(`categories/${product.category.logo}`)
          : null,
      }
    : null;

  const productWithUrls = {
    ...product.toObject(),
    productImages,
    category,
  };

  res.status(200).json({
    status: "success",
    product: productWithUrls,
    performance,
  });
});

// =================== UPDATE PRODUCT ===================

export const updateProduct = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const product = await Product.findById(req.params.id).session(session);
    if (!product) throw new AppError("Product not found", 404);
    if (product.createdBy.toString() !== req.user._id)
      throw new AppError("Not authorized", 403);

    // 🔹 S3 upload for new product images
    if (req.files && req.files.length > 0) {
      req.body.productImages = [];

      // পুরানো images S3 থেকে delete (optional)
      if (req.oldImages && Array.isArray(req.oldImages)) {
        await Promise.all(
          req.oldImages.map(
            async (imgKey) => await deleteFileFromS3(`products/${imgKey}`)
          )
        );
      }

      // নতুন images S3 এ upload
      await Promise.all(
        req.files.map(async (file, i) => {
          const key = `${req.user._id}-${Date.now()}-${i}.jpeg`;
          await uploadToS3(file.buffer, `products/${key}`, "image/jpeg");
          req.body.productImages.push(key);
        })
      );
    }

    // Update title / slug automatically
    product.title = req.body.title || product.title;
    product.description = req.body.description || product.description;
    product.price = req.body.price || product.price;
    product.stockQuantity = req.body.stockQuantity ?? product.stockQuantity;
    product.category = req.body.category || product.category;
    if (req.body.productImages) product.productImages = req.body.productImages;

    await product.save({ session });

    // Update performance
    const perfUpdate = {};
    if (req.body.stockQuantity !== undefined)
      perfUpdate.currentStock = req.body.stockQuantity;
    await ProductPerformance.findOneAndUpdate(
      { product: product._id },
      perfUpdate,
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // 🔹 Generate direct S3 URLs for product images
    let productImagesWithUrls = [];
    if (product.productImages && product.productImages.length > 0) {
      productImagesWithUrls = product.productImages.map((imgKey) =>
        getDirectUrl(`products/${imgKey}`)
      );
    }

    res.status(200).json({
      status: "success",
      product: {
        ...product.toObject(),
        productImages: productImagesWithUrls, // presigned URLs
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(new AppError(err.message, 500));
  }
});
// =================== DELETE PRODUCT with S3 ===================
export const deleteProduct = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const product = await Product.findById(req.params.id).session(session);
    if (!product) throw new AppError("Product not found", 404);
    if (product.createdBy.toString() !== req.user._id)
      throw new AppError("Not authorized", 403);

    // 🔹 Delete product images from S3
    if (product.productImages && product.productImages.length > 0) {
      await Promise.all(
        product.productImages.map(async (imgKey) => {
          await deleteFileFromS3(`products/${imgKey}`);
        })
      );
    }

    await ProductPerformance.findOneAndDelete(
      { product: product._id },
      { session }
    );
    await Product.findByIdAndDelete(product._id, { session });

    // Remove from farm
    const farm = await Farm.findOne({ owner: req.user._id }).session(session);
    if (farm) {
      farm.products = farm.products.filter(
        (id) => id.toString() !== product._id.toString()
      );
      await farm.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    res
      .status(204)
      .json({ status: "success", message: "Product deleted successfully" });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(new AppError(err.message, 500));
  }
});

// 1️⃣ Increment Views (public)
// ------------------
export const incrementViews = catchAsync(async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const performance = await ProductPerformance.findOne({
      product: req.params.id,
    }).session(session);
    if (!performance) throw new AppError("Performance not found", 404);

    performance.views += 1;

    await performance.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ status: "success", performance });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(new AppError(err.message, 500));
  }
});

// ------------------
// 2️⃣ Increment Sales & Update Stock (protected, backend)
// ------------------
export const incrementSalesAndUpdateStock = catchAsync(
  async (req, res, next) => {
    const { quantity = 1 } = req.body; // purchased quantity
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1️⃣ Find performance record
      const performance = await ProductPerformance.findOne({
        product: req.params.id,
      }).session(session);
      if (!performance) throw new AppError("Product not found", 404);

      // 2️⃣ Update sales + stock
      if (performance.currentStock < quantity)
        throw new AppError("Not enough stock", 400);

      performance.totalSales += quantity;
      performance.currentStock -= quantity;

      await performance.save({ session });

      // 3️⃣ Also update Product stockQuantity field
      const product = await Product.findById(req.params.id).session(session);
      if (!product) throw new AppError("Product not found", 404);

      if (product.stockQuantity < quantity)
        throw new AppError("Not enough stock in Product", 400);

      product.stockQuantity -= quantity;
      await product.save({ session });

      // 🔥 4️⃣ Prepare productImages with direct S3 URLs
      let productImagesWithUrl = [];
      if (product.productImages && product.productImages.length > 0) {
        productImagesWithUrl = product.productImages.map((imgKey) =>
          getDirectUrl(`products/${imgKey}`)
        );
      }

      // 5️⃣ Commit the transaction
      await session.commitTransaction();
      session.endSession();

      // 🔥 6️⃣ Send response with PRESIGNED URLs (NO CHANGE IN STRUCTURE)
      res.status(200).json({
        status: "success",
        performance,
        product: {
          ...product.toObject(),
          productImages: productImagesWithUrl, // 🟢 replace with presigned URLs
        },
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError(err.message, 500));
    }
  }
);
// export const incrementSalesAndUpdateStock = catchAsync(
//   async (req, res, next) => {
//     const { quantity = 1 } = req.body; // purchased quantity
//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//       // 1️⃣ Find performance record
//       const performance = await ProductPerformance.findOne({
//         product: req.params.id,
//       }).session(session);
//       if (!performance) throw new AppError("Product not found", 404);

//       // 2️⃣ Update sales + stock
//       if (performance.currentStock < quantity)
//         throw new AppError("Not enough stock", 400);

//       performance.totalSales += quantity;
//       performance.currentStock -= quantity;

//       await performance.save({ session });

//       // 3️⃣ Also update Product stockQuantity field
//       const product = await Product.findById(req.params.id).session(session);
//       if (!product) throw new AppError("Product not found", 404);

//       if (product.stockQuantity < quantity)
//         throw new AppError("Not enough stock in Product", 400);

//       product.stockQuantity -= quantity;
//       await product.save({ session });

//       // 4️⃣ Commit the transaction
//       await session.commitTransaction();
//       session.endSession();

//       res.status(200).json({
//         status: "success",
//         performance,
//         product, // send updated product too
//       });
//     } catch (err) {
//       await session.abortTransaction();
//       session.endSession();
//       return next(new AppError(err.message, 500));
//     }
//   }
// );

// ------------------
// 3️⃣ Update Rating (protected, authenticated user)
// ------------------
export const updateRating = catchAsync(async (req, res, next) => {
  const { rating } = req.body;
  if (rating === undefined)
    return next(new AppError("Rating is required", 400));

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const performance = await ProductPerformance.findOne({
      product: req.params.id,
    }).session(session);
    if (!performance) throw new AppError("Performance not found", 404);

    // Simple average calculation (example)
    if (!performance.rating || performance.rating === 0) {
      performance.rating = rating;
    } else {
      performance.rating = (performance.rating + rating) / 2;
    }

    await performance.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ status: "success", performance });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(new AppError(err.message, 500));
  }
});

// GET single product + performance
export const getProductWithPerformance = catchAsync(async (req, res, next) => {
  // 🔹 Fetch product and populate category + seller info
  const product = await Product.findById(req.params.id)
    .populate("category")
    .populate({
      path: "createdBy",
      select: "firstName middleName lastName profilePicture businessDetails",
    });

  if (!product) return next(new AppError("Product not found", 404));

  // 🔹 Fetch product performance
  const performance = await ProductPerformance.findOne({
    product: req.params.id,
  }).lean();

  // 🔹 Build seller info object
  const seller = product.createdBy
    ? {
        _id: product.createdBy._id,
        name: `${product.createdBy.firstName || ""} ${
          product.createdBy.middleName || ""
        } ${product.createdBy.lastName || ""}`
          .replace(/\s+/g, " ")
          .trim(),
        profilePicture: product.createdBy.profilePicture || null,
        shopName: product.createdBy.businessDetails?.businessName || null,
        shopLocation:
          product.createdBy.businessDetails?.businessLocation || null,
      }
    : null;

  // 🔹 Prepare final response object
  const productWithPerformance = {
    _id: product._id,
    title: product.title,
    slug: product.slug || "",
    description: product.description,
    price: product.price,
    originalPrice: product.originalPrice,
    category: product.category,
    stockQuantity: product.stockQuantity,
    productImages: product.productImages || [],
    tags: product.tags || [],
    organic: product.organic,
    featured: product.featured,
    productType: product.productType,
    status: product.status,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    performance: performance || {
      views: 0,
      totalSales: 0,
      rating: 0,
      currentStock: product.stockQuantity || 0,
    },
    seller,
  };

  res.status(200).json({
    status: "success",
    product: productWithPerformance,
  });
});

// GET All Products (Public)

export const getAllProductWithPerformance = catchAsync(
  async (req, res, next) => {
    // 🔹 Build base query object first (plain JavaScript object)
    let baseQuery = {}; // Base query object
    
    if (req.user && req.user.role === "seller" && req.query.sellerOnly === "true") {
      baseQuery.createdBy = req.user._id;
      console.log("🔍 Filtering products for seller:", req.user._id);
    }

    // 🔍 search support - build query object
    if (req.query.search) {
      baseQuery.$text = { $search: req.query.search };
    }

    // 🔹 Get total count BEFORE creating the query chain
    const total = await Product.countDocuments(baseQuery);
    
    // 🔹 Now create a fresh query for fetching products
    let query = Product.find(baseQuery);

    const features = new APIFeatures(query, req.query).paginate();

    // 🔹 Populate seller/shop info
    let products = await features.query.populate({
      path: "createdBy",
      select:
        "firstName middleName lastName profilePicture businessDetails sellerProfile",
    });

    // 🔹 Fetch all performances for these products in ONE query
    const productIds = products.map((p) => p._id);
    const performances = await ProductPerformance.find({
      product: { $in: productIds },
    }).lean();

    // 🔹 Map performance to products
    const performanceMap = {};
    performances.forEach((p) => {
      performanceMap[p.product.toString()] = p;
    });

    // 🔹 Build response with direct S3 URLs
    const productsWithPerformance = products.map((p) => {
      // 🔹 Direct S3 URLs for product images
      let productImages = (p.productImages || []).map((img) =>
        getDirectUrl(`products/${img}`)
      );

      let seller = null;
      if (p.createdBy) {
        // 🔹 Profile Picture
        let profilePictureUrl = null;
        if (p.createdBy.profilePicture) {
          profilePictureUrl = getDirectUrl(
            `profilePicture/${p.createdBy.profilePicture}`
          );
        }

        // 🔹 Shop Picture
        let shopPictureUrl = null;
        if (p.createdBy.sellerProfile?.shopPicture) {
          shopPictureUrl = getDirectUrl(
            `shopPicture/${p.createdBy.sellerProfile.shopPicture}`
          );
        }

        seller = {
          _id: p.createdBy._id,
          name: `${p.createdBy.firstName || ""} ${
            p.createdBy.middleName || ""
          } ${p.createdBy.lastName || ""}`
            .replace(/\s+/g, " ")
            .trim(),
          profilePicture: profilePictureUrl,
          shopName: p.createdBy.businessDetails?.businessName || null,
          shopLocation: p.createdBy.businessDetails?.businessLocation || null,
          shopPicture: shopPictureUrl, // 🔹 Added shopPicture
        };
      }

      return {
        _id: p._id,
        title: p.title,
        slug: p.slug || "",
        description: p.description,
        price: p.price,
        originalPrice: p.originalPrice,
        category: p.category,
        stockQuantity: p.stockQuantity,
        productImages,
        tags: p.tags || [],
        organic: p.organic,
        featured: p.featured,
        productType: p.productType,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        performance: performanceMap[p._id.toString()] || {
          views: 0,
          totalSales: 0,
          rating: 0,
          currentStock: p.stockQuantity || 0,
        },
        seller,
      };
    });

    res.status(200).json({
      status: "success",
      results: products.length,
      total: total, // Total count of all products matching the query
      page: req.query.page * 1 || 1,
      limit: req.query.limit * 1 || 100,
      products: productsWithPerformance,
    });
  }
);

// https://terramartz-backend-v2.onrender.com/api/products?page=1&limit=5&topSelling=true
// ✅ Seller Products (with Top Selling Option)
export const getSellerProductsWithPerformance = catchAsync(
  async (req, res, next) => {
    const sellerId = req.user._id;
    const isTopSelling = req.query.topSelling === "true";
    const page = req.query.page * 1 || 1;
    const limit = req.query.limit * 1 || 10;

    let productSalesMap = {};
    let productIds = [];

    // ✅ Safe ObjectId conversion
    const safeObjectId = (id) => {
      if (mongoose.Types.ObjectId.isValid(id))
        return new mongoose.Types.ObjectId(id);
      return id;
    };

    if (isTopSelling) {
      // 🔹 Aggregate top selling with pagination
      const topSelling = await Purchase.aggregate([
        { $unwind: "$products" },
        { $match: { "products.seller": safeObjectId(sellerId) } },
        {
          $group: {
            _id: "$products.product",
            totalQuantity: { $sum: "$products.quantity" },
          },
        },
        { $sort: { totalQuantity: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]);

      productIds = topSelling.map((p) => p._id.toString());

      topSelling.forEach((p) => {
        productSalesMap[p._id.toString()] = p.totalQuantity;
      });
    } else {
      // 🔹 সব seller products এর sold quantity
      const allSales = await Purchase.aggregate([
        { $unwind: "$products" },
        { $match: { "products.seller": safeObjectId(sellerId) } },
        {
          $group: {
            _id: "$products.product",
            totalQuantity: { $sum: "$products.quantity" },
          },
        },
      ]);

      allSales.forEach((p) => {
        productSalesMap[p._id.toString()] = p.totalQuantity;
      });
    }

    // 🔹 Product Query
    let query = isTopSelling
      ? Product.find({ _id: { $in: productIds }, createdBy: sellerId })
      : Product.find({ createdBy: sellerId });

    if (req.query.search) {
      query = query.find({ $text: { $search: req.query.search } });
    }

    // 🔹 Pagination + populate seller & category
    const features = new APIFeatures(query, req.query).paginate();

    let products = await features.query
      .populate({
        path: "createdBy",
        select: "firstName middleName lastName profilePicture businessDetails",
      })
      .populate({
        path: "category",
        select: "name _id",
      });

    // 🔹 If topSelling, sort by totalSold descending
    if (isTopSelling) {
      products.sort((a, b) => {
        const soldA = productSalesMap[a._id.toString()] || 0;
        const soldB = productSalesMap[b._id.toString()] || 0;
        return soldB - soldA;
      });
    }

    // 🔹 Fetch performances
    const allProductIds = products.map((p) => p._id);
    const performances = await ProductPerformance.find({
      product: { $in: allProductIds },
    }).lean();

    const performanceMap = {};
    performances.forEach((p) => {
      performanceMap[p.product.toString()] = p;
    });

    // 🔹 Build response with presigned URLs for product images
    const productsWithPerformance = await Promise.all(
      products.map(async (p) => {
        const seller = p.createdBy
          ? {
              _id: p.createdBy._id,
              name: `${p.createdBy.firstName || ""} ${
                p.createdBy.middleName || ""
              } ${p.createdBy.lastName || ""}`
                .replace(/\s+/g, " ")
                .trim(),
              profilePicture: p.createdBy.profilePicture || null,
              shopName: p.createdBy.businessDetails?.businessName || null,
              shopLocation:
                p.createdBy.businessDetails?.businessLocation || null,
            }
          : null;

        const totalSold = productSalesMap[p._id.toString()] || 0;

        // 🔹 Direct S3 URL for product images
        let productImagesWithUrl = [];
        if (p.productImages && p.productImages.length > 0) {
          productImagesWithUrl = p.productImages.map((imgKey) =>
            getDirectUrl(`products/${imgKey}`)
          );
        }

        return {
          _id: p._id,
          title: p.title,
          description: p.description,
          price: p.price,
          originalPrice: p.originalPrice,
          category: p.category
            ? { _id: p.category._id, name: p.category.name }
            : null,
          stockQuantity: p.stockQuantity,
          productImages: productImagesWithUrl, // ✅ direct S3 URLs
          tags: p.tags || [],
          organic: p.organic,
          featured: p.featured,
          productType: p.productType,
          status: p.status,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          performance: performanceMap[p._id.toString()] || {
            views: 0,
            totalSales: totalSold,
            rating: 0,
            currentStock: p.stockQuantity || 0,
          },
          totalSold,
          seller,
        };
      })
    );

    res.status(200).json({
      status: "success",
      topSelling: isTopSelling,
      results: products.length,
      page,
      limit,
      products: productsWithPerformance,
    });
  }
);
// export const getSellerProductsWithPerformance = catchAsync(
//   async (req, res, next) => {
//     const sellerId = req.user._id;
//     const isTopSelling = req.query.topSelling === "true";
//     const page = req.query.page * 1 || 1;
//     const limit = req.query.limit * 1 || 10;

//     let productSalesMap = {};
//     let productIds = [];

//     // ✅ Safe ObjectId conversion
//     const safeObjectId = (id) => {
//       if (mongoose.Types.ObjectId.isValid(id))
//         return new mongoose.Types.ObjectId(id);
//       return id;
//     };

//     if (isTopSelling) {
//       // 🔹 Aggregate top selling with pagination
//       const topSelling = await Purchase.aggregate([
//         { $unwind: "$products" },
//         { $match: { "products.seller": safeObjectId(sellerId) } },
//         {
//           $group: {
//             _id: "$products.product",
//             totalQuantity: { $sum: "$products.quantity" },
//           },
//         },
//         { $sort: { totalQuantity: -1 } },
//         { $skip: (page - 1) * limit },
//         { $limit: limit },
//       ]);

//       productIds = topSelling.map((p) => p._id.toString());

//       topSelling.forEach((p) => {
//         productSalesMap[p._id.toString()] = p.totalQuantity;
//       });
//     } else {
//       // 🔹 সব seller products এর sold quantity
//       const allSales = await Purchase.aggregate([
//         { $unwind: "$products" },
//         { $match: { "products.seller": safeObjectId(sellerId) } },
//         {
//           $group: {
//             _id: "$products.product",
//             totalQuantity: { $sum: "$products.quantity" },
//           },
//         },
//       ]);

//       allSales.forEach((p) => {
//         productSalesMap[p._id.toString()] = p.totalQuantity;
//       });
//     }

//     // 🔹 Product Query
//     let query = isTopSelling
//       ? Product.find({ _id: { $in: productIds }, createdBy: sellerId })
//       : Product.find({ createdBy: sellerId });

//     if (req.query.search) {
//       query = query.find({ $text: { $search: req.query.search } });
//     }

//     // 🔹 Pagination + populate seller & category
//     const features = new APIFeatures(query, req.query).paginate();

//     let products = await features.query
//       .populate({
//         path: "createdBy",
//         select: "firstName middleName lastName profilePicture businessDetails",
//       })
//       .populate({
//         path: "category",
//         select: "name _id",
//       });

//     // 🔹 If topSelling, sort by totalSold descending
//     if (isTopSelling) {
//       products.sort((a, b) => {
//         const soldA = productSalesMap[a._id.toString()] || 0;
//         const soldB = productSalesMap[b._id.toString()] || 0;
//         return soldB - soldA;
//       });
//     }

//     // 🔹 Fetch performances
//     const allProductIds = products.map((p) => p._id);
//     const performances = await ProductPerformance.find({
//       product: { $in: allProductIds },
//     }).lean();

//     const performanceMap = {};
//     performances.forEach((p) => {
//       performanceMap[p.product.toString()] = p;
//     });

//     // 🔹 Build response
//     const productsWithPerformance = products.map((p) => {
//       const seller = p.createdBy
//         ? {
//             _id: p.createdBy._id,
//             name: `${p.createdBy.firstName || ""} ${
//               p.createdBy.middleName || ""
//             } ${p.createdBy.lastName || ""}`
//               .replace(/\s+/g, " ")
//               .trim(),
//             profilePicture: p.createdBy.profilePicture || null,
//             shopName: p.createdBy.businessDetails?.businessName || null,
//             shopLocation: p.createdBy.businessDetails?.businessLocation || null,
//           }
//         : null;

//       const totalSold = productSalesMap[p._id.toString()] || 0;

//       return {
//         _id: p._id,
//         title: p.title,
//         description: p.description,
//         price: p.price,
//         originalPrice: p.originalPrice,
//         category: p.category
//           ? { _id: p.category._id, name: p.category.name }
//           : null,
//         stockQuantity: p.stockQuantity,
//         productImages: p.productImages || [],
//         tags: p.tags || [],
//         organic: p.organic,
//         featured: p.featured,
//         productType: p.productType,
//         status: p.status,
//         createdAt: p.createdAt,
//         updatedAt: p.updatedAt,
//         performance: performanceMap[p._id.toString()] || {
//           views: 0,
//           totalSales: totalSold,
//           rating: 0,
//           currentStock: p.stockQuantity || 0,
//         },
//         totalSold,
//         seller,
//       };
//     });

//     res.status(200).json({
//       status: "success",
//       topSelling: isTopSelling,
//       results: products.length,
//       page,
//       limit,
//       products: productsWithPerformance,
//     });
//   }
// );

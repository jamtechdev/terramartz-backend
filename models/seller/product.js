import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import slugify from "slugify"; // 🔹 Install npm i slugify

const productSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    title: {
      type: String,
      minlength: 1,
      maxlength: 50,
      required: [true, "Product name is required."],
      trim: true,
      index: true,
    },
    slug: {
      type: String,
      trim: true,
      index: true,
    },
    description: { type: String, trim: true, index: true },
    price: { type: Number, required: [true, "Product must have a price."] },
    originalPrice: { type: Number },
    category: { type: String, ref: "Category", required: true, index: true },
    stockQuantity: {
      type: Number,
      required: true,
      min: [0, "Stock cannot be negative"],
    },
    productImages: {
      type: [String],
      default: [],
      validate: {
        validator: (value) => value.length <= 8,
        message: "You can upload up to 8 images only.",
      },
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (value) => value.length <= 5,
        message: "You can add up to 5 tags only.",
      },
      index: true,
    },
    organic: { type: Boolean, default: false },
    featured: { type: Boolean, default: false },
    productType: {
      type: String,
      enum: ["regular", "premium", "fresh", "organic"],
      default: "regular",
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "draft", "out_of_stock", "archived"],
      default: "draft",
    },
    createdBy: { type: String, ref: "User", required: true, index: true },
    farmId: {
      type: String,
      ref: "Farm",
      index: true,
    },
    farmName: {
      type: String,
      trim: true,
    },
    discount: { type: Number, default: 0 },
    discountType: {
      type: String,
      enum: ["fixed", "percentage"],
      default: "fixed",
    },
    discountExpires: { type: Date },
    delivery: { type: String, default: "today" },
  },
  { timestamps: true }
);
// 🔹 Pre-save hook for globally unique slug
productSchema.pre("save", async function (next) {
  if (this.isModified("title") || !this.slug) {
    const baseSlug = slugify(this.title, { lower: true, strict: true });
    let slug = baseSlug;
    const Product = mongoose.model("Product");
    let counter = 1;

    // 🔹 Global uniqueness check
    while (await Product.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = slug;
  }
  next();
});

// Full text search index
productSchema.index({ title: "text", description: "text", tags: "text" });

export const Product = mongoose.model("Product", productSchema);

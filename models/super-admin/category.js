import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import slugify from "slugify"; // npm install slugify করে নিতে হবে

const categorySchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    name: {
      type: String,
      required: [true, "Category name is required."],
      trim: true,
    },
    slug: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    image: {
      type: String,
      trim: true,
    },
    logo: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: String,
      ref: "User",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// 🔹 Compound index for seller-wise unique slug
categorySchema.index({ slug: 1, createdBy: 1 }, { unique: true });

// 🔹 Pre-save hook for auto-generating slug
categorySchema.pre("save", async function (next) {
  if (this.isModified("name")) {
    let baseSlug = slugify(this.name, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;

    // Ensure seller-wise unique slug
    while (
      await mongoose.models.Category.findOne({
        slug,
        createdBy: this.createdBy,
      })
    ) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = slug;
  }
  next();
});

export const Category = mongoose.model("Category", categorySchema);

import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import slugify from "slugify";

const blogSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    title: {
      type: String,
      required: [true, "Blog title is required."],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      trim: true,
    },
    shortDescription: {
      type: String,
      required: [true, "Short description is required."],
      trim: true,
    },
    content: {
      type: String, // HTML or Markdown
      required: [true, "Content is required."],
    },
    featuredImage: {
      type: String,
      required: [true, "Featured image is required."],
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    category: {
      type: String,
      ref: "BlogCategory",
      required: [true, "Category is required."],
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    seoTitle: {
      type: String,
      trim: true,
    },
    seoDescription: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: String,
      ref: "Admin",
      required: true,
    },
  },
  { timestamps: true }
);

// Index for search
blogSchema.index({ title: "text", content: "text" });

blogSchema.pre("save", async function (next) {
  if (this.isModified("title")) {
    let baseSlug = slugify(this.title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;

    while (await mongoose.models.Blog.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = slug;
  }
  next();
});

export const Blog = mongoose.model("Blog", blogSchema);

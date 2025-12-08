import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const farmSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },

    // 🔗 Which seller owns this farm
    owner: {
      type: String,
      ref: "User",
      required: [true, "Farm must belong to a seller."],
      //index: true,
    },

    description: {
      type: String,
      trim: true,
    },
    // 🌍 Map location (for nearby search)
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    distanceRange: {
      type: Number,
    },
    // 🥬 Farm details
    certifications: [
      {
        type: String,
      },
    ],
    product_categories: [
      {
        type: String,
      },
    ],

    // 🟢🟠 Status (Active / Featured)
    farm_status: {
      type: String,
      enum: ["active", "inactive", "featured", "pending"],
      default: "pending",
    },

    // 🕒 Optional
    openingHours: {
      open: { type: String, default: "08:00" },
      close: { type: String, default: "18:00" },
    },

    // 🛒 NEW: Store related products
    products: [
      {
        type: String,
        ref: "Product",
      },
    ],
  },
  { timestamps: true }
);

// 🗺️ Geo-based search (already done — keep this)
farmSchema.index({ location: "2dsphere" });

// 🏙️ City/State level search
farmSchema.index({ owner: 1 }); // দ্রুত seller অনুযায়ী farm খুঁজতে
farmSchema.index({ farm_status: 1 }); // active/featured filter দ্রুত করার জন্য

// 🥬 Filter-related
farmSchema.index({ product_categories: 1 });
farmSchema.index({ certifications: 1 });

export const Farm = mongoose.model("Farm", farmSchema);

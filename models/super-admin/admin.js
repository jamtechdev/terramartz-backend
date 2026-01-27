import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { ROLE_PERMISSIONS } from "../../controllers/common/adminPermissionMatrix.js";

const adminSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    name: {
      type: String,
      minlength: 1,
      maxlength: 50,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: false,
      trim: true,
      validate: {
        validator: function (v) {
          return !v || /^\+?\d{10,15}$/.test(v);
        },
        message: "Invalid phone number format!",
      },
    },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      validate: {
        validator: function (v) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
      },
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: [
        "Super Admin",
        "Ops",
        "Finance",
        "Logistics",
        "Support",
        "Read-Only",
      ],
      default: "Read-Only",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    timestamps: true,
  },
);

// 2. Create the Virtual Property
// When you access user.permissions, it looks up the role in the constant above
adminSchema.virtual("permissions").get(function () {
  return ROLE_PERMISSIONS[this.role] || {};
});

// 3. Optional: Helper method to check permission easily
adminSchema.methods.hasPermission = function (module, accessLevel) {
  const permissions = ROLE_PERMISSIONS[this.role];
  if (!permissions) return false;

  const currentAccess = permissions[module];

  if (accessLevel === "View") {
    return currentAccess === "View" || currentAccess === "Full";
  }
  if (accessLevel === "Full") {
    return currentAccess === "Full";
  }
  return false;
};

export const Admin = mongoose.model("Admin", adminSchema);

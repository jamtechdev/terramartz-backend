import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import slugify from "slugify";

const userSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },
    role: {
      type: String,
      enum: ["user", "admin", "seller"],
      default: "user",
    },
    user_region: {
      type: String,
      minlength: 1,
      maxlength: 50,
      trim: true,
    },

    businessDetails: {
      businessName: {
        type: String,
        unique: true,
        trim: true,
        sparse: true, // <-- add this
      },
      businessLocation: {
        type: String,
        trim: true,
      },
      numberOfEmployees: {
        type: Number,
      },
      licenseNumber: {
        type: String,
        trim: true,
      },
      city: {
        type: String,
        trim: true,
      },

      state: {
        type: String,
        trim: true,
      },
      postalCode: {
        type: String,
        trim: true,
      },
      country: {
        type: String,
        trim: true,
        default: "Canada",
      },
    },

    termsAccepted: {
      type: Boolean,
      default: false,
    },
    receiveMarketingEmails: {
      type: Boolean,
      default: false,
    },
    firstName: {
      type: String,
      minlength: 1,
      maxlength: 50,
      trim: true,
    },
    middleName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    profilePicture: {
      type: String,
    },

    lineAddress: {
      type: String,
      trim: true,
    },
    apartmentOrBuildingNumber: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    zipCode: {
      type: String,
      trim: true,
    },
    countryCode: {
      type: String,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: false,
      trim: true,
      validate: {
        validator: function (v) {
          return !v || /^\+?\d{10,15}$/.test(v); // Validate phone number only if provided
        },
        message: "Invalid phone number format!",
      },
    },

    email: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); // Validate email only if provided
        },
        message: "Invalid email format!",
      },
    },

    password: {
      type: String,
      select: false,
    },
    passwordConfirm: {
      type: String,
      validate: {
        validator: function (el) {
          return el === this.password;
        },
        message: "Confirm password must match password",
      },
    },
    accountType: {
      type: String,
      enum: ["personal", "business"],
      required: [true, "Account type is required!"],
      default: "personal",
    },

    sellerProfile: {
      shopId: {
        type: String,
        unique: true,
        sparse: true,
      },
      shopName: {
        type: String,
        trim: true,
        unique: true,
        sparse: true, // <-- এটা add করো
      },
      shopSlug: {
        type: String,
        trim: true,
        unique: true, // ✅ keep
        sparse: true, // ✅ Add sparse
      },
      shopPicture: {
        type: String,
      },

      shippingCharges: { type: Number, default: 0 }, // seller set করবে
      freeShippingThreshold: { type: Number, default: 0 }, // seller set করবে
      promoCodes: [
        {
          code: { type: String, trim: true },
          discount: { type: Number, default: 0 },
          expiresAt: Date,
          minOrderAmount: { type: Number, default: 0 },
          type: {
            type: String,
            enum: ["fixed", "percentage"], // শুধুমাত্র এই দুইটি value অনুমোদিত
            required: true,
            default: "fixed",
          },
        },
      ],
    },
    socialLogin: {
      googleId: {
        type: String,
        required: false,
      },
      facebookId: {
        type: String,
        required: false,
      },
      appleId: {
        type: String,
        required: false,
      },
    },
    provider: {
      type: String,
      enum: ["google", "facebook", "apple", "credentials"],
    },
    status: {
      type: String,
      default: "offline",
      enum: ["online", "offline"],
    },

    isAccountVerified: {
      type: Boolean,
      default: false,
    },
    // ----------------- New Preference / Settings Fields code start -----------------
    bio: {
      type: String,
      maxlength: 500,
      trim: true,
      default: "",
    },

    emailNotifications: {
      type: Boolean,
      default: true, // Default active
    },
    pushNotifications: {
      type: Boolean,
      default: true,
    },
    marketingEmails: {
      type: Boolean,
      default: false,
    },
    notificationFrequency: {
      type: String,
      enum: ["Immediate", "Daily Digest", "Weekly Summary", "None"],
      default: "Immediate",
    },
    language: {
      type: String,
      // enum: ["USD", "EUR", "GBP", "CAD"],
      default: "English",
    },
    currency: {
      type: String,
      default: "USD",
    },
    defaultAddress: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      zipCode: { type: String, trim: true },
    },
    // ----------------- New Preference / Settings Fields code end -----------------

    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    // Two-Factor Authentication code start
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorMethod: {
      type: String,
      enum: ["email", "phone", "authenticator"],
    },
    twoFactorSecret: String,
    twoFactorTempToken: String,
    twoFactorTempExpires: Date,
    // Two-Factor Authentication code end
  },
  { timestamps: true }
);

// 📍 Business location searching
userSchema.index({ "businessDetails.city": 1 });
userSchema.index({ "businessDetails.state": 1 });
userSchema.index({ "businessDetails.postalCode": 1 });
userSchema.index({ "businessDetails.country": 1 });

// 👨‍🌾 Seller filtering
userSchema.index({ role: 1 });
// userSchema.index({ "sellerProfile.shopId": 1 });
userSchema.index({ "sellerProfile.shopName": "text" }); // search box e keyword diye খোঁজার জন্য

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  return next();
});
userSchema.pre("save", function (next) {
  if (!this.isModified("password") || this.isNew) return next();
  this.passwordChangedAt = Date.now() - 1000;
  return next();
});

userSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  // False means Not changed
  return false;
};

userSchema.methods.creatPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.passwordResetExpires = Date.now() + 30 * 60 * 1000;
  return resetToken;
};
// slug for shopname
userSchema.pre("save", async function (next) {
  if (this.role === "seller" && this.accountType === "business") {
    const shopNameToUse =
      this.sellerProfile?.shopName || this.businessDetails?.businessName;

    if (shopNameToUse) {
      let baseSlug = slugify(shopNameToUse, { lower: true, strict: true });
      let slug = baseSlug;
      let counter = 1;

      while (
        await mongoose.models.User.findOne({ "sellerProfile.shopSlug": slug })
      ) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      // set shopName (fallback)
      if (!this.sellerProfile) this.sellerProfile = {};
      if (!this.sellerProfile.shopName)
        this.sellerProfile.shopName = shopNameToUse;

      this.sellerProfile.shopSlug = slug;
    }
  }
  next();
});

export const User = mongoose.model("User", userSchema);

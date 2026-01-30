import Stripe from "stripe";
import { User } from "../../models/users.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Add this function to check KYC status before allowing Stripe operations
export const checkKYCStatus = catchAsync(async (req, res, next) => {
  const seller = await User.findById(req.user._id);
  
  if (seller.sellerProfile?.kycStatus !== 'approved') {
    return next(
      new AppError(
        'KYC verification required before accessing payment features. Please complete your KYC verification.',
        403
      )
    );
  }
  
  next();
});

// Helper function to convert country name to ISO code
const getCountryCode = (country) => {
  if (!country) return "US";
  
  // If already a 2-letter code, return as is
  if (typeof country === "string" && country.length === 2) {
    return country.toUpperCase();
  }

  // Country name to ISO code mapping
  const countryMap = {
    canada: "CA",
    "united states": "US",
    usa: "US",
    "united kingdom": "GB",
    uk: "GB",
    australia: "AU",
    germany: "DE",
    france: "FR",
    italy: "IT",
    spain: "ES",
    japan: "JP",
    china: "CN",
    india: "IN",
    brazil: "BR",
    mexico: "MX",
    netherlands: "NL",
    belgium: "BE",
    switzerland: "CH",
    sweden: "SE",
    norway: "NO",
    denmark: "DK",
    poland: "PL",
    portugal: "PT",
    greece: "GR",
    ireland: "IE",
    "new zealand": "NZ",
    singapore: "SG",
    "south korea": "KR",
    taiwan: "TW",
    "hong kong": "HK",
    "south africa": "ZA",
    egypt: "EG",
    uae: "AE",
    "saudi arabia": "SA",
  };

  const normalizedCountry = country.toLowerCase().trim();
  return countryMap[normalizedCountry] || "US";
};

// ✅ Create Stripe Express Account for Seller
export const createStripeAccount = catchAsync(async (req, res, next) => {
  if (req.user.role !== "seller") {
    return next(new AppError("Only sellers can create Stripe accounts", 403));
  }

  const seller = await User.findById(req.user._id);
  if (!seller) {
    return next(new AppError("Seller not found", 404));
  }

  // Check if account already exists
  if (seller.sellerProfile?.stripeAccountId) {
    return res.status(200).json({
      status: "success",
      message: "Stripe account already exists",
      accountId: seller.sellerProfile.stripeAccountId,
      accountStatus: seller.sellerProfile.stripeAccountStatus,
    });
  }

  try {
    // First, verify that Connect is enabled by trying to list accounts
    // This will fail if Connect is not enabled
    try {
      await stripe.accounts.list({ limit: 1 });
    } catch (connectError) {
      if (connectError.message && connectError.message.includes("signed up for Connect")) {
        return next(
          new AppError(
            "Stripe Connect is not enabled. Please enable it in Stripe Dashboard: https://dashboard.stripe.com/settings/connect (or /test/settings/connect for test mode). Then restart the server.",
            400
          )
        );
      }
      // If it's a different error, continue with account creation
    }

    // Get country code from user's location
    // Priority: countryCode > businessDetails.country > default US
    const countrySource = 
      seller.countryCode || 
      seller.businessDetails?.country || 
      "US";
    
    const countryCode = getCountryCode(countrySource);

    // Create Express account
    const account = await stripe.accounts.create({
      type: "express",
      country: countryCode,
      email: seller.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        sellerId: seller._id,
        sellerEmail: seller.email,
      },
    });

    // Save account ID to seller profile
    seller.sellerProfile = seller.sellerProfile || {};
    seller.sellerProfile.stripeAccountId = account.id;
    seller.sellerProfile.stripeAccountStatus = "pending";
    seller.sellerProfile.stripeAccountType = "express";
    seller.sellerProfile.stripeOnboardingComplete = false;

    await seller.save();

    res.status(201).json({
      status: "success",
      message: "Stripe Express account created successfully",
      accountId: account.id,
      accountStatus: "pending",
    });
  } catch (error) {
    console.error("Stripe account creation error:", error);
    
    // Provide more helpful error message for Connect not enabled
    if (error.message && error.message.includes("signed up for Connect")) {
      return next(
        new AppError(
          "Stripe Connect is not enabled in your Stripe account. Please enable it in Stripe Dashboard: Settings → Connect → Enable Connect. Then restart the server and try again.",
          400
        )
      );
    }
    
    return next(
      new AppError(
        error.message || "Failed to create Stripe account",
        error.statusCode || 500
      )
    );
  }
});

// ✅ Get Onboarding Link for Seller
export const getOnboardingLink = catchAsync(async (req, res, next) => {
  if (req.user.role !== "seller") {
    return next(new AppError("Only sellers can access onboarding", 403));
  }

  const seller = await User.findById(req.user._id);
  if (!seller) {
    return next(new AppError("Seller not found", 404));
  }

  const accountId = seller.sellerProfile?.stripeAccountId;
  if (!accountId) {
    return next(
      new AppError(
        "Stripe account not found. Please create an account first.",
        404
      )
    );
  }

  try {
    // Get frontend URL for return
    const frontendUrl =
      process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_FRONTEND_URL || "http://localhost:3000";

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${frontendUrl}/vendor/dashboard?stripe_refresh=true`,
      return_url: `${frontendUrl}/vendor/dashboard?stripe_return=true`,
      type: "account_onboarding",
    });

    res.status(200).json({
      status: "success",
      url: accountLink.url,
      expiresAt: accountLink.expires_at,
    });
  } catch (error) {
    console.error("Onboarding link creation error:", error);
    return next(
      new AppError(
        error.message || "Failed to create onboarding link",
        error.statusCode || 500
      )
    );
  }
});

// ✅ Get Account Status
export const getAccountStatus = catchAsync(async (req, res, next) => {
  if (req.user.role !== "seller") {
    return next(new AppError("Only sellers can check account status", 403));
  }

  const seller = await User.findById(req.user._id);
  if (!seller) {
    return next(new AppError("Seller not found", 404));
  }

  const accountId = seller.sellerProfile?.stripeAccountId;
  if (!accountId) {
    return res.status(200).json({
      status: "success",
      hasAccount: false,
      accountStatus: null,
      message: "No Stripe account connected",
    });
  }

  try {
    // Fetch account details from Stripe
    const account = await stripe.accounts.retrieve(accountId);

    // Update local status if changed
    const stripeStatus = account.details_submitted
      ? account.charges_enabled && account.payouts_enabled
        ? "active"
        : "pending"
      : "pending";

    if (seller.sellerProfile.stripeAccountStatus !== stripeStatus) {
      seller.sellerProfile.stripeAccountStatus = stripeStatus;
      seller.sellerProfile.stripeOnboardingComplete = account.details_submitted;
      await seller.save();
    }

    res.status(200).json({
      status: "success",
      hasAccount: true,
      accountId: accountId,
      accountStatus: stripeStatus,
      onboardingComplete: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    });
  } catch (error) {
    console.error("Account status check error:", error);
    return next(
      new AppError(
        error.message || "Failed to check account status",
        error.statusCode || 500
      )
    );
  }
});

// ✅ Get Dashboard Link (Stripe Express Dashboard)
export const getDashboardLink = catchAsync(async (req, res, next) => {
  if (req.user.role !== "seller") {
    return next(new AppError("Only sellers can access dashboard", 403));
  }

  const seller = await User.findById(req.user._id);
  if (!seller) {
    return next(new AppError("Seller not found", 404));
  }

  const accountId = seller.sellerProfile?.stripeAccountId;
  if (!accountId) {
    return next(
      new AppError(
        "Stripe account not found. Please create and complete onboarding first.",
        404
      )
    );
  }

  try {
    // Create login link for Express Dashboard
    const loginLink = await stripe.accounts.createLoginLink(accountId);

    res.status(200).json({
      status: "success",
      url: loginLink.url,
      expiresAt: loginLink.expires_at,
    });
  } catch (error) {
    console.error("Dashboard link creation error:", error);
    return next(
      new AppError(
        error.message || "Failed to create dashboard link",
        error.statusCode || 500
      )
    );
  }
});

// ✅ Update Account Status (called from webhook)
export const updateAccountStatus = async (accountId, accountData) => {
  try {
    const seller = await User.findOne({
      "sellerProfile.stripeAccountId": accountId,
    });

    if (!seller) {
      console.error(`Seller not found for account: ${accountId}`);
      return;
    }

    const isActive =
      accountData.charges_enabled && accountData.payouts_enabled;
    const status = isActive ? "active" : "pending";

    seller.sellerProfile.stripeAccountStatus = status;
    seller.sellerProfile.stripeOnboardingComplete =
      accountData.details_submitted || false;

    await seller.save();
    console.log(`Updated account status for seller ${seller._id}: ${status}`);
  } catch (error) {
    console.error("Error updating account status:", error);
  }
};


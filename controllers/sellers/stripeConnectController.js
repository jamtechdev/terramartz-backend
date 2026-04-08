import Stripe from "stripe";
import { User } from "../../models/users.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/** Stripe "restricted" for UX: disabled account or overdue requirements — not mere currently_due. */
function computeIsRestricted(account) {
  if (account.requirements?.disabled_reason) return true;
  if (
    account.details_submitted &&
    Array.isArray(account.requirements?.past_due) &&
    account.requirements.past_due.length > 0
  ) {
    return true;
  }
  return false;
}

async function sendRemediationEmail(email, firstName, remediationUrl) {
  if (!email || !remediationUrl) return;
  const token = process.env.MAILTRAP_API_TOKEN?.trim();
  if (!token) {
    console.warn(
      "[Stripe remediation] MAILTRAP_API_TOKEN not set; skipping remediation email",
    );
    return;
  }
  const nodemailer = (await import("nodemailer")).default;
  const { MailtrapTransport } = await import("mailtrap");
  const transport = nodemailer.createTransport(MailtrapTransport({ token }));
  const name = firstName || "Seller";
  await transport.sendMail({
    from: { address: "hello@demomailtrap.co", name: "Terramartz" },
    to: email,
    subject: "Action required: complete your Stripe account",
    text: `Hi ${name},\n\nStripe needs more information before you can receive payouts. Open this link to continue:\n${remediationUrl}\n`,
    html: `<p>Hi ${name},</p><p>Stripe needs more information before you can receive payouts.</p><p><a href="${remediationUrl}">Complete verification</a></p>`,
  });
}

// Add this function to check KYC status before allowing Stripe operations
export const checkKYCStatus = catchAsync(async (req, res, next) => {
  const seller = await User.findById(req.user._id || req.user.id);
  if (!seller) {
    return next(new AppError("Seller not found", 404));
  }

  if (seller.sellerProfile?.kycStatus !== "approved") {
    return next(
      new AppError(
        "KYC verification required before accessing payment features. Please complete your KYC verification.",
        403,
      ),
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

  const seller = await User.findById(req.user._id || req.user.id);
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
      if (
        connectError.message &&
        connectError.message.includes("signed up for Connect")
      ) {
        return next(
          new AppError(
            "Stripe Connect is not enabled. Please enable it in Stripe Dashboard: https://dashboard.stripe.com/settings/connect (or /test/settings/connect for test mode). Then restart the server.",
            400,
          ),
        );
      }
      // If it's a different error, continue with account creation
    }

    // Get country code from user's location
    // Priority: countryCode > businessDetails.country > default US
    const countrySource =
      seller.countryCode || seller.businessDetails?.country || "US";

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
          400,
        ),
      );
    }

    return next(
      new AppError(
        error.message || "Failed to create Stripe account",
        error.statusCode || 500,
      ),
    );
  }
});

// ✅ Get Onboarding Link for Seller
export const getOnboardingLink = catchAsync(async (req, res, next) => {
  if (req.user.role !== "seller") {
    return next(new AppError("Only sellers can access onboarding", 403));
  }

  const seller = await User.findById(req.user._id || req.user.id);
  if (!seller) {
    return next(new AppError("Seller not found", 404));
  }

  const accountId = seller.sellerProfile?.stripeAccountId;
  if (!accountId) {
    return next(
      new AppError(
        "Stripe account not found. Please create an account first.",
        404,
      ),
    );
  }

  try {
    // Get frontend URL for return
    const frontendUrl =
      process.env.FRONTEND_URL ||
      process.env.NEXT_PUBLIC_FRONTEND_URL ||
      "http://localhost:3000";

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
        error.statusCode || 500,
      ),
    );
  }
});

// ✅ Get Account Status
export const getAccountStatus = catchAsync(async (req, res, next) => {
  if (req.user.role !== "seller") {
    return next(new AppError("Only sellers can check account status", 403));
  }

  const seller = await User.findById(req.user._id || req.user.id);
  if (!seller) return next(new AppError("Seller not found", 404));

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
    const account = await stripe.accounts.retrieve(accountId);

    const isRestricted = computeIsRestricted(account);

    let stripeStatus;
    if (isRestricted) {
      stripeStatus = "restricted";
    } else if (account.charges_enabled && account.payouts_enabled) {
      stripeStatus = "active";
    } else if (account.details_submitted) {
      stripeStatus = "submitted";
    } else {
      stripeStatus = "pending";
    }

    const onboardingComplete = Boolean(account.details_submitted);
    const previousStatus = seller.sellerProfile.stripeAccountStatus;
    const previousOnboarding = seller.sellerProfile.stripeOnboardingComplete;

    const needsSave =
      previousStatus !== stripeStatus ||
      previousOnboarding !== onboardingComplete;

    if (needsSave) {
      seller.sellerProfile.stripeAccountStatus = stripeStatus;
      seller.sellerProfile.stripeOnboardingComplete = onboardingComplete;
      await seller.save();

      if (
        stripeStatus === "restricted" &&
        previousStatus !== "restricted"
      ) {
        try {
          const frontendUrl =
            process.env.FRONTEND_URL ||
            process.env.NEXT_PUBLIC_FRONTEND_URL ||
            "http://localhost:3000";
          const accountLink = await stripe.accountLinks.create({
            account: accountId,
            refresh_url: `${frontendUrl}/vendor/dashboard?stripe_refresh=true`,
            return_url: `${frontendUrl}/vendor/dashboard?stripe_return=true`,
            type: "account_onboarding",
          });
          seller.sellerProfile.stripeRemediationLink = accountLink.url;
          seller.sellerProfile.stripeRemediationLinkExpiry = new Date(
            accountLink.expires_at * 1000,
          );
          await seller.save();
        } catch (linkErr) {
          console.error("Failed to generate remediation link:", linkErr);
        }
      }
    }

    return res.status(200).json({
      status: "success",
      hasAccount: true,
      accountId,
      accountStatus: stripeStatus,
      onboardingComplete: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      // ✅ Send requirements info so frontend can show what's needed
      requirements: isRestricted
        ? {
            disabledReason: account.requirements?.disabled_reason,
            pastDue: account.requirements?.past_due || [],
            currentlyDue: account.requirements?.currently_due || [],
          }
        : null,
    });
  } catch (error) {
    console.error("Account status check error:", error);
    return next(
      new AppError(error.message || "Failed to check account status", 500),
    );
  }
});

// ✅ Get Dashboard Link (Stripe Express Dashboard)
export const getDashboardLink = catchAsync(async (req, res, next) => {
  if (req.user.role !== "seller") {
    return next(new AppError("Only sellers can access dashboard", 403));
  }

  const seller = await User.findById(req.user._id || req.user.id);
  if (!seller) {
    return next(new AppError("Seller not found", 404));
  }

  const accountId = seller.sellerProfile?.stripeAccountId;
  if (!accountId) {
    return next(
      new AppError(
        "Stripe account not found. Please create and complete onboarding first.",
        404,
      ),
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
        error.statusCode || 500,
      ),
    );
  }
});

export const updateAccountStatus = async (accountId, accountData) => {
  try {
    const seller = await User.findOne({
      "sellerProfile.stripeAccountId": accountId,
    });

    if (!seller) {
      console.error(`Seller not found for account: ${accountId}`);
      return;
    }

    const previousStatus = seller.sellerProfile.stripeAccountStatus;

    const isRestricted = computeIsRestricted(accountData);

    let status;

    if (isRestricted) {
      // Restricted takes priority even if charges_enabled is true
      status = "restricted";
    } else if (accountData.charges_enabled && accountData.payouts_enabled) {
      status = "active";
    } else if (accountData.details_submitted) {
      status = "submitted";
    } else {
      status = "pending";
    }

    seller.sellerProfile.stripeAccountStatus = status;
    seller.sellerProfile.stripeOnboardingComplete =
      accountData.details_submitted || false;
    await seller.save();

    console.log(
      `✅ Stripe status updated → seller ${seller._id}: ${previousStatus} → ${status}`,
    );
    console.log(`   charges_enabled: ${accountData.charges_enabled}`);
    console.log(`   payouts_enabled: ${accountData.payouts_enabled}`);
    console.log(
      `   disabled_reason: ${accountData.requirements?.disabled_reason}`,
    );
    console.log(
      `   past_due: ${JSON.stringify(accountData.requirements?.past_due)}`,
    );

    // Auto-send remediation link when account becomes restricted
    if (status === "restricted" && previousStatus !== "restricted") {
      await sendRemediationLinkToSeller(seller, accountId);
    }

    // Notify seller when account becomes active
    if (status === "active" && previousStatus !== "active") {
      await notifySellerAccountActive(seller);
    }
  } catch (error) {
    console.error("Error in updateAccountStatus:", error);
  }
};

// Helper: Generate remediation link and notify seller
const sendRemediationLinkToSeller = async (seller, accountId) => {
  try {
    const frontendUrl =
      process.env.FRONTEND_URL ||
      process.env.NEXT_PUBLIC_FRONTEND_URL ||
      "http://localhost:3000";

    // Generate account update link (this IS the remediation link)
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${frontendUrl}/vendor/dashboard?stripe_refresh=true`,
      return_url: `${frontendUrl}/vendor/dashboard?stripe_return=true`,
      type: "account_onboarding", // Stripe uses this for remediation too
    });

    // Save the link temporarily in seller profile (optional, links expire in 24h)
    seller.sellerProfile.stripeRemediationLink = accountLink.url;
    seller.sellerProfile.stripeRemediationLinkExpiry = new Date(
      accountLink.expires_at * 1000,
    );
    await seller.save();

    // 🔔 In-app notification
    try {
      const { Notification } =
        await import("../../models/common/notification.js");
      await Notification.create({
        user: String(seller._id),
        type: "stripe_action_required",
        title: "Action Required: Stripe Account Restricted",
        message:
          "Your Stripe account requires additional information. Please complete the verification to continue receiving payments.",
        metadata: {
          remediationLink: accountLink.url,
          expiresAt: accountLink.expires_at,
        },
      });
    } catch (notifErr) {
      console.error("Failed to create restriction notification:", notifErr);
    }

    // 📧 Send email (plug in your email service here)
    try {
      await sendRemediationEmail(
        seller.email,
        seller.firstName,
        accountLink.url,
      );
    } catch (emailErr) {
      console.error("Failed to send remediation email:", emailErr);
    }

    console.log(`✅ Remediation link sent to seller ${seller._id}`);
  } catch (err) {
    console.error("Failed to send remediation link:", err);
  }
};

const notifySellerAccountActive = async (seller) => {
  try {
    const { Notification } =
      await import("../../models/common/notification.js");
    await Notification.create({
      user: String(seller._id),
      type: "stripe_account_active",
      title: "Stripe Account Activated!",
      message:
        "Your Stripe account is now fully active. You can start receiving payments.",
    });
  } catch (err) {
    console.error("Failed to send activation notification:", err);
  }
};

export const getRemediationLink = catchAsync(async (req, res, next) => {
  if (req.user.role !== "seller") {
    return next(new AppError("Only sellers can access remediation", 403));
  }

  const seller = await User.findById(req.user._id || req.user.id);

  if (!seller?.sellerProfile?.stripeAccountId) {
    return next(new AppError("No Stripe account found", 404));
  }

  if (seller.sellerProfile.stripeAccountStatus !== "restricted") {
    return next(new AppError("Account is not restricted", 400));
  }

  const frontendUrl =
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_FRONTEND_URL ||
    "http://localhost:3000";

  // Always generate a fresh link (they expire, so don't rely on the saved one)
  const accountLink = await stripe.accountLinks.create({
    account: seller.sellerProfile.stripeAccountId,
    refresh_url: `${frontendUrl}/vendor/dashboard?stripe_refresh=true`,
    return_url: `${frontendUrl}/vendor/dashboard?stripe_return=true`,
    type: "account_onboarding",
  });

  res.status(200).json({
    status: "success",
    url: accountLink.url,
    expiresAt: accountLink.expires_at,
  });
});

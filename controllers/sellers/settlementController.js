import Stripe from "stripe";
import { SellerSettlement } from "../../models/seller/sellerSettlement.js";
import { User } from "../../models/users.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Process pending settlements.
 * This should be called by a cron job every Wednesday.
 */
export const processSettlements = catchAsync(async (req, res, next) => {
  const now = new Date();

  // Find all pending settlements that are due
  const pendingSettlements = await SellerSettlement.find({
    status: "pending",
    scheduledSettlementDate: { $lte: now },
    commissionAmount: { $gt: 0 }, // Only settle if there's money to send
  });

  if (pendingSettlements.length === 0) {
    return res.status(200).json({
      status: "success",
      message: "No pending settlements to process",
    });
  }

  // Group by seller
  const settlementsBySeller = pendingSettlements.reduce((acc, settlement) => {
    if (!acc[settlement.sellerId]) {
      acc[settlement.sellerId] = [];
    }
    acc[settlement.sellerId].push(settlement);
    return acc;
  }, {});

  const results = [];

  for (const sellerId in settlementsBySeller) {
    const sellerSettlements = settlementsBySeller[sellerId];
    const totalCommission = sellerSettlements.reduce(
      (sum, s) => sum + s.commissionAmount,
      0,
    );
    const roundedCommission = Math.round(totalCommission * 100) / 100;

    try {
      const seller = await User.findById(sellerId);
      if (!seller || !seller.sellerProfile?.stripeAccountId) {
        throw new Error(`Seller ${sellerId} has no Stripe account connected`);
      }

      console.log(
        `Processing settlement for seller ${sellerId}: $${roundedCommission}`,
      );

      // Create Stripe Transfer
      const transfer = await stripe.transfers.create({
        amount: Math.round(roundedCommission * 100), // convert to cents
        currency: "usd",
        destination: seller.sellerProfile.stripeAccountId,
        description: `Settlement for period ending ${now.toDateString()}`,
        metadata: {
          sellerId: sellerId,
          settlementCount: sellerSettlements.length,
        },
      });

      // Update all settlements as settled
      const settlementIds = sellerSettlements.map((s) => s._id);
      await SellerSettlement.updateMany(
        { _id: { $in: settlementIds } },
        {
          status: "settled",
          actualSettlementDate: now,
          stripeTransferId: transfer.id,
        },
      );

      results.push({
        sellerId,
        amount: roundedCommission,
        status: "success",
        transferId: transfer.id,
      });
    } catch (error) {
      console.error(
        `❌ Failed to settle for seller ${sellerId}:`,
        error.message,
      );
      results.push({
        sellerId,
        amount: roundedCommission,
        status: "failed",
        error: error.message,
      });
    }
  }

  res.status(200).json({
    status: "success",
    processedCount: results.length,
    results,
  });
});

/**
 * Helper endpoint to view pending settlements for a seller
 */
export const getPendingSettlements = catchAsync(async (req, res, next) => {
  const sellerId = req.user.id;

  const settlements = await SellerSettlement.find({
    sellerId,
    status: "pending",
  })
    .populate({
      path: "products.product",
      select: "title name price productImages slug",
    })
    .sort({ scheduledSettlementDate: 1 });

  res.status(200).json({
    status: "success",
    count: settlements.length,
    data: settlements,
  });
});

import cron from "node-cron";
import { SellerSettlement } from "../models/seller/sellerSettlement.js";
import { User } from "../models/users.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Process all pending settlements that are due.
 */
export const processSettlementsJob = async () => {
  try {
    const now = new Date();
    console.log(
      `⏰ [Cron] Starting settlement process at ${now.toISOString()}`,
    );

    // Find all pending settlements that are due
    const pendingSettlements = await SellerSettlement.find({
      status: "pending",
      scheduledSettlementDate: { $lte: now },
      commissionAmount: { $gt: 0 },
    });

    if (pendingSettlements.length === 0) {
      console.log("⏰ [Cron] No pending settlements to process today.");
      return;
    }

    console.log(
      `⏰ [Cron] Processing ${pendingSettlements.length} settlement records.`,
    );

    // Group by seller
    const settlementsBySeller = pendingSettlements.reduce((acc, settlement) => {
      if (!acc[settlement.sellerId]) {
        acc[settlement.sellerId] = [];
      }
      acc[settlement.sellerId].push(settlement);
      return acc;
    }, {});

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
          console.error(
            `⏰ [Cron] Failed for seller ${sellerId}: No connected Stripe account.`,
          );
          continue;
        }

        console.log(
          `⏰ [Cron] Transferring $${roundedCommission} to seller ${sellerId} (${seller.sellerProfile.stripeAccountId})`,
        );

        // Create Stripe Transfer
        const transfer = await stripe.transfers.create({
          amount: Math.round(roundedCommission * 100), // convert to cents
          currency: "usd",
          destination: seller.sellerProfile.stripeAccountId,
          description: `Automated settlement for period ending ${now.toDateString()}`,
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

        console.log(
          `⏰ [Cron] Successfully settled $${roundedCommission} for seller ${sellerId}. Transfer ID: ${transfer.id}`,
        );
      } catch (error) {
        console.error(
          `⏰ [Cron] ❌ Failed to settle for seller ${sellerId}:`,
          error.message,
        );
      }
    }

    console.log("⏰ [Cron] Settlement process completed.");
  } catch (err) {
    console.error("⏰ [Cron] ❌ Critical error in settlement job:", err);
  }
};

/**
 * Initialize cron job to run every Wednesday at 00:01 AM
 * Cron expression: '1 0 * * 3'
 */
export const startSettlementJob = () => {
  // Run every Wednesday at 00:01 AM
  const cronExpression = "1 0 * * 3";

  console.log("⏰ Settlement job scheduled: Every Wednesday at 00:01 AM");

  cron.schedule(cronExpression, async () => {
    console.log("⏰ [Cron] Wednesday settlement job triggered!");
    await processSettlementsJob();
  });
};

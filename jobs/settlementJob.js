import cron from "node-cron";
import { SellerSettlement } from "../models/seller/sellerSettlement.js";
import { User } from "../models/users.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const processSettlementsJob = async () => {
  try {
    const now = new Date();
    console.log(
      `⏰ [Cron] Starting settlement process at ${now.toISOString()}`,
    );

    // 1. Fetch ALL pending settlements (Positive AND Negative) that are due
    const pendingSettlements = await SellerSettlement.find({
      status: "pending",
      scheduledSettlementDate: { $lte: now },
    });

    if (pendingSettlements.length === 0) {
      console.log("⏰ [Cron] No pending settlements to process.");
      return;
    }

    // 2. Group by Seller
    const settlementsBySeller = pendingSettlements.reduce((acc, settlement) => {
      const sId = settlement.sellerId;
      if (!acc[sId]) acc[sId] = [];
      acc[sId].push(settlement);
      return acc;
    }, {});

    // 3. Process each seller
    for (const sellerId in settlementsBySeller) {
      const sellerSettlements = settlementsBySeller[sellerId];

      // Calculate Net Amount (Sales - Refunds)
      const totalCommission = sellerSettlements.reduce(
        (sum, s) => sum + s.commissionAmount,
        0,
      );

      const roundedCommission = Math.round(totalCommission * 100) / 100;
      console.log(
        `Processing Seller ${sellerId}: Net Amount $${roundedCommission}`,
      );

      // 4. Handle Negative or Zero Balance
      if (roundedCommission <= 0) {
        console.log(
          `⚠️ Seller ${sellerId} has negative/zero balance ($${roundedCommission}). Carrying over.`,
        );
        // Leave status as 'pending' so it gets calculated next week
        continue;
      }

      try {
        const seller = await User.findById(sellerId);

        if (!seller || !seller.sellerProfile?.stripeAccountId) {
          console.error(`❌ Seller ${sellerId} invalid or no Stripe account.`);
          continue;
        }

        console.log(
          `💸 Transferring $${roundedCommission} to ${seller.sellerProfile.stripeAccountId}`,
        );

        // 5. Create Stripe Transfer
        const transfer = await stripe.transfers.create({
          amount: Math.round(roundedCommission * 100),
          currency: "usd",
          destination: seller.sellerProfile.stripeAccountId,
          description: `Settlement for ${now.toDateString()}`,
          metadata: {
            sellerId: sellerId,
            settlementCount: sellerSettlements.length.toString(),
          },
        });

        // 6. Update DB only after successful transfer
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
          `✅ Successfully settled $${roundedCommission} for seller ${sellerId}`,
        );
      } catch (error) {
        if (error.code === "balance_insufficient") {
          console.error(
            `❌ Insufficient Platform funds to pay seller ${sellerId}. Will retry next cycle.`,
          );
        } else {
          console.error(
            `❌ Error settling for seller ${sellerId}:`,
            error.message,
          );
        }
      }
    }
  } catch (err) {
    console.error("⏰ [Cron] ❌ Critical error in settlement job:", err);
  }
};

export const startSettlementJob = () => {
  // Run every Wednesday at 00:01 AM
  const cronExpression = "1 0 * * 3";
  console.log("⏰ Settlement job scheduled: Every Wednesday at 00:01 AM");

  cron.schedule(cronExpression, async () => {
    await processSettlementsJob();
  });
};

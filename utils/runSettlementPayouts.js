import Stripe from "stripe";
import { SellerSettlement } from "../models/seller/sellerSettlement.js";
import { User } from "../models/users.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Finds pending settlements due as of `asOf`, groups by seller, Stripe-transfers net commission,
 * or closes rows with no payout (net ≤ 0) so they do not block future cron runs.
 *
 * @param {{ asOf?: Date, logger?: { log: Function, error: Function } }} opts
 * @returns {Promise<{ processedSellers: number, results: Array<{ sellerId: string, ok: boolean, amount?: number, transferId?: string, error?: string, closedWithoutTransfer?: boolean }> }>}
 */
export async function runDueSettlementPayouts(opts = {}) {
  const asOf = opts.asOf ?? new Date();
  const log = opts.logger?.log ?? console.log;
  const logError = opts.logger?.error ?? console.error;

  const pendingSettlements = await SellerSettlement.find({
    status: "pending",
    scheduledSettlementDate: { $lte: asOf },
  });

  if (pendingSettlements.length === 0) {
    log(`[Settlement] No pending settlements due as of ${asOf.toISOString()}`);
    return { processedSellers: 0, results: [] };
  }

  const settlementsBySeller = pendingSettlements.reduce((acc, settlement) => {
    const sId = settlement.sellerId;
    if (!acc[sId]) acc[sId] = [];
    acc[sId].push(settlement);
    return acc;
  }, {});

  const results = [];

  for (const sellerId of Object.keys(settlementsBySeller)) {
    const sellerSettlements = settlementsBySeller[sellerId];
    const settlementIds = sellerSettlements.map((s) => s._id);

    const totalCommission = sellerSettlements.reduce(
      (sum, s) => sum + (Number(s.commissionAmount) || 0),
      0,
    );
    const roundedCommission = Math.round(totalCommission * 100) / 100;

    if (roundedCommission <= 0) {
      log(
        `[Settlement] Seller ${sellerId}: net commission $${roundedCommission} — closing ${settlementIds.length} row(s) without Stripe transfer`,
      );
      await SellerSettlement.updateMany(
        { _id: { $in: settlementIds } },
        {
          status: "settled",
          actualSettlementDate: asOf,
        },
      );
      results.push({
        sellerId,
        ok: true,
        amount: 0,
        closedWithoutTransfer: true,
      });
      continue;
    }

    try {
      const seller = await User.findById(sellerId);
      if (!seller?.sellerProfile?.stripeAccountId) {
        throw new Error("Seller has no Stripe Connect account");
      }

      const transfer = await stripe.transfers.create({
        amount: Math.round(roundedCommission * 100),
        currency: "usd",
        destination: seller.sellerProfile.stripeAccountId,
        description: `Terramartz settlement ${asOf.toISOString().slice(0, 10)}`,
        metadata: {
          sellerId: String(sellerId),
          settlementCount: String(sellerSettlements.length),
        },
      });

      await SellerSettlement.updateMany(
        { _id: { $in: settlementIds } },
        {
          status: "settled",
          actualSettlementDate: asOf,
          stripeTransferId: transfer.id,
        },
      );

      log(
        `[Settlement] Seller ${sellerId}: transferred $${roundedCommission} (${transfer.id})`,
      );
      results.push({
        sellerId,
        ok: true,
        amount: roundedCommission,
        transferId: transfer.id,
      });
    } catch (error) {
      logError(
        `[Settlement] Seller ${sellerId} failed:`,
        error.message || error,
      );
      results.push({
        sellerId,
        ok: false,
        amount: roundedCommission,
        error: error.message || String(error),
      });
    }
  }

  return { processedSellers: results.length, results };
}

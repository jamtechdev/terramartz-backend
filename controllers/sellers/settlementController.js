import catchAsync from "../../utils/catchasync.js";
import { SellerSettlement } from "../../models/seller/sellerSettlement.js";
import { runDueSettlementPayouts } from "../../utils/runSettlementPayouts.js";

/**
 * Admin trigger — same logic as the Wednesday cron (`jobs/settlementJob.js`).
 */
export const processSettlements = catchAsync(async (req, res, next) => {
  const now = new Date();
  const { processedSellers, results } = await runDueSettlementPayouts({
    asOf: now,
    logger: console,
  });

  res.status(200).json({
    status: "success",
    processedCount: processedSellers,
    results,
  });
});

/**
 * Helper endpoint to view pending settlements for a seller
 */
export const getPendingSettlements = catchAsync(async (req, res, next) => {
  const sellerId = String(req.user._id || req.user.id);

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

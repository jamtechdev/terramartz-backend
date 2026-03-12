import { Purchase } from "../../models/customers/purchase.js";
import { KYC } from "../../models/seller/kyc.js";
import { ContactInquiry } from "../../models/common/contactInquiry.js";
import catchAsync from "../../utils/catchasync.js";

/**
 * @desc    Get counts of new/pending records for admin notifications
 * @route   GET /api/v1/admin/notifications/counts
 * @access  Private (Admin)
 */
export const getAdminNotificationCounts = catchAsync(async (req, res, next) => {
  // Define "current data" as records that require admin attention (pending/new)
  const [purchaseCount, kycCount, contactInquiryCount] = await Promise.all([
    // New orders that haven't been processed yet
    Purchase.countDocuments({ status: "new" }),

    // KYC applications that have been submitted and are awaiting review
    KYC.countDocuments({ status: "submitted" }),

    // Contact inquiries that are still pending
    ContactInquiry.countDocuments({ status: "pending" }),
  ]);

  res.status(200).json({
    status: "success",
    data: {
      purchaseCount,
      kycCount,
      contactInquiryCount,
      totalCount: purchaseCount + kycCount + contactInquiryCount,
    },
  });
});

import { KYC } from '../../models/seller/kyc.js';
import { User } from '../../models/users.js';
import { getDirectUrl } from '../../utils/awsS3.js';
import catchAsync from '../../utils/catchasync.js';
import AppError from '../../utils/apperror.js';

// Get all pending KYC applications
export const getPendingKYCApplications = catchAsync(async (req, res, next) => {
  const { status, page = 1, limit = 10 } = req.query;
  
  let filter = { status: status || 'submitted' };
  
  const kycApplications = await KYC.find(filter)
    .populate('sellerId', 'firstName lastName email businessDetails')
    .populate('reviewedBy', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  // Format documents with direct URLs
  const formattedApplications = kycApplications.map(app => {
    const appObject = app.toObject();
    return {
      ...appObject,
      documents: appObject.documents.map(doc => ({
        ...doc,
        documentUrl: getDirectUrl(doc.documentUrl)
      }))
    };
  });

  const total = await KYC.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    results: formattedApplications.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit),
    data: {
      applications: formattedApplications
    }
  });
});

// Review KYC application
export const reviewKYCApplication = catchAsync(async (req, res, next) => {
  const { kycId } = req.params;
  const { status, rejectionReason, verificationSteps } = req.body;
  const adminId = req.user._id;

  const kycRecord = await KYC.findById(kycId);
  if (!kycRecord) {
    return next(new AppError('KYC application not found', 404));
  }

  if (!['approved', 'rejected'].includes(status)) {
    return next(new AppError('Invalid status. Use "approved" or "rejected"', 400));
  }

  // Auto-verify all documents when approving
  if (status === 'approved') {
    // Automatically verify all documents
    const verificationTimestamp = new Date();
    kycRecord.documents = kycRecord.documents.map(doc => ({
      ...doc.toObject(),
      verified: true,
      verificationNotes: doc.verificationNotes || 'Automatically verified during approval',
      verifiedBy: adminId,
      verifiedAt: verificationTimestamp
    }));
    
    // Auto-populate verification steps based on what documents were actually submitted
    const documentTypes = kycRecord.documents.map(doc => doc.documentType);
    
    // For each verification category, check if relevant documents were submitted and verified
    const identityTypes = ['passport', 'national_id', 'driving_license'];
    const businessTypes = ['business_license', 'tax_certificate', 'registration_certificate']; 
    const financialTypes = ['bank_statement', 'financial_statement'];
    const addressTypes = ['utility_bill', 'rental_agreement'];
    
    const submittedIdentityDocs = documentTypes.filter(type => identityTypes.includes(type));
    const submittedBusinessDocs = documentTypes.filter(type => businessTypes.includes(type));
    const submittedFinancialDocs = documentTypes.filter(type => financialTypes.includes(type));
    const submittedAddressDocs = documentTypes.filter(type => addressTypes.includes(type));
    
    kycRecord.verificationSteps = {
      identityVerified: submittedIdentityDocs.length > 0,     // true if any identity docs submitted
      businessVerified: submittedBusinessDocs.length > 0,     // true if any business docs submitted  
      financialVerified: submittedFinancialDocs.length > 0,   // true if any financial docs submitted
      addressVerified: submittedAddressDocs.length > 0        // true if any address docs submitted
    };
  }

  // Update KYC record
  kycRecord.status = status;
  kycRecord.reviewedBy = adminId;
  
  if (status === 'approved') {
    kycRecord.approvedAt = new Date();
    kycRecord.rejectionReason = undefined;
  } else if (status === 'rejected') {
    kycRecord.rejectedAt = new Date();
    kycRecord.rejectionReason = rejectionReason || '';
    kycRecord.approvedAt = undefined;
    // Unverify all documents when rejecting
    kycRecord.documents = kycRecord.documents.map(doc => ({
      ...doc.toObject(),
      verified: false,
      verificationNotes: doc.verificationNotes || 'Unverified due to rejection',
      verifiedBy: adminId,
      verifiedAt: new Date()
    }));
  }

  if (verificationSteps) {
    kycRecord.verificationSteps = { ...kycRecord.verificationSteps, ...verificationSteps };
  }

  await kycRecord.save();

  // Update seller profile
  const seller = await User.findById(kycRecord.sellerId);
  if (seller) {
    seller.sellerProfile.kycStatus = status;
    await seller.save();
  }

  res.status(200).json({
    status: 'success',
    message: status === 'approved' 
      ? 'KYC application approved successfully. All documents automatically verified.' 
      : 'KYC application rejected. All documents unverified.',
    data: {
      kycId: kycRecord._id,
      status: kycRecord.status,
      sellerId: kycRecord.sellerId,
      verificationSteps: kycRecord.verificationSteps,
      documentsVerified: kycRecord.documents.map(doc => ({
        documentType: doc.documentType,
        verified: doc.verified,
        verifiedAt: doc.verifiedAt
      }))
    }
  });
});

// Verify all documents at once
export const verifyAllDocuments = catchAsync(async (req, res, next) => {
  const { kycId } = req.params;
  const { verified, notes } = req.body;
  const adminId = req.user._id;

  const kycRecord = await KYC.findById(kycId);
  if (!kycRecord) {
    return next(new AppError('KYC application not found', 404));
  }

  // Update all documents verification status
  const verificationTimestamp = new Date();
  kycRecord.documents = kycRecord.documents.map(doc => ({
    ...doc.toObject(),
    verified: verified,
    verificationNotes: notes || '',
    verifiedBy: adminId,
    verifiedAt: verificationTimestamp
  }));

  // Update verification steps based on document types
  const documentTypes = kycRecord.documents.map(doc => doc.documentType);
  
  kycRecord.verificationSteps = {
    identityVerified: documentTypes.some(type => ['passport', 'national_id', 'driving_license'].includes(type)),
    businessVerified: documentTypes.some(type => ['business_license', 'tax_certificate', 'registration_certificate'].includes(type)),
    financialVerified: documentTypes.some(type => ['bank_statement', 'financial_statement'].includes(type)),
    addressVerified: documentTypes.some(type => ['utility_bill', 'rental_agreement'].includes(type))
  };

  await kycRecord.save();

  // Format response with updated documents
  const formattedDocuments = kycRecord.documents.map(doc => ({
    ...doc,
    documentUrl: getDirectUrl(doc.documentUrl)
  }));

  res.status(200).json({
    status: 'success',
    message: `All documents ${verified ? 'verified' : 'unverified'} successfully`,
    data: {
      kycId: kycRecord._id,
      documents: formattedDocuments,
      verificationSteps: kycRecord.verificationSteps,
      verifiedAt: verificationTimestamp
    }
  });
});

// Get specific KYC application details
export const getKYCApplicationDetails = catchAsync(async (req, res, next) => {
  const { kycId } = req.params;
  
  const kycRecord = await KYC.findById(kycId)
    .populate('sellerId', 'firstName lastName email businessDetails sellerProfile')
    .populate('reviewedBy', 'firstName lastName email');
  
  if (!kycRecord) {
    return next(new AppError('KYC application not found', 404));
  }

  // Format documents with direct URLs
  const formattedDocuments = kycRecord.documents.map(doc => ({
    ...doc.toObject(),
    documentUrl: getDirectUrl(doc.documentUrl)
  }));

  res.status(200).json({
    status: 'success',
    data: {
      ...kycRecord.toObject(),
      documents: formattedDocuments
    }
  });
});

// Get KYC statistics
export const getKYCStats = catchAsync(async (req, res, next) => {
  const stats = await KYC.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const totalApplications = await KYC.countDocuments();

  const formattedStats = {
    total: totalApplications,
    pending: 0,
    submitted: 0,
    under_review: 0,
    approved: 0,
    rejected: 0
  };

  stats.forEach(stat => {
    formattedStats[stat._id] = stat.count;
  });

  res.status(200).json({
    status: 'success',
    data: formattedStats
  });
});
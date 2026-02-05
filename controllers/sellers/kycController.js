import { KYC } from '../../models/seller/kyc.js';
import { User } from '../../models/users.js';
import { uploadToS3, getDirectUrl } from '../../utils/awsS3.js';
import crypto from 'crypto';
import catchAsync from '../../utils/catchasync.js';
import AppError from '../../utils/apperror.js';

// Submit KYC documents
export const submitKYCDocuments = catchAsync(async (req, res, next) => {
  const sellerId = req.user._id;
  
  // Check if seller exists
  const seller = await User.findById(sellerId);
  if (!seller || seller.role !== 'seller') {
    return next(new AppError('Seller not found', 404));
  }

  // Process uploaded documents
  const { documentsTypes } = req.body;
  const uploadedDocs = [];

  // Validate that we have the required data
  if (!req.files || !req.files.documents) {
    return next(new AppError('No documents uploaded', 400));
  }

  if (!documentsTypes || !Array.isArray(documentsTypes)) {
    return next(new AppError('documentsTypes array is required', 400));
  }

  if (req.files.documents.length !== documentsTypes.length) {
    return next(new AppError(`Mismatch: ${req.files.documents.length} files uploaded but ${documentsTypes.length} document types provided`, 400));
  }

  for (let i = 0; i < req.files.documents.length; i++) {
    const file = req.files.documents[i];
    const docType = documentsTypes[i];
    
    if (!docType) {
      return next(new AppError(`Document type required for document ${i + 1}`, 400));
    }

    // Validate document type against allowed values
    const allowedTypes = [
      'passport', 'national_id', 'driving_license',
      'business_license', 'tax_certificate', 'registration_certificate',
      'bank_statement', 'financial_statement',
      'utility_bill', 'rental_agreement'
    ];

    if (!allowedTypes.includes(docType)) {
      return next(new AppError(`Invalid document type '${docType}' for document ${i + 1}. Allowed types: ${allowedTypes.join(', ')}`, 400));
    }

    const key = `kyc/${sellerId}/${Date.now()}-${crypto
      .randomBytes(8)
      .toString('hex')}.${getFileExtension(file.originalname)}`;
    
    await uploadToS3(file.buffer, key, file.mimetype);
    
    // Store complete URL instead of partial key
    const completeUrl = getDirectUrl(key);
    
    uploadedDocs.push({
      documentType: docType,
      documentUrl: completeUrl,
      fileName: file.originalname
    });
  }

  if (uploadedDocs.length === 0) {
    return next(new AppError('No documents uploaded', 400));
  }

  // Check if KYC record already exists
  let kycRecord = await KYC.findOne({ sellerId });
  
  if (kycRecord) {
    // Update existing record
    kycRecord.documents = [...kycRecord.documents, ...uploadedDocs];
    kycRecord.status = 'submitted';
    kycRecord.submittedAt = new Date();
  } else {
    // Create new KYC record
    kycRecord = await KYC.create({
      sellerId,
      documents: uploadedDocs,
      status: 'submitted',
      submittedAt: new Date()
    });
  }

  // Update seller profile
  seller.sellerProfile.kycStatus = 'submitted';
  seller.sellerProfile.kycId = kycRecord._id;
  await seller.save();

  res.status(200).json({
    status: 'success',
    data: {
      kycId: kycRecord._id,
      status: kycRecord.status,
      documents: kycRecord.documents.map(doc => ({
        ...doc.toObject(),
        documentUrl: getDirectUrl(doc.documentUrl)
      }))
    }
  });
});

// Get KYC status
export const getKYCStatus = catchAsync(async (req, res, next) => {
  const sellerId = req.user._id;
  
  const kycRecord = await KYC.findOne({ sellerId }).populate('reviewedBy');
  
  if (!kycRecord) {
    return res.status(200).json({
      status: 'success',
      data: {
        status: 'pending',
        documents: [],
        verificationSteps: {}
      }
    });
  }

  // Format documents with direct URLs
  const formattedDocuments = kycRecord.documents.map(doc => ({
    ...doc.toObject(),
    documentUrl: getDirectUrl(doc.documentUrl),
    verified: doc.verified
  }));

  res.status(200).json({
    status: 'success',
    data: {
      kycId: kycRecord._id,
      status: kycRecord.status,
      documents: formattedDocuments,
      verificationSteps: kycRecord.verificationSteps,
      submittedAt: kycRecord.submittedAt,
      approvedAt: kycRecord.approvedAt,
      rejectedAt: kycRecord.rejectedAt,
      rejectionReason: kycRecord.rejectionReason
    }
  });
});

// Upload single document
export const uploadKYCDocument = catchAsync(async (req, res, next) => {
  const { documentType } = req.body;
  const sellerId = req.user._id;
  
  if (!req.file) {
    return next(new AppError('No document uploaded', 400));
  }

  if (!documentType) {
    return next(new AppError('Document type is required', 400));
  }

  const kycRecord = await KYC.findOne({ sellerId });
  if (!kycRecord) {
    return next(new AppError('KYC record not found. Please submit initial documents first.', 404));
  }

  const key = `kyc/${sellerId}/${Date.now()}-${crypto
    .randomBytes(8)
    .toString('hex')}.${getFileExtension(req.file.originalname)}`;

  await uploadToS3(req.file.buffer, key, req.file.mimetype);
  
  // Store complete URL instead of partial key
  const completeUrl = getDirectUrl(key);

  kycRecord.documents.push({
    documentType,
    documentUrl: completeUrl,
    fileName: req.file.originalname
  });

  await kycRecord.save();

  res.status(200).json({
    status: 'success',
    data: {
      documentUrl: getDirectUrl(key)
    }
  });
});

// Helper function to get file extension
function getFileExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}
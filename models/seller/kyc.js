import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const kycDocumentSchema = new mongoose.Schema({
  documentType: {
    type: String,
    required: true,
    enum: [
      'passport', 'national_id', 'driving_license', // Identity documents
      'business_license', 'tax_certificate', 'registration_certificate', // Business docs
      'bank_statement', 'financial_statement', // Financial docs
      'utility_bill', 'rental_agreement' // Address proof
    ]
  },
  documentUrl: {
    type: String,
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  verificationNotes: {
    type: String,
    default: ""
  },
  verifiedBy: {
    type: String, // admin ID
    ref: 'User'
  },
  verifiedAt: {
    type: Date
  }
});

const kycSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4
  },
  sellerId: {
    type: String,
    ref: 'User',
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['pending', 'submitted', 'under_review', 'approved', 'rejected'],
    default: 'pending'
  },
  documents: [kycDocumentSchema],
  submittedAt: {
    type: Date
  },
  approvedAt: {
    type: Date
  },
  rejectedAt: {
    type: Date
  },
  rejectionReason: {
    type: String
  },
  reviewedBy: {
    type: String, // admin ID
    ref: 'User'
  },
  verificationSteps: {
    identityVerified: { type: Boolean, default: false },
    businessVerified: { type: Boolean, default: false },
    addressVerified: { type: Boolean, default: false },
    financialVerified: { type: Boolean, default: false }
  }
}, { timestamps: true });

export const KYC = mongoose.model('KYC', kycSchema);
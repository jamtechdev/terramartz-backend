import { ContactInquiry } from "../../models/common/contactInquiry.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import APIFeatures from "../../utils/apiFeatures.js";

// POST - Submit Contact Inquiry (Public - No Auth Required)
export const submitInquiry = catchAsync(async (req, res, next) => {
  const { fullName, email, phoneNumber, inquiryType, subject, message } =
    req.body;

  // Validation
  if (!fullName || !email || !inquiryType || !subject || !message) {
    return next(
      new AppError(
        "Please provide all required fields: fullName, email, inquiryType, subject, and message",
        400
      )
    );
  }

  // Create inquiry
  const inquiry = await ContactInquiry.create({
    fullName,
    email,
    phoneNumber: phoneNumber || undefined,
    inquiryType,
    subject,
    message,
    status: "pending",
  });

  res.status(201).json({
    status: "success",
    message: "Your inquiry has been submitted successfully. We'll get back to you soon!",
    data: {
      inquiry: {
        _id: inquiry._id,
        fullName: inquiry.fullName,
        email: inquiry.email,
        inquiryType: inquiry.inquiryType,
        subject: inquiry.subject,
        status: inquiry.status,
        createdAt: inquiry.createdAt,
      },
    },
  });
});

// GET - Get All Inquiries (Authenticated - Admin/Seller Only)
export const getAllInquiries = catchAsync(async (req, res, next) => {
  const features = new APIFeatures(ContactInquiry.find(), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const inquiries = await features.query;

  const total = await ContactInquiry.countDocuments(features.queryString);

  res.status(200).json({
    status: "success",
    results: inquiries.length,
    total,
    pagination: {
      page: req.query.page * 1 || 1,
      limit: req.query.limit * 1 || 10,
      totalPages: Math.ceil(total / (req.query.limit * 1 || 10)),
    },
    data: {
      inquiries,
    },
  });
});

// GET - Get Single Inquiry by ID (Authenticated)
export const getInquiryById = catchAsync(async (req, res, next) => {
  const inquiry = await ContactInquiry.findById(req.params.id);

  if (!inquiry) {
    return next(new AppError("Inquiry not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      inquiry,
    },
  });
});

// PATCH - Update Inquiry Status (Authenticated - Admin/Seller Only)
export const updateInquiryStatus = catchAsync(async (req, res, next) => {
  const { status, responseNotes } = req.body;

  if (!status) {
    return next(new AppError("Status is required", 400));
  }

  const inquiry = await ContactInquiry.findById(req.params.id);

  if (!inquiry) {
    return next(new AppError("Inquiry not found", 404));
  }

  inquiry.status = status;
  if (responseNotes) {
    inquiry.responseNotes = responseNotes;
  }
  if (status === "resolved" || status === "closed") {
    inquiry.respondedAt = new Date();
  }

  await inquiry.save();

  res.status(200).json({
    status: "success",
    message: "Inquiry status updated successfully",
    data: {
      inquiry,
    },
  });
});


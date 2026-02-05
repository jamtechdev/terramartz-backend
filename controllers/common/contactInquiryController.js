import { ContactInquiry } from "../../models/common/contactInquiry.js";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";
import APIFeatures from "../../utils/apiFeatures.js";
import { assignTicketToLeastLoadedAdmin, reassignTicket, getAssignmentStatistics } from "../../utils/ticketAssignment.js";

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
  const inquiryData = {
    fullName,
    email,
    phoneNumber: phoneNumber || undefined,
    inquiryType,
    subject,
    message,
    status: "pending",
  };

  // Auto-assign ticket to appropriate admin
  const assignedAdminId = await assignTicketToLeastLoadedAdmin(inquiryType);
  if (assignedAdminId) {
    inquiryData.assignedAdmin = assignedAdminId;
    inquiryData.assignedAt = new Date();
    inquiryData.assignmentHistory = [{
      assignedTo: assignedAdminId,
      assignedAt: new Date(),
      reason: "Automatic assignment based on inquiry type"
    }];
  }

  const inquiry = await ContactInquiry.create(inquiryData);

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

// GET - Get All Inquiries (Authenticated - Admin Only)
export const getAllInquiries = catchAsync(async (req, res, next) => {
  // Build query based on user role
  const queryConditions = {};
  
  // Super Admin can see all tickets
  if (req.user.role !== "Super Admin") {
    // Other admins can only see tickets assigned to them
    queryConditions.assignedAdmin = req.user._id;
  }
  
  // Apply additional filters from query params
  const features = new APIFeatures(ContactInquiry.find(queryConditions), req.query)
    .filter()
    .sort()
    .limitFields()
    .paginate();

  // Populate assigned admin details
  const inquiries = await features.query
    .populate('assignedAdmin', 'name email role');

  const total = await ContactInquiry.countDocuments({
    ...queryConditions,
    ...features.queryString
  });

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
      inquiries: inquiries.map(inquiry => ({
        _id: inquiry._id,
        fullName: inquiry.fullName,
        email: inquiry.email,
        phoneNumber: inquiry.phoneNumber,
        inquiryType: inquiry.inquiryType,
        subject: inquiry.subject,
        message: inquiry.message,
        status: inquiry.status,
        respondedAt: inquiry.respondedAt,
        responseNotes: inquiry.responseNotes,
        assignedAdmin: inquiry.assignedAdmin ? {
          _id: inquiry.assignedAdmin._id,
          name: inquiry.assignedAdmin.name,
          email: inquiry.assignedAdmin.email,
          role: inquiry.assignedAdmin.role
        } : null,
        assignedAt: inquiry.assignedAt,
        createdAt: inquiry.createdAt,
        updatedAt: inquiry.updatedAt
      })),
    },
  });
});

// GET - Get Single Inquiry by ID (Authenticated)
export const getInquiryById = catchAsync(async (req, res, next) => {
  const inquiry = await ContactInquiry.findById(req.params.id)
    .populate('assignedAdmin', 'name email role');

  if (!inquiry) {
    return next(new AppError("Inquiry not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      inquiry: {
        _id: inquiry._id,
        fullName: inquiry.fullName,
        email: inquiry.email,
        phoneNumber: inquiry.phoneNumber,
        inquiryType: inquiry.inquiryType,
        subject: inquiry.subject,
        message: inquiry.message,
        status: inquiry.status,
        respondedAt: inquiry.respondedAt,
        responseNotes: inquiry.responseNotes,
        assignedAdmin: inquiry.assignedAdmin ? {
          _id: inquiry.assignedAdmin._id,
          name: inquiry.assignedAdmin.name,
          email: inquiry.assignedAdmin.email,
          role: inquiry.assignedAdmin.role
        } : null,
        assignedAt: inquiry.assignedAt,
        createdAt: inquiry.createdAt,
        updatedAt: inquiry.updatedAt
      },
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

// GET - Get Tickets Assigned to Current Admin
export const getMyTickets = catchAsync(async (req, res, next) => {
  const features = new APIFeatures(
    ContactInquiry.find({ assignedAdmin: req.user._id }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  // Populate assigned admin details
  const tickets = await features.query
    .populate('assignedAdmin', 'name email role');

  const total = await ContactInquiry.countDocuments({
    assignedAdmin: req.user._id,
    ...features.queryString
  });

  res.status(200).json({
    status: "success",
    results: tickets.length,
    total,
    pagination: {
      page: req.query.page * 1 || 1,
      limit: req.query.limit * 1 || 10,
      totalPages: Math.ceil(total / (req.query.limit * 1 || 10)),
    },
    data: {
      tickets: tickets.map(ticket => ({
        _id: ticket._id,
        fullName: ticket.fullName,
        email: ticket.email,
        phoneNumber: ticket.phoneNumber,
        inquiryType: ticket.inquiryType,
        subject: ticket.subject,
        message: ticket.message,
        status: ticket.status,
        respondedAt: ticket.respondedAt,
        responseNotes: ticket.responseNotes,
        assignedAdmin: ticket.assignedAdmin ? {
          _id: ticket.assignedAdmin._id,
          name: ticket.assignedAdmin.name,
          email: ticket.assignedAdmin.email,
          role: ticket.assignedAdmin.role
        } : null,
        assignedAt: ticket.assignedAt,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt
      })),
    },
  });
});

// PATCH - Manually Reassign Ticket (Super Admin Only)
export const reassignTicketController = catchAsync(async (req, res, next) => {
  const { newAdminId } = req.body;
  
  // Only Super Admins can reassign tickets
  if (req.user.role !== "Super Admin") {
    return next(
      new AppError("Only Super Admins can reassign tickets", 403)
    );
  }

  // If newAdminId is null or explicitly set to null, unassign the ticket
  if (newAdminId === null || newAdminId === undefined || newAdminId === '') {
    // Unassign the ticket
    const updatedTicket = await ContactInquiry.findByIdAndUpdate(
      req.params.id,
      {
        assignedAdmin: null,
        assignedAt: null,
        $push: {
          assignmentHistory: {
            assignedBy: req.user._id,
            assignedTo: null,
            assignedAt: new Date(),
            reason: "Unassigned by admin"
          }
        }
      },
      { new: true }
    ).populate('assignedAdmin', 'name email role');

    res.status(200).json({
      status: "success",
      message: "Ticket unassigned successfully",
      data: {
        ticket: updatedTicket,
      },
    });
  } else {
    // Reassign to new admin
    if (!newAdminId) {
      return next(new AppError("New admin ID is required", 400));
    }

    const success = await reassignTicket(req.params.id, newAdminId, req.user);
    
    if (!success) {
      return next(new AppError("Failed to reassign ticket", 500));
    }

    const updatedTicket = await ContactInquiry.findById(req.params.id)
      .populate('assignedAdmin', 'name email role');

    res.status(200).json({
      status: "success",
      message: "Ticket reassigned successfully",
      data: {
        ticket: updatedTicket,
      },
    });
  }
});

// GET - Get Assignment Statistics
export const getTicketStats = catchAsync(async (req, res, next) => {
  // Super Admins can get overall stats, others get their own stats
  const adminId = req.user.role === "Super Admin" ? null : req.user._id;
  
  const stats = await getAssignmentStatistics(adminId);

  res.status(200).json({
    status: "success",
    data: {
      statistics: stats,
    },
  });
});


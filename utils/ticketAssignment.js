import { Admin } from "../models/super-admin/admin.js";
import { ContactInquiry } from "../models/common/contactInquiry.js";

// Inquiry type to admin role mapping
export const INQUIRY_TYPE_ROLE_MAPPING = {
  "General Inquiry": ["Support", "Ops"],
  "Product Question": ["Support", "Ops"],
  "Order Support": ["Ops", "Logistics"],
  "Partnership": ["Super Admin", "Ops"],
  "Complaint": ["Support", "Super Admin"],
  "Feedback": ["Support"],
  "Other": ["Support"]
};

/**
 * Get qualified admin roles for a given inquiry type
 * @param {string} inquiryType - The type of inquiry
 * @returns {Array<string>} Array of qualified admin roles
 */
export const getQualifiedRolesForInquiry = (inquiryType) => {
  return INQUIRY_TYPE_ROLE_MAPPING[inquiryType] || ["Support"];
};

/**
 * Find available admins with specified roles
 * @param {Array<string>} roles - Array of admin roles to search for
 * @returns {Promise<Array>} Array of admin documents
 */
export const findAvailableAdminsWithRoles = async (roles) => {
  return await Admin.find({
    role: { $in: roles },
    isActive: true
  }).select("_id role name email");
};

/**
 * Get ticket assignment statistics for admins
 * @param {Array<string>} adminIds - Array of admin IDs
 * @returns {Promise<Object>} Statistics object with assignment counts
 */
export const getAdminAssignmentStats = async (adminIds) => {
  const stats = await ContactInquiry.aggregate([
    {
      $match: {
        assignedAdmin: { $in: adminIds },
        status: { $ne: "closed" }
      }
    },
    {
      $group: {
        _id: "$assignedAdmin",
        ticketCount: { $sum: 1 }
      }
    }
  ]);

  const statsMap = {};
  stats.forEach(stat => {
    statsMap[stat._id] = stat.ticketCount;
  });

  return statsMap;
};

/**
 * Assign ticket to the least loaded qualified admin
 * @param {string} inquiryType - The type of inquiry
 * @returns {Promise<string|null>} Assigned admin ID or null if no admins available
 */
export const assignTicketToLeastLoadedAdmin = async (inquiryType) => {
  try {
    // Get qualified roles for this inquiry type
    const qualifiedRoles = getQualifiedRolesForInquiry(inquiryType);
    
    // Find available admins with qualified roles
    const availableAdmins = await findAvailableAdminsWithRoles(qualifiedRoles);
    
    if (availableAdmins.length === 0) {
      console.warn(`No available admins found for inquiry type: ${inquiryType}`);
      return null;
    }

    // Get current assignment statistics
    const adminIds = availableAdmins.map(admin => admin._id);
    const assignmentStats = await getAdminAssignmentStats(adminIds);
    
    // Find admin with minimum assigned tickets
    let leastLoadedAdmin = availableAdmins[0];
    let minTicketCount = assignmentStats[leastLoadedAdmin._id] || 0;
    
    for (const admin of availableAdmins) {
      const ticketCount = assignmentStats[admin._id] || 0;
      if (ticketCount < minTicketCount) {
        minTicketCount = ticketCount;
        leastLoadedAdmin = admin;
      }
    }
    
    return leastLoadedAdmin._id;
  } catch (error) {
    console.error("Error assigning ticket to admin:", error);
    return null;
  }
};

/**
 * Reassign ticket to a different admin
 * @param {string} ticketId - The ticket ID
 * @param {string} newAdminId - The new admin ID to assign to
 * @param {Object} currentUser - The current user performing the reassignment
 * @returns {Promise<boolean>} Success status
 */
export const reassignTicket = async (ticketId, newAdminId, currentUser) => {
  try {
    // Verify new admin exists and is active
    const newAdmin = await Admin.findOne({ 
      _id: newAdminId, 
      isActive: true 
    });
    
    if (!newAdmin) {
      throw new Error("Admin not found or inactive");
    }
    
    // Update ticket assignment
    const result = await ContactInquiry.findByIdAndUpdate(
      ticketId,
      {
        assignedAdmin: newAdminId,
        assignedAt: new Date(),
        $push: {
          assignmentHistory: {
            assignedBy: currentUser._id,
            assignedTo: newAdminId,
            assignedAt: new Date(),
            reason: "Manual reassignment"
          }
        }
      },
      { new: true }
    );
    
    return !!result;
  } catch (error) {
    console.error("Error reassigning ticket:", error);
    throw error;
  }
};

/**
 * Get assignment statistics for dashboard
 * @param {string} adminId - Admin ID to get stats for (optional)
 * @returns {Promise<Object>} Assignment statistics
 */
export const getAssignmentStatistics = async (adminId = null) => {
  const matchCondition = adminId 
    ? { assignedAdmin: adminId }
    : {};
  
  const stats = await ContactInquiry.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 }
      }
    }
  ]);
  
  const statsObj = {};
  stats.forEach(item => {
    statsObj[item._id] = item.count;
  });
  
  return statsObj;
};
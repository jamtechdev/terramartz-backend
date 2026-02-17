import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import catchAsync from "../../utils/catchasync.js";
import AppError from "../../utils/apperror.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.join(__dirname, "../../logs/admin");

/**
 * Parse log line into structured object
 */
const parseLogLine = (line) => {
  // Remove any carriage return or whitespace
  const cleanLine = line.trim();
  if (!cleanLine) return null;

  try {
    // Log format: "2026-02-16 16:00:44 [info]: {JSON}"
    // Split by " [info]: " or similar pattern
    const logLevelMatch = cleanLine.match(/^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})\s\[(\w+)\]:\s(.+)$/);
    
    if (!logLevelMatch) {
      // Try alternative parsing method
      const parts = cleanLine.split(/\s\[\w+\]:\s/);
      if (parts.length >= 2) {
        const timestamp = parts[0];
        const jsonStr = parts[1];
        const levelMatch = cleanLine.match(/\[(\w+)\]/);
        const level = levelMatch ? levelMatch[1] : 'info';
        
        const logData = JSON.parse(jsonStr);
        return {
          timestamp,
          level,
          ...logData,
        };
      }
      return null;
    }

    const [, timestamp, level, jsonStr] = logLevelMatch;
    const logData = JSON.parse(jsonStr);

    return {
      timestamp,
      level,
      ...logData,
    };
  } catch (error) {
    return null;
  }
};

/**
 * Read logs from a specific file
 */
const readLogFile = async (filePath) => {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      // Split by \n and handle potential \r
      const lines = data.split(/\r?\n/);
      const parsedLogs = lines
        .map(parseLogLine)
        .filter((log) => log !== null);

      resolve(parsedLogs);
    });
  });
};

/**
 * Get available log files in date range
 */
const getLogFilesInRange = (startDate, endDate) => {
  const files = fs.readdirSync(LOGS_DIR);
  const logFiles = files.filter((file) => file.startsWith("admin-") && file.endsWith(".log"));

  if (!startDate && !endDate) {
    return logFiles;
  }

  return logFiles.filter((file) => {
    const dateMatch = file.match(/admin-(\d{4}-\d{2}-\d{2})\.log/);
    if (!dateMatch) return false;

    const fileDate = new Date(dateMatch[1]);
    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();

    // Set time to start/end of day for comparison
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    fileDate.setHours(0, 0, 0, 0);

    return fileDate >= start && fileDate <= end;
  });
};

/**
 * GET /api/admin/logs
 * Get all admin logs with optional date range filter
 * Query params:
 *   - startDate: Start date (YYYY-MM-DD)
 *   - endDate: End date (YYYY-MM-DD)
 *   - page: Page number (default: 1)
 *   - limit: Items per page (default: 50)
 *   - method: Filter by HTTP method (GET, POST, etc.)
 *   - status: Filter by HTTP status code
 *   - adminEmail: Filter by admin email
 */
export const getAllLogs = catchAsync(async (req, res, next) => {
  const {
    startDate,
    endDate,
    page = 1,
    limit = 50,
    method,
    status,
    adminEmail,
  } = req.query;

  const pageNum = Number(page);
  const limitNum = Number(limit);

  // Validate date range
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start > end) {
      return next(new AppError("Start date must be before end date", 400));
    }
  }

  // Get log files in date range
  const logFiles = getLogFilesInRange(startDate, endDate);

  if (logFiles.length === 0) {
    return res.status(200).json({
      status: "success",
      page: pageNum,
      limit: limitNum,
      total: 0,
      results: 0,
      logs: [],
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
    });
  }

  // Read all log files
  const allLogsPromises = logFiles.map((file) =>
    readLogFile(path.join(LOGS_DIR, file))
  );

  const allLogsArrays = await Promise.all(allLogsPromises);
  let allLogs = allLogsArrays.flat();

  // Apply filters
  if (method) {
    allLogs = allLogs.filter(
      (log) => log.method && log.method.toLowerCase() === method.toLowerCase()
    );
  }

  if (status) {
    allLogs = allLogs.filter((log) => log.status && log.status === Number(status));
  }

  if (adminEmail) {
    allLogs = allLogs.filter(
      (log) => log.adminEmail && log.adminEmail.toLowerCase().includes(adminEmail.toLowerCase())
    );
  }

  // Sort by timestamp (newest first)
  allLogs.sort((a, b) => new Date(b.time || b.timestamp) - new Date(a.time || a.timestamp));

  // Pagination
  const total = allLogs.length;
  const skip = (pageNum - 1) * limitNum;
  const paginatedLogs = allLogs.slice(skip, skip + limitNum);

  res.status(200).json({
    status: "success",
    page: pageNum,
    limit: limitNum,
    total,
    results: paginatedLogs.length,
    logs: paginatedLogs,
    dateRange: {
      startDate: startDate || null,
      endDate: endDate || null,
    },
    filters: {
      method: method || null,
      status: status || null,
      adminEmail: adminEmail || null,
    },
  });
});

/**
 * GET /api/admin/logs/:date
 * Get logs for a specific date
 * Params:
 *   - date: Date in YYYY-MM-DD format
 * Query params:
 *   - page: Page number (default: 1)
 *   - limit: Items per page (default: 50)
 *   - method: Filter by HTTP method
 *   - status: Filter by HTTP status code
 *   - adminEmail: Filter by admin email
 */
export const getLogsByDate = catchAsync(async (req, res, next) => {
  const { date } = req.params;
  const { page = 1, limit = 50, method, status, adminEmail } = req.query;

  const pageNum = Number(page);
  const limitNum = Number(limit);

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return next(new AppError("Invalid date format. Use YYYY-MM-DD", 400));
  }

  // Check if log file exists for this date
  const logFileName = `admin-${date}.log`;
  const logFilePath = path.join(LOGS_DIR, logFileName);

  if (!fs.existsSync(logFilePath)) {
    return res.status(200).json({
      status: "success",
      page: pageNum,
      limit: limitNum,
      total: 0,
      results: 0,
      logs: [],
      date,
      message: `No logs found for ${date}`,
    });
  }

  // Read log file
  let logs = await readLogFile(logFilePath);

  // Apply filters
  if (method) {
    logs = logs.filter(
      (log) => log.method && log.method.toLowerCase() === method.toLowerCase()
    );
  }

  if (status) {
    logs = logs.filter((log) => log.status && log.status === Number(status));
  }

  if (adminEmail) {
    logs = logs.filter(
      (log) => log.adminEmail && log.adminEmail.toLowerCase().includes(adminEmail.toLowerCase())
    );
  }

  // Sort by timestamp (newest first)
  logs.sort((a, b) => new Date(b.time || b.timestamp) - new Date(a.time || a.timestamp));

  // Pagination
  const total = logs.length;
  const skip = (pageNum - 1) * limitNum;
  const paginatedLogs = logs.slice(skip, skip + limitNum);

  res.status(200).json({
    status: "success",
    page: pageNum,
    limit: limitNum,
    total,
    results: paginatedLogs.length,
    logs: paginatedLogs,
    date,
    filters: {
      method: method || null,
      status: status || null,
      adminEmail: adminEmail || null,
    },
  });
});

/**
 * GET /api/admin/logs/dates/available
 * Get list of available log dates
 */
export const  getAvailableLogDates = catchAsync(async (req, res, next) => {
  const files = fs.readdirSync(LOGS_DIR);
  const logFiles = files.filter((file) => file.startsWith("admin-") && file.endsWith(".log"));

  const dates = logFiles
    .map((file) => {
      const match = file.match(/admin-(\d{4}-\d{2}-\d{2})\.log/);
      return match ? match[1] : null;
    })
    .filter((date) => date !== null)
    .sort((a, b) => new Date(b) - new Date(a)); // Newest first

  res.status(200).json({
    status: "success",
    total: dates.length,
    dates,
  });
});

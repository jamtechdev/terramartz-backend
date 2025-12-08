import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";

// logs folder er absolute path
const logDir = path.join(process.cwd(), "logs");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(
      ({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`
    )
  ),
  transports: [
    new DailyRotateFile({
      filename: `${logDir}/app-%DATE%.log`,
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d", // 14 din por delete
    }),
    new winston.transports.Console(), // Console e show korbe
  ],
});

export default logger;

import multer from "multer";
import sharp from "sharp";
import AppError from "./apperror.js";
import { PROFILE_IMAGE_MAX_FILE_BYTES } from "../config/uploadLimits.js";

const multerStorage = multer.memoryStorage();
const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image")) {
    cb(null, true);
  } else {
    cb(new AppError("Not an image! Please upload only images.", 400), false);
  }
};

const imageUploadLimits = {
  fileSize: PROFILE_IMAGE_MAX_FILE_BYTES,
};

/**
 * General image uploads (e.g. signup profile + shop picture, seller assets).
 * Per-file size matches PROFILE_IMAGE_MAX_FILE_BYTES.
 */
export const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: imageUploadLimits,
});

/**
 * Profile / settings photo only — same file cap, explicit limits for multipart text fields
 * (bio, JSON defaultAddress, etc.) so they cannot blow past the global parser by accident.
 */
export const profilePictureUpload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: PROFILE_IMAGE_MAX_FILE_BYTES,
    fieldSize: 2 * 1024 * 1024,
    fields: 32,
    files: 1,
  },
});

export const processImage = async (fileBuffer, outputPath) => {
  await sharp(fileBuffer)
    .resize(500, 500)
    .toFormat("jpeg")
    .jpeg({ quality: 90 })
    .toFile(outputPath);
};

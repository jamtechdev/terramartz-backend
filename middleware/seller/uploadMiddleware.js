import multer from "multer";
import sharp from "sharp";

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image")) cb(null, true);
  else cb(new Error("Only image files are allowed!"), false);
};

const kycAllowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const kycFileFilter = (req, file, cb) => {
  const isImage = file.mimetype.startsWith("image/");
  const isAllowedDoc = kycAllowedMimeTypes.has(file.mimetype);
  if (isImage || isAllowedDoc) cb(null, true);
  else
    cb(
      new Error("Only image, PDF, DOC, and DOCX files are allowed!"),
      false,
    );
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

export const uploadKYC = multer({
  storage,
  fileFilter: kycFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// 🔹 Resize only, buffer ready for S3
export const resizeProductImages = async (req, res, next) => {
  if (!req.files) return next();

  await Promise.all(
    req.files.map(async (file) => {
      file.buffer = await sharp(file.buffer)
        .resize({ width: 800, height: 800, fit: "inside" })
        .jpeg({ quality: 90 })
        .toBuffer();
    })
  );

  next();
};

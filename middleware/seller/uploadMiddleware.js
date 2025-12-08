import multer from "multer";
import sharp from "sharp";

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image")) cb(null, true);
  else cb(new Error("Only image files are allowed!"), false);
};

export const upload = multer({
  storage,
  fileFilter,
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

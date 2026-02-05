import { uploadToS3, getDirectUrl } from "../../utils/awsS3.js";
import AppError from "../../utils/apperror.js";
import catchAsync from "../../utils/catchasync.js";
import { v4 as uuidv4 } from "uuid";

export const uploadMedia = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError("Please upload a file", 400));
  }

  const file = req.file;
  const fileExt = file.originalname.split(".").pop();
  const fileName = `blog-media/${uuidv4()}.${fileExt}`;

  const key = await uploadToS3(file.buffer, fileName, file.mimetype);
  const url = getDirectUrl(key);

  res.status(200).json({
    status: "success",
    data: {
      url,
      key,
    },
  });
});

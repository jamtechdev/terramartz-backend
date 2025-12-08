import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getSignedUrlAWS } from "@aws-sdk/s3-request-presigner";

export const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const uploadToS3 = async (buffer, key) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: "image/jpeg",
  });

  try {
    await s3.send(command);
    return key;
  } catch (err) {
    console.error("Upload to S3 failed:", err);
    throw err;
  }
};

export const getPresignedUrl = async (key) => {
  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
  try {
    return await getSignedUrlAWS(s3, command, { expiresIn: 86400 });
  } catch (err) {
    console.error("Failed to generate presigned URL:", err);
    return null;
  }
};

// ✅ Delete file from S3
export const deleteFileFromS3 = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  try {
    await s3.send(command);
    console.log(`S3 file deleted: ${key}`);
  } catch (err) {
    console.error(`Failed to delete S3 file: ${key}`, err);
  }
};

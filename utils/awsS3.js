import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export const BUCKET_NAME = process.env.AWS_BUCKET_NAME;
export const AWS_REGION = process.env.AWS_REGION || "us-east-1";

export const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload file to S3 and return the S3 key
 * Note: Files are made public via bucket policy, not ACL (new S3 buckets don't allow ACLs)
 */
export const uploadToS3 = async (buffer, key, contentType = "image/jpeg") => {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // ACL removed - use bucket policy instead for public access
    // New S3 buckets (created after April 2023) have ACLs disabled by default
  });

  try {
    await s3.send(command);
    return key;
  } catch (err) {
    console.error("Upload to S3 failed:", err);
    throw err;
  }
};

/**
 * Get direct S3 URL (no presigned URL needed)
 * Format: https://{bucket-name}.s3.{region}.amazonaws.com/{key}
 */
export const getDirectUrl = (key) => {
  if (!key) return null;
  
  // If key is already a full URL, return it as is
  if (key.startsWith('http')) {
    return key;
  }
  
  // Construct direct S3 URL
  return `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;
};

/**
 * @deprecated Use getDirectUrl instead
 * Kept for backward compatibility - extracts key from URL or returns direct URL
 */
export const getPresignedUrl = async (key) => {
  // Just return direct URL instead of presigned
  return getDirectUrl(key);
};

/**
 * Delete file from S3
 */
export const deleteFileFromS3 = async (key) => {
  // Extract key from URL if full URL is provided
  let s3Key = key;
  if (key && key.startsWith('http')) {
    try {
      const url = new URL(key);
      s3Key = url.pathname.substring(1); // Remove leading '/'
    } catch (err) {
      console.error(`Error extracting key from URL: ${key}`, err);
      return;
    }
  }

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
  });

  try {
    await s3.send(command);
    console.log(`S3 file deleted: ${s3Key}`);
  } catch (err) {
    console.error(`Failed to delete S3 file: ${s3Key}`, err);
  }
};

import cron from 'node-cron';
import { Category } from '../models/super-admin/category.js';
import { getPresignedUrl } from '../utils/awsS3.js';

/**
 * Helper function to extract S3 key from URL or use key directly
 */
const extractS3Key = (urlOrKey) => {
  if (!urlOrKey) return null;
  
  // If it's already a key (no http), return it
  if (!urlOrKey.startsWith('http')) {
    return urlOrKey;
  }
  
  // Extract key from presigned URL
  try {
    const url = new URL(urlOrKey);
    // Remove leading slash and get the path
    let key = url.pathname.substring(1); // Remove leading '/'
    
    // If key doesn't have a folder prefix, assume it's in categories/
    if (!key.includes('/')) {
      key = `categories/${key}`;
    }
    
    return key;
  } catch (err) {
    console.error(`Error extracting key from URL: ${urlOrKey}`, err);
    return null;
  }
};

/**
 * Refresh presigned URLs for all categories
 * This function extracts S3 keys from existing URLs and generates new presigned URLs
 */
export const refreshCategoryPresignedUrls = async () => {
  try {
    console.log('🔄 Starting category presigned URL refresh job...');
    
    // Fetch all categories
    const categories = await Category.find({});
    
    if (!categories || categories.length === 0) {
      console.log('ℹ️ No categories found to refresh.');
      return;
    }
    
    console.log(`📦 Found ${categories.length} categories to refresh.`);
    
    let successCount = 0;
    let failCount = 0;
    
    // Process each category
    for (const category of categories) {
      try {
        const categoryObj = category.toObject();
        let updated = false;
        
        // Refresh image URL
        if (categoryObj.image) {
          const s3Key = extractS3Key(categoryObj.image);
          if (s3Key) {
            const newUrl = await getPresignedUrl(s3Key);
            if (newUrl) {
              category.image = newUrl;
              updated = true;
              console.log(`✅ Refreshed image URL for category: ${categoryObj.name}`);
            } else {
              console.warn(`⚠️ Failed to generate new image URL for category: ${categoryObj.name}`);
              failCount++;
            }
          }
        }
        
        // Refresh logo URL
        if (categoryObj.logo) {
          const s3Key = extractS3Key(categoryObj.logo);
          if (s3Key) {
            const newUrl = await getPresignedUrl(s3Key);
            if (newUrl) {
              category.logo = newUrl;
              updated = true;
              console.log(`✅ Refreshed logo URL for category: ${categoryObj.name}`);
            } else {
              console.warn(`⚠️ Failed to generate new logo URL for category: ${categoryObj.name}`);
              failCount++;
            }
          }
        }
        
        // Save updated category
        if (updated) {
          await category.save();
          successCount++;
        }
      } catch (err) {
        console.error(`❌ Error refreshing category ${category.name}:`, err);
        failCount++;
      }
    }
    
    console.log(`✅ Category URL refresh completed! Success: ${successCount}, Failed: ${failCount}`);
  } catch (err) {
    console.error('❌ Error in refreshCategoryPresignedUrls:', err);
  }
};

/**
 * Initialize cron job to run every 5 days
 * Cron expression: '0 0 */5 * *' means "At 00:00 on every 5th day"
 */
export const startCategoryUrlRefreshJob = () => {
  // Run every 5 days at midnight (00:00)
  // Cron format: minute hour day-of-month month day-of-week
  const cronExpression = '0 0 */5 * *';
  
  console.log('⏰ Category URL refresh job scheduled to run every 5 days at midnight');
  
  cron.schedule(cronExpression, async () => {
    console.log('⏰ Scheduled job triggered: Refreshing category presigned URLs...');
    await refreshCategoryPresignedUrls();
  });
  
  // Also run immediately on server start (optional - for testing)
  // Uncomment the line below if you want to run it immediately when server starts
  // refreshCategoryPresignedUrls();
};


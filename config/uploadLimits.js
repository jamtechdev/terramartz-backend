/**
 * Upload / body limits aligned with terramartz-frontend:
 * - ProfileSettings: max 5MB per image file
 * - next.config serverActions.bodySizeLimit: 8mb (base64 + form payload to the API)
 *
 * Multipart profile requests decode to a binary file ≤ 5MB; the HTTP body can be larger
 * due to multipart boundaries and text fields, so the global parser limit should be ≥ 8mb.
 */

/** Hard cap for a single profile / avatar image (decoded file bytes). */
export const PROFILE_IMAGE_MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Express json / urlencoded body ceiling (non-multipart).
 * Profile photos are sent as multipart/form-data and are capped by multer (see profilePictureUpload),
 * not by this limit. Keep this high enough for admin/dashboard JSON payloads.
 *
 * Next.js Server Actions use ~8mb for the hop to this API; the decoded file is still ≤ PROFILE_IMAGE_MAX_FILE_BYTES.
 */
export const EXPRESS_BODY_PARSER_LIMIT = "50mb";

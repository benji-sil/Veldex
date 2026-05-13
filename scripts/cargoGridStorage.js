import { supabase } from "../services/supabase.js";
import { logger } from "./utils.js";

const BUCKET_NAME = 'cargo-grid-layouts';

/**
 * Cloudflare __cf_bm cookie warnings may appear in local development when loading 
 * external signed resources (like Supabase Storage). This is browser-side and non-blocking.
 * 
 * Gets a signed URL for reading a private layout image.
 * @param {string} path - The storage path
 * @returns {Promise<string|null>}
 */
export async function getCargoGridLayoutSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET_NAME).createSignedUrl(path, 3600);
  if (error) {
    logger.error("CargoGridStorage", "Failed to get signed URL", error);
    return null;
  }
  return data.signedUrl;
}

/**
 * Uploads a layout image for a cargo grid.
 * @param {string} userId - The current user's ID
 * @param {string} gridId - The ID of the cargo grid
 * @param {File} file - The image file object
 * @returns {Promise<string|null>} The storage path if successful, null otherwise
 */
export async function uploadCargoGridLayoutImage(userId, gridId, file) {
  if (!userId || !gridId || !file) return null;
  
  // Extract extension from file
  const extMatch = file.name.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'webp';
  
  const path = `${userId}/${gridId}/layout.${ext}`;
  
  const { data, error } = await supabase.storage.from(BUCKET_NAME).upload(path, file, {
    cacheControl: '3600',
    upsert: true
  });
  
  if (error) {
    logger.error("CargoGridStorage", "Failed to upload image", error);
    return null;
  }
  
  return path;
}

/**
 * Removes a layout image from storage.
 * @param {string} path - The storage path to remove
 * @returns {Promise<boolean>}
 */
export async function removeCargoGridLayoutImage(path) {
  if (!path) return true;
  const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);
  if (error) {
    logger.error("CargoGridStorage", "Failed to remove image", error);
    return false;
  }
  return true;
}

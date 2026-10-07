/** Pure format rules (no DOM), shared by the pickers and unit tests. */
/** Approved attachment formats (owner decisions): JPEG, PNG, WebP and iPhone HEIC/HEIF. */
export const IMAGE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
export const IMAGE_FORMATS_LABEL = 'JPG أو PNG أو WebP أو صور الآيفون (HEIC)';
const APPROVED_MIME = /^image\/(jpeg|png|webp|heic|heif)$/i;
const APPROVED_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
const HEIC_MIME = /^image\/hei[cf]$/i;
const HEIC_EXT = /\.hei[cf]$/i;

/** iPhone photo format: most browsers (all but Safari) cannot draw it natively. */
export function isHeicFile(file: { type: string; name?: string }): boolean {
  return file.type ? HEIC_MIME.test(file.type) : HEIC_EXT.test(file.name ?? '');
}

/**
 * True for an approved image. The MIME type decides; a file with no type
 * (some file managers) is judged by its extension. Decoding later is the
 * final check that the content really is an image.
 */
export function isApprovedImage(file: { type: string; name?: string }): boolean {
  if (file.type) return APPROVED_MIME.test(file.type);
  return APPROVED_EXT.test(file.name ?? '');
}

export const UNAPPROVED_IMAGE = `صيغة الملف غير مسموحة. المسموح: ${IMAGE_FORMATS_LABEL} فقط.`;

/** Pure format rules (no DOM), shared by the pickers and unit tests. */
/** Approved attachment formats (owner decision): JPEG, PNG, WebP only. */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
export const IMAGE_FORMATS_LABEL = 'JPG أو PNG أو WebP';
const APPROVED_MIME = /^image\/(jpeg|png|webp)$/i;
const APPROVED_EXT = /\.(jpe?g|png|webp)$/i;

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

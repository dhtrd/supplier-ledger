import { AppError } from '../../core/errors';

export interface CompressedImage {
  data: Uint8Array;
  mime: 'image/webp' | 'image/jpeg';
}

const ACCEPTED = /^image\/(jpeg|png|webp|heic|heif|gif|bmp)$/i;
const MAX_INPUT = 25 * 1024 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall back to <img> (older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Re-encodes a photo to WebP (JPEG where WebP encoding is unsupported) under
 * `maxBytes`, shrinking the dimensions/quality step by step. Re-encoding also
 * strips EXIF metadata such as GPS location.
 */
export async function compressImage(
  file: Blob,
  { maxBytes = 300 * 1024, maxSide = 1800 }: { maxBytes?: number; maxSide?: number } = {},
): Promise<CompressedImage> {
  if (file.type && !ACCEPTED.test(file.type)) throw new AppError('الملف ليس صورة مدعومة.');
  if (file.size > MAX_INPUT) throw new AppError('الصورة أكبر من 25 ميغابايت.');
  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await decode(file);
  } catch {
    throw new AppError('تعذّر قراءة الصورة. جرّب صورة أخرى.');
  }
  const w0 = img.width;
  const h0 = img.height;
  let side = Math.min(maxSide, Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AppError('المتصفح لا يدعم معالجة الصور.');

  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = side / Math.max(w0, h0);
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.7, 0.58]) {
      let blob = await toBlob(canvas, 'image/webp', q);
      let mime: CompressedImage['mime'] = 'image/webp';
      if (!blob || blob.type !== 'image/webp') {
        blob = await toBlob(canvas, 'image/jpeg', q);
        mime = 'image/jpeg';
      }
      if (blob && blob.size <= maxBytes)
        return { data: new Uint8Array(await blob.arrayBuffer()), mime };
    }
    side = Math.round(side * 0.75);
  }
  throw new AppError('تعذّر ضغط الصورة إلى الحجم المسموح.');
}

export interface PreparedPhoto {
  /** Original for viewing/printing (≤ 300 KB). */
  data: Uint8Array;
  /** Preview kept in the database for good (≤ 40 KB, 480 px). */
  thumb: Uint8Array;
  mime: CompressedImage['mime'];
}

/** Original + thumbnail in one step (the thumbnail stays in Firestore). */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const original = await compressImage(file);
  const thumb = await compressImage(file, { maxBytes: 40 * 1024, maxSide: 480 });
  return { data: original.data, thumb: thumb.data, mime: original.mime };
}

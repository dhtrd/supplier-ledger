import { useBlobUrl } from './hooks';

/** Account logo, or a dashed placeholder (matches the approved mockups). */
export function Logo({
  data,
  size,
  placeholder = 'شعار',
  hideEmpty = false,
}: {
  data: Uint8Array | null;
  size: number;
  placeholder?: string;
  /** Print and signing pages show nothing rather than an empty frame. */
  hideEmpty?: boolean;
}) {
  const url = useBlobUrl(data, sniffMime(data));
  if (!url && hideEmpty) return null;
  return (
    <div className={`logo-box${url ? ' has-img' : ''}`} style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : <span aria-hidden="true">{placeholder}</span>}
    </div>
  );
}

/** Logos are stored as raw bytes; detect the format from the magic number. */
export function sniffMime(d: Uint8Array | null | undefined): string {
  if (!d || d.length < 4) return 'image/webp';
  if (d[0] === 0x89 && d[1] === 0x50) return 'image/png';
  if (d[0] === 0xff && d[1] === 0xd8) return 'image/jpeg';
  return 'image/webp';
}

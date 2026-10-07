/**
 * 128-bit random token (base64url, 22 chars) used as the signing-link id.
 * Uses the platform CSPRNG only.
 */
export function generateToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

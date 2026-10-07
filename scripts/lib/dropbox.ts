/**
 * Minimal Dropbox API client for the maintenance scripts (refresh-token flow).
 * Paths are relative to the app folder and ASCII by construction (the
 * Dropbox-API-Arg header must be ASCII). Every failure throws.
 *
 * Required app permissions: files.metadata.read, files.content.write,
 * files.content.read, sharing.write, sharing.read.
 */

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export async function dropboxToken(): Promise<string> {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: need('DROPBOX_REFRESH_TOKEN'),
      client_id: need('DROPBOX_APP_KEY'),
      client_secret: need('DROPBOX_APP_SECRET'),
    }),
  });
  if (!res.ok) throw new Error(`Dropbox auth failed (HTTP ${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function rpc<T>(token: string, endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Dropbox ${endpoint} failed (HTTP ${res.status})`) as Error & {
      status: number;
      body: string;
    };
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text) as T;
}

export async function upload(token: string, path: string, body: Uint8Array | string) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }),
    },
    body: typeof body === 'string' ? body : Buffer.from(body),
  });
  if (!res.ok) throw new Error(`Dropbox upload failed for ${path} (HTTP ${res.status})`);
}

export async function download(token: string, path: string): Promise<Uint8Array> {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path }) },
  });
  if (!res.ok) throw new Error(`Dropbox download failed for ${path} (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function exists(token: string, path: string): Promise<boolean> {
  try {
    await rpc(token, 'files/get_metadata', { path });
    return true;
  } catch (e) {
    if ((e as { status?: number }).status === 409) return false;
    throw e;
  }
}

/** A view link that renders the file directly (raw=1). Reuses an existing link. */
export async function sharedLink(token: string, path: string): Promise<string> {
  try {
    const r = await rpc<{ url: string }>(token, 'sharing/create_shared_link_with_settings', {
      path,
      settings: { access: 'viewer', allow_download: true, audience: 'public' },
    });
    return rawLink(r.url);
  } catch (e) {
    if ((e as { status?: number }).status !== 409) throw e;
    const r = await rpc<{ links: { url: string }[] }>(token, 'sharing/list_shared_links', {
      path,
      direct_only: true,
    });
    const url = r.links[0]?.url;
    if (!url) throw new Error(`No shared link available for ${path}`, { cause: e });
    return rawLink(url);
  }
}

export async function listFolderNames(token: string, path: string): Promise<string[]> {
  try {
    const r = await rpc<{ entries: { name: string; '.tag': string }[] }>(
      token,
      'files/list_folder',
      { path },
    );
    return r.entries.filter((e) => e['.tag'] === 'folder').map((e) => e.name);
  } catch (e) {
    if ((e as { status?: number }).status === 409) return []; // folder not created yet
    throw e;
  }
}

export async function deletePath(token: string, path: string): Promise<void> {
  await rpc(token, 'files/delete_v2', { path });
}

/** ?dl=0 → ?raw=1 so the link opens the image itself. Keeps rlkey. Pure. */
export function rawLink(url: string): string {
  const u = new URL(url);
  u.searchParams.delete('dl');
  u.searchParams.set('raw', '1');
  return u.toString();
}

/** Backup folders (YYYY-MM-DD) older than `days` relative to `today`. Pure. */
export function expiredBackupFolders(names: string[], today: string, days: number): string[] {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const limit = cutoff.toISOString().slice(0, 10);
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && n < limit);
}

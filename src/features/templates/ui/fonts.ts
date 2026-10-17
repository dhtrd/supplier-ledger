import type { FontId } from '../domain/template';

/**
 * The extra Arabic fonts are bundled with the app (no request to Google when
 * printing) and loaded only when a template uses them.
 */
const LOADERS: Record<FontId, (() => Promise<unknown>) | null> = {
  plex: null, // loaded at start (main.tsx)
  naskh: null,
  amiri: () =>
    Promise.all([import('@fontsource/amiri/400.css'), import('@fontsource/amiri/700.css')]),
  tajawal: () =>
    Promise.all([
      import('@fontsource/tajawal/400.css'),
      import('@fontsource/tajawal/700.css'),
      import('@fontsource/tajawal/800.css'),
    ]),
  cairo: () =>
    Promise.all([
      import('@fontsource/cairo/400.css'),
      import('@fontsource/cairo/700.css'),
      import('@fontsource/cairo/800.css'),
      import('@fontsource/cairo/900.css'),
    ]),
};

const started = new Map<FontId, Promise<unknown>>();

export function loadFont(id: FontId): Promise<unknown> {
  const load = LOADERS[id];
  if (!load) return Promise.resolve();
  let p = started.get(id);
  if (!p) {
    p = load();
    started.set(id, p);
  }
  return p;
}

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** PNG data URL, downscaled until it fits `maxChars`. */
  toPng: (maxChars: number) => string | null;
}

const W = 680;
const H = 300;

/** Finger/mouse signature on a canvas (pointer events, no library). */
export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { labelledBy: string; onChange: (hasInk: boolean) => void }
>(function SignaturePad({ labelledBy, onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const [ink, setInk] = useState(false);

  const ctx = () => canvas.current?.getContext('2d') ?? null;

  const reset = useCallback(() => {
    const c = ctx();
    if (!c) return;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = '#d8d1c2';
    c.setLineDash([8, 8]);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(40, H - 64);
    c.lineTo(W - 40, H - 64);
    c.stroke();
    c.setLineDash([]);
    setInk(false);
    onChange(false);
  }, [onChange]);

  useEffect(reset, [reset]);

  useImperativeHandle(ref, () => ({
    clear: reset,
    isEmpty: () => !ink,
    toPng: (maxChars) => {
      const src = canvas.current;
      if (!src || !ink) return null;
      for (const scale of [1, 0.75, 0.5, 0.35]) {
        const out = document.createElement('canvas');
        out.width = Math.round(W * scale);
        out.height = Math.round(H * scale);
        const o = out.getContext('2d');
        if (!o) return null;
        o.drawImage(src, 0, 0, out.width, out.height);
        const url = out.toDataURL('image/png');
        if (url.length <= maxChars) return url;
      }
      return null;
    },
  }));

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
  };

  const line = (a: [number, number], b: [number, number]) => {
    const c = ctx();
    if (!c) return;
    c.strokeStyle = '#1b2a3a';
    c.lineWidth = 4.5;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0] + 0.01, b[1]);
    c.stroke();
  };

  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      role="img"
      aria-labelledby={labelledBy}
      style={{
        width: '100%',
        aspectRatio: `${W} / ${H}`,
        background: '#fff',
        border: '1.5px solid var(--rule-strong)',
        borderRadius: 12,
        touchAction: 'none',
        cursor: 'crosshair',
        display: 'block',
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        const p = point(e);
        last.current = p;
        line(p, p);
        if (!ink) {
          setInk(true);
          onChange(true);
        }
      }}
      onPointerMove={(e) => {
        if (!drawing.current || !last.current) return;
        const p = point(e);
        line(last.current, p);
        last.current = p;
      }}
      onPointerUp={() => {
        drawing.current = false;
        last.current = null;
      }}
      onPointerCancel={() => {
        drawing.current = false;
        last.current = null;
      }}
    />
  );
});

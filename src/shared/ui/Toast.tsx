import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Kind = 'info' | 'error';
interface ToastItem {
  id: number;
  text: string;
  kind: Kind;
}

interface ToastApi {
  info: (text: string) => void;
  error: (text: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (text: string, kind: Kind) => {
      const id = ++seq;
      setItems((l) => [...l.slice(-2), { id, text, kind }]);
      // Errors stay until dismissed — failures are never silently swallowed.
      if (kind === 'info') setTimeout(() => remove(id), 5000);
    },
    [remove],
  );
  const api = useMemo<ToastApi>(
    () => ({ info: (t) => push(t, 'info'), error: (t) => push(t, 'error') }),
    [push],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts no-print" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast${t.kind === 'error' ? ' toast-error' : ''}`}
            role={t.kind === 'error' ? 'alert' : 'status'}
          >
            <span style={{ flex: '1 1 auto' }}>{t.text}</span>
            <button type="button" aria-label="إغلاق التنبيه" onClick={() => remove(t.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}

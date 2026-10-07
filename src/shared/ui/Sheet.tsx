import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Bottom sheet on phones, centred dialog on desktop. Closes on Escape and on
 * the backdrop; focus moves into the sheet and returns to the opener.
 */
export function Sheet({
  title,
  onClose,
  children,
  badge,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  badge?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="overlay no-print"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet-grip" />
        <div className="row-between">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          {badge}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

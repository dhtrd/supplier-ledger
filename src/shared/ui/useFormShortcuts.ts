import { useState, type KeyboardEvent } from 'react';
import { useToast } from './Toast';

/**
 * Desktop form shortcuts: Ctrl/⌘+Enter saves; Esc cancels — twice when the
 * form has unsaved input, so a stray key never throws work away silently.
 */
export function useFormShortcuts({
  onSave,
  onCancel,
  dirty,
  paused = false,
}: {
  onSave: () => void;
  onCancel: () => void;
  dirty: boolean;
  /** A dialog (e.g. the calendar) owns the keyboard. */
  paused?: boolean;
}) {
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  return (e: KeyboardEvent<HTMLElement>) => {
    if (paused) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!dirty || armed) return onCancel();
      setArmed(true);
      toast.info('في النموذج بيانات غير محفوظة. اضغط Esc مرة أخرى للخروج دون حفظ.');
    } else if (armed) setArmed(false);
  };
}

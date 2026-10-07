import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { APP_NAME, BrandMark } from '../shared/ui/BrandMark';
import { Icon } from '../shared/ui/Icon';

/** Screens where a reload would throw away what is being typed. */
const FORM_ROUTE = /^\/a\/(new|[^/]+\/edit|[^/]+\/entry\/[^/]+)$/;
const CONFIRM_MS = 4000;

/**
 * Phones only (owner decision 2026-10-07): a reload button at the top of every
 * screen. A full reload brings fresh data and, if one was published, the
 * newest version of the app. On a form it asks for a second tap first.
 */
export function MobileBar() {
  const { pathname } = useLocation();
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const reload = () => {
    if (FORM_ROUTE.test(pathname) && !armed) {
      // Asked on the button itself (a toast would cover it at the top of a phone).
      setArmed(true);
      timer.current = window.setTimeout(() => setArmed(false), CONFIRM_MS);
      return;
    }
    window.location.reload();
  };

  return (
    <div className="mobile-bar no-print">
      <span className="mobile-bar-brand">
        <BrandMark size={24} />
        {APP_NAME}
      </span>
      <button
        type="button"
        className={armed ? 'reload-btn armed' : 'icon-btn'}
        onClick={reload}
        aria-label={
          armed ? 'تأكيد إعادة التحميل: ما كتبته في النموذج سيُفقد' : 'إعادة تحميل البيانات'
        }
        title="إعادة تحميل البيانات"
      >
        <Icon name="reload" size={22} />
        {armed && <span>يُفقد ما كتبته — اضغط للتأكيد</span>}
      </button>
    </div>
  );
}

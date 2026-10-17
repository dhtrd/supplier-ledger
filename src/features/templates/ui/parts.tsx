import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { reportError } from '../../../core/errors';
import { loadFont } from './fonts';
import { formatDateTime } from '../../../shared/lib/dates';
import { Logo } from '../../../shared/ui/Logo';
import type { Signature } from '../../ledger/domain/types';
import { FONTS, fillText, type DocTemplate, type VarName } from '../domain/template';
import './templates.css';

/** Who the document belongs to (the supplier/customer). */
export interface DocAccount {
  name: string;
  phone: string;
  logo: Uint8Array | null;
}

/** CSS variables of a template: main colour, a pale tint of it, and the font. */
export function tplStyle(t: DocTemplate): CSSProperties {
  return {
    ['--c' as string]: t.color,
    ['--c2' as string]: `${t.color}1f`,
    fontFamily: FONTS[t.font].css,
  };
}

/** A4 sheet of one template layout. */
export function Sheet({
  t,
  kind,
  single = true,
  children,
}: {
  t: DocTemplate;
  kind: string;
  single?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    loadFont(t.font).catch((e) => reportError('template-font', e));
  }, [t.font]);
  return (
    <article
      className={`a4 tp tp-l-${t.layout}${single ? ' single' : ''}`}
      dir="rtl"
      style={tplStyle(t)}
      data-kind={kind}
    >
      {children}
    </article>
  );
}

/** The supplier's logo; without one, its initial in the template colour. */
export function Mark({
  account,
  size = 64,
  light = false,
}: {
  account: DocAccount;
  size?: number;
  light?: boolean;
}) {
  if (account.logo) return <Logo data={account.logo} size={size} placeholder="" />;
  return (
    <div
      className={`tp-mark${light ? ' light' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {account.name.trim().charAt(0)}
    </div>
  );
}

/** The template text with {placeholders} filled in; values in bold. Plain text only. */
export function Body({
  text,
  values,
  className,
  style,
}: {
  text: string;
  values: Partial<Record<VarName, string>>;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <p className={`tp-body ${className ?? ''}`} style={style}>
      {fillText(text, values).map((p, i) =>
        p.value ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>,
      )}
    </p>
  );
}

/** Signature area: the signer's image, name and time once signed, or empty lines. */
export function SignBox({
  signature,
  label,
  style,
  big = false,
}: {
  signature: Signature | null;
  label: string;
  style?: CSSProperties;
  big?: boolean;
}) {
  return (
    <div className="tp-sign" style={style}>
      <div className={`tp-sign-box${big ? ' big' : ''}`}>
        {signature?.image.startsWith('data:image/png;base64,') && (
          <img src={signature.image} alt={`توقيع ${signature.name}`} />
        )}
      </div>
      <div className="tp-muted">
        {label}
        {signature ? ` — ${signature.name}` : ''}
      </div>
      {signature && signature.signedAtMs > 0 && (
        <div className="tp-muted tp-small">
          وُقّع إلكترونياً · {formatDateTime(signature.signedAtMs)}
        </div>
      )}
    </div>
  );
}

export function Foot({ t, end }: { t: DocTemplate; end?: string }) {
  if (!t.foot && !end) return null;
  return (
    <footer className="tp-foot">
      <span>{t.foot}</span>
      <span>{end}</span>
    </footer>
  );
}

/** Label/value rows as a bordered grid (the «form» layouts). */
export function FieldGrid({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table className="tp-fields">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Sub({ account, t }: { account: DocAccount; t: DocTemplate }) {
  return (
    <>
      {account.phone && <div className="tp-muted num">{account.phone}</div>}
      {t.sub && <div className="tp-muted">{t.sub}</div>}
    </>
  );
}

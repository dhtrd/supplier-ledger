import type { ReactNode } from 'react';
import { columnTitle, type ColumnId, type DocTemplate } from '../domain/template';
import { Foot, Mark, Sheet, Sub, type DocAccount } from './parts';

export interface StatementDocRow {
  id: string;
  date: string;
  type: string;
  no: string;
  details: string;
  /** Formatted amounts ('' when none). */
  lah: string;
  alayh: string;
  balance: string;
}

/** A statement, already formatted (oldest first, with the opening balance). */
export interface StatementDoc {
  account: DocAccount;
  from: string;
  to: string;
  rows: StatementDocRow[];
  /** «1,200 له» etc., or null when balances are hidden for this role. */
  opening: string | null;
  closing: string | null;
  totalLah: string;
  totalAlayh: string;
}

type Layout = (t: DocTemplate, d: StatementDoc) => ReactNode;
const NUMERIC: ColumnId[] = ['lah', 'alayh', 'balance'];

function cols(t: DocTemplate, d: StatementDoc): ColumnId[] {
  return t.columns.filter((c) => c !== 'balance' || d.closing !== null);
}

function Table({ t, d, className }: { t: DocTemplate; d: StatementDoc; className?: string }) {
  const cs = cols(t, d);
  const cell = (c: ColumnId, v: string, key: string) => (
    <td
      key={key}
      className={NUMERIC.includes(c) || c === 'date' || c === 'no' ? 'n num' : undefined}
    >
      {v}
    </td>
  );
  return (
    <table className={`tp-table ${className ?? ''}`}>
      <thead>
        <tr>
          {cs.map((c) => (
            <th key={c} className={NUMERIC.includes(c) ? 'n' : undefined}>
              {columnTitle(t, c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {d.opening !== null && (
          <tr className="tp-open">
            {cs.map((c) =>
              cell(
                c,
                c === 'details'
                  ? 'الرصيد السابق (رصيد افتتاحي)'
                  : c === 'balance'
                    ? d.opening!
                    : c === 'date'
                      ? d.from
                      : '',
                c,
              ),
            )}
          </tr>
        )}
        {d.rows.map((r) => (
          <tr key={r.id}>{cs.map((c) => cell(c, r[c === 'balance' ? 'balance' : c], c))}</tr>
        ))}
        <tr className="tp-total">
          {cs.map((c) =>
            cell(
              c,
              c === 'details'
                ? 'إجمالي الفترة'
                : c === 'lah'
                  ? d.totalLah
                  : c === 'alayh'
                    ? d.totalAlayh
                    : c === 'balance'
                      ? (d.closing ?? '')
                      : '',
              c,
            ),
          )}
        </tr>
      </tbody>
    </table>
  );
}

const period = (d: StatementDoc) => (
  <span className="num">
    من {d.from} إلى {d.to}
  </span>
);

const LAYOUTS: Record<string, Layout> = {
  classic: (t, d) => (
    <>
      <header className="tp-row tp-rule">
        <div className="tp-row">
          <Mark account={d.account} />
          <div>
            <div className="tp-name">{d.account.name}</div>
            <Sub account={d.account} t={t} />
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div className="tp-title">{t.title}</div>
          {period(d)}
        </div>
      </header>
      <Table t={t} d={d} className="head-fill" />
      {d.closing && <div className="tp-closing">الرصيد: {d.closing}</div>}
    </>
  ),
  band: (t, d) => (
    <>
      <div className="tp-band tp-row">
        <div className="tp-row">
          <Mark account={d.account} light />
          <div>
            <div className="tp-title light">{t.title}</div>
            <div>{d.account.name}</div>
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          {period(d)}
          {t.sub && <div>{t.sub}</div>}
        </div>
      </div>
      <div className="tp-kpis">
        <div>
          {columnTitle(t, 'lah')}
          <b className="num">{d.totalLah}</b>
        </div>
        <div>
          {columnTitle(t, 'alayh')}
          <b className="num">{d.totalAlayh}</b>
        </div>
        {d.closing && (
          <div>
            {columnTitle(t, 'balance')}
            <b className="num">{d.closing}</b>
          </div>
        )}
      </div>
      <Table t={t} d={d} className="zebra head-line" />
    </>
  ),
  tacct: (t, d) => {
    const side = (k: 'lah' | 'alayh') => (
      <div>
        <h3 className="tp-t-head">{columnTitle(t, k)}</h3>
        <table className="tp-table dotted">
          <tbody>
            {d.rows
              .filter((r) => r[k])
              .map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.date}</td>
                  <td>
                    {r.details || r.type}
                    {r.no && <span className="tp-muted"> #{r.no}</span>}
                  </td>
                  <td className="n num">{r[k]}</td>
                </tr>
              ))}
            <tr className="tp-total">
              <td colSpan={2}>المجموع</td>
              <td className="n num">{k === 'lah' ? d.totalLah : d.totalAlayh}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
    return (
      <>
        <header className="tp-center tp-rule dark">
          <div className="tp-title tp-big">{t.title}</div>
          <div>
            {d.account.name}
            {t.sub ? ` — ${t.sub}` : ''}
          </div>
          {period(d)}
        </header>
        {d.opening && <div className="tp-muted">الرصيد السابق: {d.opening}</div>}
        <div className="tp-t">
          {side('lah')}
          {side('alayh')}
        </div>
        {d.closing && <div className="tp-closing boxed">الرصيد {d.closing}</div>}
      </>
    );
  },
  cards: (t, d) => (
    <>
      <header className="tp-row">
        <div className="tp-row">
          <Mark account={d.account} />
          <div>
            <div className="tp-title tp-big">{t.title}</div>
            <div>
              {d.account.name}
              {t.sub ? ` · ${t.sub}` : ''}
            </div>
          </div>
        </div>
        {period(d)}
      </header>
      {d.opening && <div className="tp-muted">الرصيد السابق: {d.opening}</div>}
      <div className="tp-timeline">
        {d.rows.map((r) => (
          <div key={r.id} className="tp-tl-card">
            <div>
              <b>{r.details || r.type}</b>
              <div className="tp-muted num">
                {r.date}
                {r.no ? ` · ${r.type} #${r.no}` : ` · ${r.type}`}
              </div>
            </div>
            <div style={{ textAlign: 'left' }}>
              {r.lah && <b className="num tp-lah">+{r.lah}</b>}
              {r.alayh && <b className="num tp-alayh">−{r.alayh}</b>}
              {d.closing !== null && <div className="tp-muted num">الرصيد {r.balance}</div>}
            </div>
          </div>
        ))}
      </div>
      {d.closing && <div className="tp-closing">الرصيد: {d.closing}</div>}
    </>
  ),
  formal: (t, d) => (
    <>
      <div className="tp-frame double" />
      <header className="tp-center tp-pad">
        <Mark account={d.account} />
        <div className="tp-title tp-huge-title">{t.title}</div>
        <div className="tp-hr" />
        <div className="tp-name">{d.account.name}</div>
        <Sub account={d.account} t={t} />
        {period(d)}
      </header>
      <div className="tp-pad">
        <Table t={t} d={d} className="boxed" />
      </div>
      {d.closing && <div className="tp-closing tp-center">الرصيد الختامي: {d.closing}</div>}
      <div className="tp-seal">{d.account.name}</div>
    </>
  ),
};

/** A statement in the supplier's template (pages flow when long). */
export function StatementTemplate({ t, doc }: { t: DocTemplate; doc: StatementDoc }) {
  const layout = LAYOUTS[t.layout] ?? LAYOUTS.classic!;
  return (
    <Sheet t={t} kind="statement" single={false}>
      {layout(t, doc)}
      <Foot t={t} end={`عدد الحركات: ${doc.rows.length}`} />
    </Sheet>
  );
}

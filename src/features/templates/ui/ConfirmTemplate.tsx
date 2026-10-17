import type { ReactNode } from 'react';
import type { Signature } from '../../ledger/domain/types';
import type { DocTemplate, VarName } from '../domain/template';
import { Body, FieldGrid, Foot, Mark, Sheet, SignBox, Sub, type DocAccount } from './parts';

/** Everything a balance confirmation shows, already formatted. */
export interface ConfirmDoc {
  account: DocAccount;
  payerName: string;
  /** «2,660 ر.س» */
  balance: string;
  balanceNum: string;
  words: string;
  /** «لصالحنا» / «علينا» / «» when settled. */
  side: string;
  no: string;
  date: string;
  details: string;
  signature: Signature | null;
}

export const confirmValues = (d: ConfirmDoc): Partial<Record<VarName, string>> => ({
  المورد: d.account.name,
  الدافع: d.payerName,
  التاريخ: d.date,
  الرصيد: d.balance,
  التفقيط: d.words,
  الجهة: d.side || '(الحساب مسدَّد)',
  الرقم: d.no,
});

type Layout = (t: DocTemplate, d: ConfirmDoc) => ReactNode;
const text = (t: DocTemplate, d: ConfirmDoc, cls?: string) => (
  <Body text={t.body} values={confirmValues(d)} className={cls} />
);
const sign = (d: ConfirmDoc, label = `عن ${d.account.name}`) => (
  <SignBox signature={d.signature} label={label} />
);
const to = (d: ConfirmDoc) => <div>السادة / {d.payerName}</div>;
const details = (d: ConfirmDoc) => (d.details ? <div>البيان: {d.details}</div> : null);
const sideOf = (d: ConfirmDoc) => d.side || 'الحساب مسدَّد';

const LAYOUTS: Record<string, Layout> = {
  c01: (t, d) => (
    <>
      <header className="tp-row tp-rule">
        <div className="tp-row">
          <Mark account={d.account} />
          <div>
            <div className="tp-name">{d.account.name}</div>
            <Sub account={d.account} t={t} />
          </div>
        </div>
        <div className="num" style={{ textAlign: 'left' }}>
          الرقم: {d.no}
          <br />
          التاريخ: {d.date}
        </div>
      </header>
      <div className="tp-title tp-big tp-center">{t.title}</div>
      {to(d)}
      {text(t, d, 'tp-letter')}
      {details(d)}
      <div>وعلى ذلك جرى التوقيع.</div>
      {sign(d)}
    </>
  ),
  c02: (t, d) => (
    <>
      <div className="tp-frame double" />
      <div className="tp-center tp-pad" style={{ marginTop: 70 }}>
        <Mark account={d.account} />
        <div className="tp-title tp-big">{t.title}</div>
        {t.sub && <div className="tp-muted">{t.sub}</div>}
        {text(t, d)}
        <div className="tp-amt tp-huge">{d.balance}</div>
        <div>
          {d.words} — {sideOf(d)}
        </div>
      </div>
      <div className="tp-row tp-pad" style={{ marginTop: 'auto', alignItems: 'flex-end' }}>
        {sign(d, 'التوقيع')}
        <span className="num">{d.no}</span>
      </div>
    </>
  ),
  c03: (t, d) => (
    <>
      <header className="tp-row">
        <div className="tp-title">{t.title}</div>
        <Mark account={d.account} />
      </header>
      <FieldGrid
        rows={[
          ['المورد', d.account.name],
          ['إلى', d.payerName],
          ['حتى تاريخ', d.date],
          ['الرصيد', <b key="b">{`${d.balance} ${d.side}`}</b>],
          ['كتابةً', d.words],
          ['الرقم', d.no],
          ['الإقرار', text(t, d)],
          [
            'الاسم والتوقيع',
            <SignBox key="s" signature={d.signature} label="" style={{ width: '100%' }} />,
          ],
        ]}
      />
      {t.sub && <div className="tp-muted">{t.sub}</div>}
    </>
  ),
  c04: (t, d) => (
    <>
      <div className="tp-band tp-row">
        <div>
          <div className="tp-title light">{t.title}</div>
          <div>{d.account.name}</div>
        </div>
        <span className="num">{d.no}</span>
      </div>
      <div className="tp-float tp-center">
        <div className="tp-muted">الرصيد حتى {d.date}</div>
        <div className="tp-amt tp-huge">{d.balance}</div>
        <div>{sideOf(d)}</div>
      </div>
      {to(d)}
      {text(t, d)}
      {details(d)}
      {sign(d, 'التوقيع')}
    </>
  ),
  c05: (t, d) => (
    <div className="tp-panel-wrap left">
      <aside className="tp-panel">
        <Mark account={d.account} size={56} light />
        <span>الرقم</span>
        <b className="num">{d.no}</b>
        <span>التاريخ</span>
        <b className="num">{d.date}</b>
        <span>الرصيد</span>
        <b className="tp-amt">{d.balanceNum}</b>
      </aside>
      <div className="tp-col" style={{ flex: 1 }}>
        <div className="tp-title tp-big">{t.title}</div>
        <div className="tp-muted">{d.account.name}</div>
        {t.sub && <div className="tp-muted">{t.sub}</div>}
        {to(d)}
        {text(t, d)}
        {details(d)}
        <div style={{ marginTop: 'auto' }}>{sign(d, 'التوقيع')}</div>
      </div>
    </div>
  ),
  c06: (t, d) => (
    <>
      <div className="tp-frame thin" />
      <div className="tp-frame thick" />
      <div className="tp-center tp-pad" style={{ marginTop: 70 }}>
        <div className="tp-orn">❖ ❖ ❖</div>
        <div className="tp-title tp-huge-title">{t.title}</div>
        <div className="tp-muted">مطابقة رصيد</div>
        {text(t, d)}
        {details(d)}
      </div>
      <div
        className="tp-row tp-pad"
        style={{ marginTop: 'auto', alignItems: 'flex-end', marginBottom: 30 }}
      >
        <span className="num">{d.date}</span>
        {sign(d, d.account.name)}
      </div>
    </>
  ),
  c07: (t, d) => (
    <>
      <header className="tp-row tp-rule dark">
        <Mark account={d.account} />
        <div style={{ textAlign: 'left' }}>
          <div className="tp-title">{t.title}</div>
          <div className="num">{d.no}</div>
        </div>
      </header>
      <table className="tp-table zebra">
        <thead>
          <tr>
            <th>البند</th>
            <th>القيمة</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['الطرف المُقرّ', d.account.name],
              ['الطرف الآخر', d.payerName],
              ['تاريخ المطابقة', d.date],
              ['الرصيد المُقرّ به', d.balance],
              ['كتابةً', d.words],
              ['الجهة', sideOf(d)],
            ] as const
          ).map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>
                <b>{v}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {text(t, d)}
      {sign(d, 'الاسم والتوقيع')}
    </>
  ),
  c08: (t, d) => (
    <>
      <div className="tp-muted">
        {d.account.name}
        {d.account.phone ? ` · ${d.account.phone}` : ''}
        {t.sub ? ` · ${t.sub}` : ''}
      </div>
      <div className="tp-light-title">{t.title}</div>
      <div className="tp-hr thin" />
      {text(t, d)}
      <div className="tp-amt tp-huge light">{d.balance}</div>
      {details(d)}
      {sign(d, d.date)}
    </>
  ),
  c09: (t, d) => (
    <>
      <div className="tp-title tp-big tp-under">{t.title}</div>
      <table className="tp-memo">
        <tbody>
          {(
            [
              ['إلى', d.payerName],
              ['من', d.account.name],
              ['التاريخ', d.date],
              ['الموضوع', 'مطابقة رصيد الحساب'],
              ['الرقم', d.no],
            ] as const
          ).map(([k, v]) => (
            <tr key={k}>
              <th>{k}:</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {text(t, d)}
      {details(d)}
      {sign(d)}
    </>
  ),
  c10: (t, d) => (
    <div className="tp-card tp-center">
      <Mark account={d.account} />
      <div className="tp-title tp-big">{t.title}</div>
      <div className="tp-muted">{d.account.name}</div>
      <div className="tp-amt tp-huge">{d.balance}</div>
      {text(t, d)}
      <SignBox signature={d.signature} label="التوقيع" style={{ margin: '0 auto' }} />
      <div className="tp-muted num">
        {d.no} · {d.date}
      </div>
    </div>
  ),
  c11: (t, d) => (
    <>
      <header className="tp-center">
        <Mark account={d.account} />
        <div className="tp-name">{d.account.name}</div>
        <Sub account={d.account} t={t} />
      </header>
      <div className="tp-title tp-big tp-center">{t.title}</div>
      {to(d)}
      {text(t, d, 'tp-letter')}
      {details(d)}
      <div className="tp-seal">
        {d.account.name}
        <br />
        {d.no}
      </div>
      {sign(d, 'التوقيع')}
    </>
  ),
  c12: (t, d) => (
    <>
      <header className="tp-row tp-rule">
        <Mark account={d.account} />
        <div className="tp-title">{t.title}</div>
      </header>
      <div className="tp-split wide">
        <div className="tp-col">
          {to(d)}
          {text(t, d)}
          {details(d)}
        </div>
        <aside className="tp-tint tp-col">
          <span className="tp-muted">الرصيد</span>
          <b className="tp-amt tp-xl">{d.balanceNum}</b>
          <span className="tp-muted">التاريخ</span>
          <b className="num">{d.date}</b>
          <span className="tp-muted">الرقم</span>
          <b className="num">{d.no}</b>
        </aside>
      </div>
      {sign(d, 'التوقيع')}
    </>
  ),
  c13: (t, d) => (
    <>
      <div className="tp-watermark num">{d.balanceNum}</div>
      <header className="tp-row">
        <Mark account={d.account} />
        <span className="num">
          {d.no} · {d.date}
        </span>
      </header>
      <div className="tp-title tp-big" style={{ marginTop: 40 }}>
        {t.title}
      </div>
      {to(d)}
      {text(t, d)}
      {details(d)}
      {sign(d)}
    </>
  ),
  c14: (t, d) => (
    <>
      <header className="tp-row">
        <Mark account={d.account} />
        <div className="tp-title">{t.title}</div>
      </header>
      {to(d)}
      {text(t, d)}
      {details(d)}
      <div style={{ marginTop: 'auto' }}>
        <SignBox
          signature={d.signature}
          label={`توقيع وختم ${d.account.name}`}
          big
          style={{ width: '100%' }}
        />
      </div>
      <div className="tp-bottom tp-row num">
        <span>{d.no}</span>
        <span>{d.date}</span>
      </div>
    </>
  ),
  c15: (t, d) => (
    <>
      <header className="tp-center tp-rule dark">
        <Mark account={d.account} />
        <div className="tp-name">{d.account.name}</div>
        <Sub account={d.account} t={t} />
      </header>
      <div className="tp-center">
        <span className="tp-boxed">{t.title}</span>
      </div>
      <div>السادة / {d.payerName} المحترمين</div>
      {text(t, d, 'tp-letter')}
      {details(d)}
      <div>وعلى ذلك جرى التوقيع،،،</div>
      <div className="tp-row" style={{ marginTop: 'auto', alignItems: 'flex-end' }}>
        {sign(d, 'التوقيع')}
        <div className="num">
          {d.no}
          <br />
          {d.date}
        </div>
      </div>
    </>
  ),
};

/** A balance confirmation in the supplier's template. */
export function ConfirmTemplate({ t, doc }: { t: DocTemplate; doc: ConfirmDoc }) {
  const layout = LAYOUTS[t.layout] ?? LAYOUTS.c01!;
  return (
    <Sheet t={t} kind="confirm">
      {layout(t, doc)}
      <Foot t={t} />
    </Sheet>
  );
}

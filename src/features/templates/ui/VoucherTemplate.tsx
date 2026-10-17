import type { ReactNode } from 'react';
import type { Signature } from '../../ledger/domain/types';
import type { DocTemplate, VarName } from '../domain/template';
import { Body, FieldGrid, Foot, Mark, Sheet, SignBox, Sub, type DocAccount } from './parts';

/** Everything a payment voucher shows, already formatted. */
export interface VoucherDoc {
  account: DocAccount;
  payerName: string;
  /** «500 ر.س» */
  amount: string;
  /** «500» */
  amountNum: string;
  words: string;
  no: string;
  date: string;
  details: string;
  signature: Signature | null;
  /** Shown only to roles that see balances; null hides it. */
  balanceAfter: string | null;
}

const values = (d: VoucherDoc): Partial<Record<VarName, string>> => ({
  المورد: d.account.name,
  الدافع: d.payerName,
  التاريخ: d.date,
  المبلغ: d.amount,
  التفقيط: d.words,
  الرقم: d.no,
});

type Layout = (t: DocTemplate, d: VoucherDoc) => ReactNode;
const sign = (d: VoucherDoc, label = 'توقيع المستلم') => (
  <SignBox signature={d.signature} label={label} />
);
const details = (d: VoucherDoc) => (d.details ? <div>البيان: {d.details}</div> : null);
const bal = (d: VoucherDoc) =>
  d.balanceAfter ? <div className="tp-muted">الرصيد بعد السند: {d.balanceAfter}</div> : null;

const LAYOUTS: Record<string, Layout> = {
  v01: (t, d) => (
    <>
      <header className="tp-row tp-rule">
        <div className="tp-row">
          <Mark account={d.account} />
          <div>
            <div className="tp-name">{d.account.name}</div>
            <Sub account={d.account} t={t} />
          </div>
        </div>
        <div className="tp-title">{t.title}</div>
      </header>
      <div className="tp-split">
        <div className="tp-col">
          <Body text={t.body} values={values(d)} />
          <div className="tp-box">
            <div className="tp-amt tp-xl">{d.amount}</div>
            <div>{d.words}</div>
          </div>
          {details(d)}
        </div>
        <aside className="tp-side">
          <span className="tp-muted">رقم السند</span>
          <b className="num">{d.no}</b>
          <span className="tp-muted">التاريخ</span>
          <b className="num">{d.date}</b>
          {d.balanceAfter && (
            <>
              <span className="tp-muted">الرصيد بعد السند</span>
              <b className="num">{d.balanceAfter}</b>
            </>
          )}
        </aside>
      </div>
      {sign(d)}
    </>
  ),
  v02: (t, d) => (
    <>
      <div className="tp-receipt">
        <div className="tp-receipt-main">
          <div className="tp-row">
            <div className="tp-title">{t.title}</div>
            <span className="num">رقم {d.no}</span>
          </div>
          <div className="tp-line">استلمنا من: {d.payerName}</div>
          <div className="tp-line">
            مبلغ: <b>{d.amount}</b> — {d.words}
          </div>
          <div className="tp-line">التاريخ: {d.date}</div>
          {d.details && <div className="tp-line">البيان: {d.details}</div>}
          <Body text={t.body} values={values(d)} className="tp-muted" />
          <div className="tp-row" style={{ marginTop: 'auto', alignItems: 'flex-end' }}>
            <div>
              <div className="tp-name">{d.account.name}</div>
              <Sub account={d.account} t={t} />
            </div>
            {sign(d, 'التوقيع')}
          </div>
        </div>
        <div className="tp-stub">
          <Mark account={d.account} size={56} light />
          <div className="tp-amt tp-xl">{d.amountNum}</div>
          <span>ر.س</span>
          <span className="num">{d.no}</span>
        </div>
      </div>
      <div className="tp-cut">قص هنا</div>
    </>
  ),
  v03: (t, d) => (
    <>
      <header className="tp-row">
        <div className="tp-title">{t.title}</div>
        <Mark account={d.account} />
      </header>
      <FieldGrid
        rows={[
          ['المستلم', d.account.name],
          ['الدافع', d.payerName],
          ['المبلغ', <b key="a">{d.amount}</b>],
          ['كتابةً', d.words],
          ['رقم السند', d.no],
          ['التاريخ', d.date],
          ...(d.details ? ([['البيان', d.details]] as [string, ReactNode][]) : []),
          [
            'التوقيع',
            <SignBox key="s" signature={d.signature} label="" style={{ width: '100%' }} />,
          ],
        ]}
      />
      <Body text={t.body} values={values(d)} />
      {t.sub && <div className="tp-muted">{t.sub}</div>}
    </>
  ),
  v04: (t, d) => (
    <>
      <div className="tp-band tp-row">
        <div>
          <div className="tp-title light">{t.title}</div>
          <div>{d.account.name}</div>
          {t.sub && <div>{t.sub}</div>}
        </div>
        <span className="num">{d.no}</span>
      </div>
      <div className="tp-center" style={{ margin: '30px 0' }}>
        <div className="tp-muted">المبلغ المستلم</div>
        <div className="tp-amt tp-huge">{d.amountNum}</div>
        <div>ريال سعودي — {d.words}</div>
      </div>
      <Body text={t.body} values={values(d)} />
      <div className="num">
        من: {d.payerName} · {d.date}
      </div>
      {details(d)}
      {sign(d)}
    </>
  ),
  v05: (t, d) => (
    <>
      <div className="tp-cheque">
        <div className="tp-row">
          <b>{d.account.name}</b>
          <span className="num">رقم {d.no}</span>
        </div>
        <div className="tp-row">
          <span>التاريخ: {d.date}</span>
          <span className="tp-amtbox num">{d.amount}</span>
        </div>
        <div className="tp-line">استلمنا من: {d.payerName}</div>
        <div className="tp-line">مبلغ وقدره: {d.words}</div>
        {d.details && <div className="tp-line">البيان: {d.details}</div>}
        <div className="tp-row">
          <span className="tp-title">{t.title}</span>
          {sign(d, 'التوقيع')}
        </div>
      </div>
      <Body text={t.body} values={values(d)} />
      {t.sub && <div className="tp-muted">{t.sub}</div>}
    </>
  ),
  v06: (t, d) => (
    <div className="tp-panel-wrap">
      <aside className="tp-panel">
        <Mark account={d.account} size={56} light />
        <b>{t.title}</b>
        <div>
          المبلغ
          <div className="tp-amt tp-xl">{d.amountNum}</div>
          ر.س
        </div>
        <div className="num">رقم {d.no}</div>
        <div className="num">{d.date}</div>
      </aside>
      <div className="tp-col" style={{ flex: 1 }}>
        <div className="tp-name">{d.account.name}</div>
        <Sub account={d.account} t={t} />
        <Body text={t.body} values={values(d)} />
        <div>{d.words}</div>
        {details(d)}
        {bal(d)}
        <div style={{ marginTop: 'auto' }}>{sign(d, 'التوقيع')}</div>
      </div>
    </div>
  ),
  v07: (t, d) => (
    <>
      <div className="tp-frame double" />
      <div className="tp-center">
        <Mark account={d.account} />
        <div className="tp-title tp-big">{t.title}</div>
        <div className="tp-hr" />
        <div>{d.account.name}</div>
        {t.sub && <div className="tp-muted">{t.sub}</div>}
      </div>
      <Body text={t.body} values={values(d)} className="tp-pad" />
      <div className="tp-pad tp-row">
        <span className="num">رقم {d.no}</span>
        <span className="num">{d.date}</span>
      </div>
      <div className="tp-seal">{d.account.name}</div>
      <div className="tp-pad">{sign(d, 'المستلم')}</div>
    </>
  ),
  v08: (t, d) => (
    <>
      <div className="tp-muted">
        {d.account.name}
        {t.sub ? ` · ${t.sub}` : ''}
      </div>
      <div className="tp-light-title">{t.title}</div>
      <div className="tp-hr thin" />
      <div className="tp-amt tp-huge light">
        {d.amountNum}
        <small> ر.س</small>
      </div>
      <div className="tp-muted">{d.words}</div>
      <Body text={t.body} values={values(d)} />
      <div className="num">
        من {d.payerName} · {d.date} · رقم {d.no}
      </div>
      {sign(d, 'التوقيع')}
    </>
  ),
  v09: (t, d) => (
    <>
      <div className="tp-ribbon">مدفوع</div>
      <header className="tp-row">
        <Mark account={d.account} />
        <div className="tp-title">{t.title}</div>
      </header>
      <div className="tp-tint">
        <div className="tp-muted">المبلغ</div>
        <div className="tp-amt tp-xl">{d.amount}</div>
        <div>{d.words}</div>
      </div>
      <FieldGrid
        rows={[
          ['من', d.payerName],
          ['إلى', d.account.name],
          ['التاريخ', d.date],
          ['الرقم', d.no],
        ]}
      />
      <Body text={t.body} values={values(d)} />
      {sign(d, 'التوقيع')}
    </>
  ),
  v10: (t, d) => (
    <>
      <header className="tp-row tp-rule dark">
        <Mark account={d.account} />
        <div style={{ textAlign: 'left' }}>
          <div className="tp-title">{t.title}</div>
          <div className="num">رقم {d.no}</div>
        </div>
      </header>
      <div>
        الدافع: <b>{d.payerName}</b> · التاريخ: {d.date}
      </div>
      <table className="tp-table">
        <thead>
          <tr>
            <th>#</th>
            <th>البيان</th>
            <th>المبلغ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>{d.details || 'دفعة'}</td>
            <td className="num">{d.amountNum}</td>
          </tr>
          <tr className="tp-total">
            <td colSpan={2}>الإجمالي</td>
            <td className="num">{d.amount}</td>
          </tr>
        </tbody>
      </table>
      <div className="tp-muted">{d.words}</div>
      <Body text={t.body} values={values(d)} />
      {sign(d)}
    </>
  ),
  v11: (t, d) => (
    <>
      <header className="tp-center tp-rule double">
        <div className="tp-orn">❖</div>
        <Mark account={d.account} />
        <div className="tp-name">{d.account.name}</div>
        <Sub account={d.account} t={t} />
      </header>
      <div className="tp-title tp-center">{t.title}</div>
      <Body text={t.body} values={values(d)} />
      <div>فقط {d.words}</div>
      {details(d)}
      <div className="tp-row num">
        <span>الرقم {d.no}</span>
        <span>{d.date}</span>
      </div>
      {sign(d, 'المستلم')}
    </>
  ),
  v12: (t, d) => (
    <>
      {['أصل', 'صورة'].map((copy) => (
        <section key={copy} className="tp-copy">
          <div className="tp-row">
            <div className="tp-title">{t.title}</div>
            <span className="tp-muted">{copy}</span>
          </div>
          <div>{d.account.name}</div>
          <Body text={t.body} values={values(d)} />
          <div className="tp-muted">{d.words}</div>
          <div className="tp-row" style={{ marginTop: 'auto', alignItems: 'flex-end' }}>
            <span className="num">
              {d.no} · {d.date}
            </span>
            <SignBox signature={d.signature} label="التوقيع" style={{ width: '40%' }} />
          </div>
        </section>
      ))}
    </>
  ),
  v13: (t, d) => (
    <>
      <div className="tp-watermark num">{d.amountNum}</div>
      <header className="tp-row">
        <Mark account={d.account} />
        <span className="num">
          {d.no} · {d.date}
        </span>
      </header>
      <div className="tp-title tp-big" style={{ marginTop: 40 }}>
        {t.title}
      </div>
      <Body text={t.body} values={values(d)} />
      <div>{d.words}</div>
      {details(d)}
      {sign(d, `عن ${d.account.name}`)}
    </>
  ),
  v14: (t, d) => (
    <>
      <div className="tp-title tp-center">{t.title}</div>
      <div className="tp-tint">
        <div className="tp-muted">الدافع</div>
        <b>{d.payerName}</b>
      </div>
      <div className="tp-center">
        <div className="tp-amt tp-xl">{d.amount} ↓</div>
        <div className="tp-muted">{d.words}</div>
      </div>
      <div className="tp-tint">
        <div className="tp-muted">المستلم</div>
        <b>{d.account.name}</b>
        {t.sub && <div className="tp-muted">{t.sub}</div>}
      </div>
      <Body text={t.body} values={values(d)} />
      <div className="tp-row num">
        <span>{d.no}</span>
        <span>{d.date}</span>
      </div>
      {sign(d)}
    </>
  ),
  v15: (t, d) => (
    <>
      <header className="tp-row">
        <div className="tp-title">{t.title}</div>
        <div className="tp-digits">
          {d.no.split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
      </header>
      <div className="tp-cells">
        {(
          [
            ['التاريخ', d.date],
            ['المبلغ', d.amount],
            ['الدافع', d.payerName],
            ['المستلم', d.account.name],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <div className="tp-muted">{k}</div>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <div className="tp-cells one">
        <div>
          <div className="tp-muted">كتابةً</div>
          {d.words}
        </div>
      </div>
      <Body text={t.body} values={values(d)} />
      {sign(d, 'التوقيع')}
    </>
  ),
};

/** A payment voucher in the supplier's template. */
export function VoucherTemplate({ t, doc }: { t: DocTemplate; doc: VoucherDoc }) {
  const layout = LAYOUTS[t.layout] ?? LAYOUTS.v01!;
  return (
    <Sheet t={t} kind="voucher">
      {layout(t, doc)}
      <Foot t={t} />
    </Sheet>
  );
}

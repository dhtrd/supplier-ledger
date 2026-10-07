import { useState } from 'react';
import {
  MONTHS_AR,
  WEEKDAYS_AR,
  displayDate,
  monthGrid,
  parseIso,
  rangePresets,
  todayRiyadh,
  type Range,
} from '../lib/dates';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

type View = 'days' | 'months' | 'years';

/**
 * Custom Gregorian picker (approved mockup «Calendar»): month/year grids for
 * fast jumps, presets for ranges, Sunday-first weeks, today ringed in green.
 */
export function CalendarSheet(
  props:
    | {
        mode: 'single';
        value: string;
        onDone: (v: string) => void;
        onCancel: () => void;
        title?: string;
      }
    | {
        mode: 'range';
        value: Range;
        onDone: (v: Range) => void;
        onCancel: () => void;
        title?: string;
      },
) {
  const today = todayRiyadh();
  const single = props.mode === 'single';
  const initFrom = single ? props.value : props.value.from;
  const initTo = single ? props.value : props.value.to;
  const anchor = parseIso(single ? initFrom : initTo);

  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(initTo);
  const [side, setSide] = useState<'from' | 'to'>('from');
  const [view, setView] = useState<View>('days');
  const [y, setY] = useState(anchor.y);
  const [m, setM] = useState(anchor.m);

  const jumpTo = (iso: string) => {
    const p = parseIso(iso);
    setY(p.y);
    setM(p.m);
    setView('days');
  };
  const setRange = (r: Range) => {
    setFrom(r.from);
    setTo(r.to);
    jumpTo(r.to);
  };

  const pick = (d: string) => {
    if (single) {
      setFrom(d);
      setTo(d);
      return;
    }
    if (side === 'from') {
      setFrom(d);
      if (to < d) setTo(d);
      setSide('to');
    } else if (d < from) {
      setFrom(d);
    } else {
      setTo(d);
      setSide('from');
    }
  };

  const step = (dir: 1 | -1) => {
    if (view === 'years') return setY(y + 12 * dir);
    if (view === 'months') return setY(y + dir);
    let mm = m + dir;
    let yy = y;
    if (mm < 0) {
      mm = 11;
      yy--;
    } else if (mm > 11) {
      mm = 0;
      yy++;
    }
    setM(mm);
    setY(yy);
  };

  const presets = rangePresets(today);
  const base = y - (y % 12);
  const cell = (on: boolean) => ({
    minHeight: 52,
    border: `1.5px solid ${on ? 'var(--ink)' : 'var(--rule)'}`,
    borderRadius: 10,
    background: on ? 'var(--ink)' : 'transparent',
    color: on ? 'var(--paper)' : 'var(--ink)',
    fontSize: 15,
  });
  const headBtn = (on: boolean) => ({
    minHeight: 44,
    padding: '0 12px',
    border: 0,
    borderRadius: 10,
    fontFamily: 'var(--serif)',
    fontSize: 19,
    fontWeight: 700,
    background: on ? 'var(--fill)' : 'transparent',
  });
  const sideBox = (on: boolean) => ({
    minHeight: 58,
    padding: '6px 12px',
    textAlign: 'right' as const,
    borderRadius: 12,
    background: 'var(--white)',
    border: on ? '2px solid var(--ink)' : '1.5px solid var(--rule)',
  });

  const title = props.title ?? (single ? 'اختر التاريخ' : 'فترة الكشف');

  return (
    <Sheet title={title} onClose={props.onCancel}>
      {!single && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              style={sideBox(side === 'from')}
              aria-pressed={side === 'from'}
              onClick={() => {
                setSide('from');
                jumpTo(from);
              }}
            >
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                من
              </span>
              <span className="num" style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>
                {displayDate(from)}
              </span>
            </button>
            <button
              type="button"
              style={sideBox(side === 'to')}
              aria-pressed={side === 'to'}
              onClick={() => {
                setSide('to');
                jumpTo(to);
              }}
            >
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                إلى
              </span>
              <span className="num" style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>
                {displayDate(to)}
              </span>
            </button>
          </div>
          <div className="pills" role="group" aria-label="فترات جاهزة">
            <button
              type="button"
              className="pill"
              style={{ minHeight: 36, fontSize: 13 }}
              onClick={() => setRange(presets.thisMonth)}
            >
              هذا الشهر
            </button>
            <button
              type="button"
              className="pill"
              style={{ minHeight: 36, fontSize: 13 }}
              onClick={() => setRange(presets.lastMonth)}
            >
              الشهر الماضي
            </button>
            <button
              type="button"
              className="pill"
              style={{ minHeight: 36, fontSize: 13 }}
              onClick={() => setRange(presets.last3Months)}
            >
              آخر 3 أشهر
            </button>
            <button
              type="button"
              className="pill"
              style={{ minHeight: 36, fontSize: 13 }}
              onClick={() => setRange(presets.thisYear)}
            >
              هذه السنة
            </button>
            <button
              type="button"
              className="pill"
              style={{ minHeight: 36, fontSize: 13 }}
              onClick={() => setRange({ from: '2000-01-01', to: today })}
            >
              كل الفترات
            </button>
          </div>
        </>
      )}

      <div className="row-between">
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(-1)}
          aria-label={view === 'days' ? 'الشهر السابق' : 'السابق'}
        >
          <Icon name="chevR" />
        </button>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            style={headBtn(view === 'months')}
            aria-pressed={view === 'months'}
            onClick={() => setView(view === 'months' ? 'days' : 'months')}
          >
            {MONTHS_AR[m]}
          </button>
          <button
            type="button"
            className="num"
            style={headBtn(view === 'years')}
            aria-pressed={view === 'years'}
            onClick={() => setView(view === 'years' ? 'days' : 'years')}
          >
            {view === 'years' ? `${base}–${base + 11}` : y}
          </button>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(1)}
          aria-label={view === 'days' ? 'الشهر التالي' : 'التالي'}
        >
          <Icon name="chevL" />
        </button>
      </div>

      {view === 'days' && (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0,1fr))',
              gap: 2,
              textAlign: 'center',
              fontSize: 12,
            }}
            className="muted"
            aria-hidden="true"
          >
            {WEEKDAYS_AR.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0,1fr))',
              gap: 2,
              marginTop: 4,
            }}
          >
            {monthGrid(y, m).map((d, i) => {
              if (!d) return <span key={`b${i}`} />;
              const isEnd = d === from || d === to;
              const inRange = !single && d > from && d < to;
              return (
                <button
                  key={d}
                  type="button"
                  className="num"
                  onClick={() => pick(d)}
                  aria-label={`${Number(d.slice(8))} ${MONTHS_AR[m]} ${y}`}
                  aria-pressed={isEnd}
                  style={{
                    minHeight: 44,
                    border: 0,
                    borderRadius: inRange ? 4 : 10,
                    fontSize: 15,
                    background: isEnd ? 'var(--ink)' : inRange ? 'var(--fill)' : 'transparent',
                    color: isEnd ? 'var(--paper)' : 'var(--ink)',
                    fontWeight: isEnd ? 600 : 400,
                    boxShadow: d === today && !isEnd ? 'inset 0 0 0 1.5px var(--lah)' : 'none',
                  }}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {view === 'months' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
          {MONTHS_AR.map((name, i) => (
            <button
              key={name}
              type="button"
              style={cell(i === m)}
              onClick={() => {
                setM(i);
                setView('days');
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {view === 'years' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
          {Array.from({ length: 12 }, (_, i) => base + i).map((yy) => (
            <button
              key={yy}
              type="button"
              className="num"
              style={cell(yy === y)}
              onClick={() => {
                setY(yy);
                setView('months');
              }}
            >
              {yy}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            props.mode === 'single' ? props.onDone(from) : props.onDone({ from, to })
          }
        >
          {single ? `اختيار ${displayDate(from)}` : 'تطبيق الفترة'}
        </button>
        <button type="button" className="btn" onClick={props.onCancel}>
          إلغاء
        </button>
      </div>
    </Sheet>
  );
}

import { formatAmount } from '../lib/money';

// Official Saudi riyal symbol (SAMA, 2025), drawn inline so it renders without a font.
const PATH =
  'M750,1119C730,1163,716,1211,711,1262L1136,1172C1156,1127,1169,1079,1174,1028L750,1119Z M1136,901C1156,857,1169,809,1174,758L843,828L843,693L1136,631C1156,587,1169,538,1174,488L843,558L843,72C793,100,748,138,711,183L711,586L579,614L579,6C528,34,483,72,447,117L447,642L151,705C131,750,117,798,112,849L447,777L447,948L88,1024C68,1068,55,1117,50,1167L425,1088C456,1081,482,1063,499,1038L568,936C575,926,579,913,579,899L579,749L711,721L711,992L1136,901Z';

export function RiyalSign({ size = '0.68em' }: { size?: string | number }) {
  return (
    <svg
      viewBox="40 0 1145 1270"
      width={size}
      height={size}
      fill="currentColor"
      role="img"
      aria-label="ريال سعودي"
      style={{ verticalAlign: '-0.05em', marginInlineStart: '0.2em', flex: '0 0 auto' }}
    >
      <path d={PATH} />
    </svg>
  );
}

/** "7,750 ﷼" — amount in halalas with the riyal symbol. */
export function Money({ halalas, abs = false }: { halalas: number; abs?: boolean }) {
  return (
    <span className="num" style={{ whiteSpace: 'nowrap' }}>
      {formatAmount(abs ? Math.abs(halalas) : halalas)}
      <RiyalSign />
    </span>
  );
}

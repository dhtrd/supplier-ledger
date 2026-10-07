/** Approved logo «أ · الدفتر المفتوح» (same drawing as public/favicon.svg). */
export function BrandMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ flex: 'none', display: 'block' }}
    >
      <rect width="64" height="64" rx="14" fill="#1B2A3A" />
      <path d="M32 18c-5-4-12-5-19-4v32c7-1 14 0 19 4z" fill="#F4F1EA" />
      <path d="M32 18c5-4 12-5 19-4v32c-7-1-14 0-19 4z" fill="#F4F1EA" />
      <path d="M32 18v32" stroke="#1B2A3A" strokeWidth="2" />
      <path
        d="M17 24h11M17 30h11M17 36h11"
        stroke="#B9B2A3"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M37 24h10M37 30h10M37 36h7"
        stroke="#1F6F5C"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const APP_NAME = 'دفتر الموردين';

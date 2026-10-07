const PATHS = {
  back: 'M9 5l7 7-7 7',
  ledger: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM5 17a3 3 0 0 1 3-3h11M9 8h6',
  users:
    'M2.5 20c.6-3.3 3.3-5.5 6.5-5.5s5.9 2.2 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.2 2.5 3.5 5.2',
  settings:
    'M12 2.8l1.7 2.3 2.8-.5.9 2.7 2.6 1.2-.6 2.8 1.6 2.4-2.2 1.8.1 2.8-2.8.6-1.3 2.5-2.7-1-2.7 1-1.3-2.5-2.8-.6.1-2.8L2.9 14.3l1.6-2.4-.6-2.8 2.6-1.2.9-2.7 2.8.5z',
  calendar: 'M3.5 9.5h17M8 3v4M16 3v4',
  clip: 'M21 12.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
  image: 'M21 16l-5-5-9 9',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 7.5V12l3 2',
  chevL: 'M15 6l-6 6 6 6',
  chevR: 'M9 6l6 6-6 6',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  whatsapp:
    'M4 20l1.3-4A8 8 0 1 1 8.4 19L4 20zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1c-1.2-.5-2.3-1.6-2.8-2.8l1-1-1-2L9 8.5z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  plus: 'M12 5v14M5 12h14',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 22,
  label,
}: {
  name: IconName;
  size?: number;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      style={{ flex: '0 0 auto' }}
    >
      {name === 'users' && <circle cx="9" cy="8" r="3.5" />}
      {name === 'settings' && <circle cx="12" cy="12" r="3" />}
      {name === 'calendar' && <rect x="3.5" y="5" width="17" height="15" rx="2" />}
      {name === 'camera' && <circle cx="12" cy="13" r="3.5" />}
      {name === 'image' && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="2" />
        </>
      )}
      {name === 'clock' && <circle cx="12" cy="12" r="8.5" />}
      <path d={PATHS[name]} />
    </svg>
  );
}

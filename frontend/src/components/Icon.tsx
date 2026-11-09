// A small set of line icons drawn for Boardwise (24px grid, 1.75 stroke, round ends).
// Decorative: the button or link around an icon carries the accessible name.

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  more: '', // three dots, drawn below
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14',
  close: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'M14.5 6 8.5 12l6 6',
  chevronRight: 'M9.5 6l6 6-6 6',
  arrowUp: 'M12 19V5m0 0-6 6m6-6 6 6',
  mic: 'M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  stop: 'M7.5 7.5h9v9h-9z',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  lock: 'M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13v10h-13z',
  exit: 'M10.5 4.5h-5v15h5M14 8l4 4-4 4M18 12H9',
  phone: 'M6.6 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.1 6.1l1.3-2 4 1.5v3a2 2 0 0 1-2.1 2A16.5 16.5 0 0 1 4.6 5.6a2 2 0 0 1 2-2.1Z',
  scale: 'M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0L5 7Zm14 0-2.5 6a2.5 2.5 0 0 0 5 0L19 7Z',
  timeline: 'M6 5v14M6 7h.01M6 12h.01M6 17h.01M10 7h8M10 12h6M10 17h8',
  list: 'M9 7h10M9 12h10M9 17h10M4.5 7l.8.8 1.7-1.6M4.5 12l.8.8 1.7-1.6M4.5 17l.8.8 1.7-1.6',
  chat: 'M5 5.5h14v10H11l-4 3.5v-3.5H5z M8.5 9.5h7M8.5 12.5h4',
  pencil: 'M15.5 5.5l3 3L9 18H6v-3l9.5-9.5Z',
} as const

export type IconName = keyof typeof PATHS

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'more' ? (
        <g fill="currentColor" stroke="none">
          <circle cx="5.5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="18.5" cy="12" r="1.6" />
        </g>
      ) : (
        <path d={PATHS[name]} />
      )}
    </svg>
  )
}

export default Icon

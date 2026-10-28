// Iconos de trazo (24 × 24, línea de 1.6 px). Sólo dibujan; el significado lo da el texto que los acompaña.
const PATHS = {
  'folder-open': 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  'folder-plus': 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z M12 10.5v5 M9.5 13h5',
  file: 'M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M14 3v4h4',
  save: 'M5 4h11l3 3v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 4v5h7V4 M8 20v-6h8v6',
  download: 'M12 4v11 M7.5 11 12 15.5 16.5 11 M5 19.5h14',
  tools:
    'M5 6h8 M17 6h2 M5 12h2 M11 12h8 M5 18h8 M17 18h2 M13 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M7 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M13 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  swap: 'M7 7h12 M16 4l3 3-3 3 M17 17H5 M8 14l-3 3 3 3',
  vertices:
    'M5 17l5-8 4 5 5-8 M3.5 17a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M8.5 9a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M12.5 14a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M17.5 6a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0',
  simplify: 'M4 12h16 M8.5 6.5 12 10l3.5-3.5 M8.5 17.5 12 14l3.5 3.5',
  streets: 'M8 21 10 3 M16 21 14 3 M12 6v2.5 M12 11v2.5 M12 16.5V19',
  restore: 'M4 12a8 8 0 1 0 2.6-5.9 M4 4.5V10h5.5',
  undo: 'M9 14 4 9l5-5 M4 9h9a6 6 0 0 1 0 12h-3',
  locate: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  opacity: 'M12 4c3 4 6 6.6 6 10a6 6 0 0 1-12 0c0-3.4 3-6 6-10z',
  layers: 'M12 4 3 9l9 5 9-5-9-5z M3 14l9 5 9-5',
  map: 'M9 5 4 7v12l5-2 6 2 5-2V5l-5 2-6-2z M9 5v12 M15 7v12',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  'eye-off': 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M4 4l16 16',
  x: 'M6 6l12 12 M18 6 6 18',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-left': 'M15 6l-6 6 6 6',
  plus: 'M12 5v14 M5 12h14',
  help: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0 M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7 M12 17.2h.01',
  keyboard: 'M3 6.5h18v11H3z M7 10.5h.01 M11 10.5h.01 M15 10.5h.01 M7 14.5h10',
  book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h10',
  sun: 'M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0 M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4 3 20h18z M12 10v4 M12 17h.01',
  info: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0 M12 11v5 M12 8h.01',
  pencil: 'M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z M14 7l3 3',
  split: 'M12 4v6 M12 10 6 20 M12 10l6 10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14 M16 5v14',
  stop: 'M7 7h10v10H7z',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9 M20 4.5V10h-5.5',
  chat: 'M4 5h16v11H10l-4 4v-4H4z',
  queue: 'M5 6h14 M5 12h14 M5 18h9',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  'arrow-up': 'M12 19V5 M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14 M6 13l6 6 6-6',
  copy: 'M9 9h11v11H9z M5 15V4h11',
  sparkles:
    'M10 4l1.8 5.2L17 11l-5.2 1.8L10 18l-1.8-5.2L3 11l5.2-1.8z M18 3l.7 1.8L20.5 5.5l-1.8.7L18 8l-.7-1.8L15.5 5.5l1.8-.7z M18 15l.7 1.8 1.8.7-1.8.7L18 20l-.7-1.8-1.8-.7 1.8-.7z',
  compare: 'M4 8h13 M14 5l3 3-3 3 M20 16H7 M10 13l-3 3 3 3',
} as const;

export type IconName = keyof typeof PATHS;

interface Props {
  name: IconName;
  size?: number;
  /** Sólo si el icono va solo, sin texto al lado. */
  title?: string;
}

export function Icon({ name, size = 16, title }: Props) {
  return (
    <svg
      className="icon-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

import type { ReactNode } from 'react';

const paths = {
  settings: <><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></>,
  camera: <><rect x="3" y="6" width="18" height="15" rx="5"/><path d="m8 6 1-3h6l1 3"/><circle cx="12" cy="13" r="4"/></>,
  play: <path d="M8 4.5a1 1 0 0 0-1.5.9v13.2a1 1 0 0 0 1.5.9l11-6.6a1 1 0 0 0 0-1.8Z"/>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  stop: <rect x="5" y="5" width="14" height="14" rx="4"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="4"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="4"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/></>,
  sound: <><path d="m11 4-5 4H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></>,
  mute: <><path d="m11 4-5 4H3v8h3l5 4ZM16 9l5 6M21 9l-5 6"/></>,
  location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  back: <path d="m13 5-7 7 7 7M6 12h15"/>,
  arrow: <path d="m11 5 7 7-7 7M3 12h15"/>,
  library: <><rect x="6" y="7" width="15" height="14" rx="4"/><path d="M16 3H7a4 4 0 0 0-4 4v9m9-5 4 3-4 3Z"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><path d="M12 9v6"/></>,
  head: <><path d="M7 21v-4c-3-1-4-4-4-7a7 7 0 0 1 14-1l3 5h-3v4h-5v3M11 9v2"/></>,
  pip: <><rect x="2" y="4" width="20" height="16" rx="4"/><rect x="12" y="11" width="7" height="6" rx="2"/></>,
} satisfies Record<string, ReactNode>;

export function WakeIcon({name, className = ''}: {name: keyof typeof paths; className?: string}) {
  return <svg className={`wake-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export function WakeMascot({className = ''}: {className?: string}) {
  return <img className={`wake-mascot ${className}`} src="/brand/wake-drive-mascot.svg" width="180" height="160" alt="" aria-hidden="true" draggable={false}/>;
}

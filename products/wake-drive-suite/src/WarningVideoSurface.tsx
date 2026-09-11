import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from './language';
import './warning-video-surface.css';

// Keep the player mounted between warnings so the existing playback refs and recovery stay intact.
export function WarningVideoSurface({ fullscreen, playing, compact, onDismiss, children }: {
  fullscreen: boolean; playing: boolean; compact: boolean; onDismiss: () => void; children: ReactNode;
}) {
  const surface = <div className={`wake-up-overlay ${playing ? 'playing' : ''} ${fullscreen ? 'driver-video-fullscreen' : ''} ${compact ? 'is-compact' : ''}`} aria-hidden={!playing}>
    {children}
    {fullscreen && playing && !compact && <button className="driver-video-dismiss" onClick={onDismiss} aria-label={t('닫기')}>✕</button>}
  </div>;
  return fullscreen ? createPortal(surface, document.body) : surface;
}

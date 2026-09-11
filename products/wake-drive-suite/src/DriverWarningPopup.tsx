import { useEffect } from 'react';
import type { WakeUpReason } from './wakeUpVideos';

export function repeatWarningTone(pulse: () => void): () => void {
  pulse();
  const timer = setInterval(pulse, 2500);
  return () => clearInterval(timer);
}
export function DriverWarningPopup({reason, soundEnabled, onPulse, onDismiss}: {
  reason: WakeUpReason | 'TEST'; soundEnabled: boolean; onPulse: () => void; onDismiss: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown',close);
    return () => window.removeEventListener('keydown',close);
  }, [onDismiss]);
  useEffect(() => soundEnabled ? repeatWarningTone(onPulse) : undefined, [soundEnabled,onPulse]);
  return <section className="driver-warning-popup" role="alertdialog" aria-labelledby="driver-warning-title" aria-describedby="driver-warning-description">
    <span aria-hidden="true">⚠</span><h2 id="driver-warning-title">{reason === 'TEST' ? 'Alert test' : 'Stay alert!'}</h2>
    <p id="driver-warning-description">{reason === 'TEST' ? 'This is a test. Real drowsiness alerts use this popup and warning tone.' : `${reason === 'HEAD' ? 'Your head has been down.' : reason === 'COMBINED' ? 'Your eyes are closing and your head is down.' : 'Your eyes have been closed.'} Stop in a safe place and take a break.`}</p>
    <small>{soundEnabled ? 'Warning tone repeats. Check the device volume.' : 'Sound is off. Enable alerts before your next drive.'}</small>
    <button autoFocus onClick={onDismiss}>Dismiss warning</button>
  </section>;
}

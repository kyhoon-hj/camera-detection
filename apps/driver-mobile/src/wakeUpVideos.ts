export const WAKE_UP_VIDEO_PATHS = [
  "/media/wake-up-no-text.mp4",
  "/media/wake-up-beep.mp4",
  "/media/wake-up-driver.mp4",
  "/media/wake-up-driver-warning.mp4",
  "/media/wake-up-grim-reaper.mp4",
] as const;

export function chooseWakeUpVideo(
  current: string | null,
  random: () => number = Math.random,
): string {
  const candidates = current === null
    ? [...WAKE_UP_VIDEO_PATHS]
    : WAKE_UP_VIDEO_PATHS.filter((path) => path !== current);
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[Math.max(0, index)];
}

export interface WakeUpDecisionInput {
  eyeAlertActive: boolean;
  eyeAlertWasActive: boolean;
  headAlertActive: boolean;
  headAlertWasActive: boolean;
  eyeClosureCount: number;
}

export function getWakeUpDecision(input: WakeUpDecisionInput): {
  eyeClosureCount: number;
  reason: "EYES" | "HEAD" | null;
} {
  const newEyeEvent = input.eyeAlertActive && !input.eyeAlertWasActive;
  const newHeadEvent = input.headAlertActive && !input.headAlertWasActive;
  const eyeClosureCount = input.eyeClosureCount + (newEyeEvent ? 1 : 0);
  return {
    eyeClosureCount,
    reason: newHeadEvent ? "HEAD" : newEyeEvent && eyeClosureCount >= 3 ? "EYES" : null,
  };
}

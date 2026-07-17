export function normalizeSpeech(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function shouldAnnounce(previous: string, next: string, lastSpokenAt: number, now: number, repeatAfterMs = 12000) {
  const normalized = normalizeSpeech(next);
  if (!normalized) return false;
  return normalizeSpeech(previous) !== normalized || now - lastSpokenAt >= repeatAfterMs;
}

const LOCAL_ACTION_SPEECH:Record<string,string> = {
  OPEN_PALM:"현재 손바닥을 펴고 있어요.",
  CLOSED_FIST:"현재 주먹을 쥐고 있어요.",
  POINTING_UP:"현재 손가락 하나를 들고 있어요.",
  VICTORY:"현재 손가락 두 개를 펴고 있어요.",
  THUMB_UP:"현재 엄지를 들어 올리고 있어요.",
  HAND_WAVE:"현재 손을 흔들고 있어요.",
  RAISE_HAND:"현재 손을 들고 있어요.",
  SWIPE_LEFT:"현재 손을 왼쪽으로 움직였어요.",
  SWIPE_RIGHT:"현재 손을 오른쪽으로 움직였어요.",
  HEAD_NOD:"현재 고개를 끄덕였어요.",
  HEAD_SHAKE:"현재 고개를 좌우로 흔들었어요.",
};

export function localActionSpeech(code?:string | null) {
  return code ? LOCAL_ACTION_SPEECH[code] ?? "" : "";
}

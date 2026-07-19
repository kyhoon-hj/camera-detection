export type SignPhrase = {
  id: string;
  domain: string;
  gloss: string;
  text: string;
  emergency?: boolean;
};

export type PersonalSignLibrary = Record<string, number[][]>;
export type PersonalSignCandidate = SignPhrase & { confidence: number; sampleCount: number };

export const SIGN_PHRASES: SignPhrase[] = [
  { id: "HELP_NEEDED", domain: "긴급", gloss: "도움 / 필요", text: "도움이 필요합니다.", emergency: true },
  { id: "AMBULANCE", domain: "긴급", gloss: "구급차 / 부탁", text: "구급차를 불러주세요.", emergency: true },
  { id: "POLICE", domain: "긴급", gloss: "경찰 / 부탁", text: "경찰을 불러주세요.", emergency: true },
  { id: "FIRE", domain: "긴급", gloss: "화재", text: "화재입니다.", emergency: true },
  { id: "DANGER", domain: "긴급", gloss: "위험", text: "위험합니다.", emergency: true },
  { id: "HOSPITAL", domain: "병원", gloss: "병원", text: "병원에 가고 싶습니다." },
  { id: "PAIN", domain: "병원", gloss: "아프다", text: "아픕니다." },
  { id: "DIZZY", domain: "병원", gloss: "어지럽다", text: "어지럽습니다." },
  { id: "ALLERGY", domain: "병원", gloss: "알레르기", text: "알레르기가 있습니다." },
  { id: "MEDICATION", domain: "병원", gloss: "복용 / 약", text: "복용 중인 약이 있습니다." },
  { id: "HELLO", domain: "일상", gloss: "안녕", text: "안녕하세요." },
  { id: "THANK_YOU", domain: "일상", gloss: "감사", text: "감사합니다." },
  { id: "YES", domain: "일상", gloss: "네", text: "네." },
  { id: "NO", domain: "일상", gloss: "아니요", text: "아니요." },
  { id: "WHERE", domain: "일상", gloss: "어디", text: "어디에 있나요?" },
  { id: "EXIT", domain: "교통", gloss: "출구 / 어디", text: "출구가 어디인가요?" },
  { id: "DESTINATION", domain: "교통", gloss: "목적지 / 방법", text: "목적지에 가는 방법을 알려주세요." },
  { id: "PAYMENT", domain: "결제", gloss: "결제", text: "결제하려고 합니다." },
  { id: "PAYMENT_ERROR", domain: "결제", gloss: "결제 / 오류", text: "결제 오류를 확인해주세요." },
  { id: "DISCOUNT", domain: "결제", gloss: "할인", text: "할인을 받고 싶습니다." },
];

export function summarizeSignSequence(frames: number[][], targetFrames = 12): number[] {
  if (frames.length < 3) throw new Error("수어 동작 프레임이 부족합니다.");
  const width = frames[0].length;
  if (!width || frames.some((frame) => frame.length !== width)) throw new Error("수어 특징 크기가 일치하지 않습니다.");
  const sampled: number[] = [];
  for (let step = 0; step < targetFrames; step++) {
    const position = targetFrames === 1 ? 0 : step * (frames.length - 1) / (targetFrames - 1);
    const left = Math.floor(position);
    const right = Math.min(frames.length - 1, left + 1);
    const ratio = position - left;
    for (let index = 0; index < width; index++) sampled.push(frames[left][index] * (1 - ratio) + frames[right][index] * ratio);
  }
  return sampled;
}

export function addPersonalSample(library: PersonalSignLibrary, phraseId: string, sequence: number[][]): PersonalSignLibrary {
  const summary = summarizeSignSequence(sequence);
  return { ...library, [phraseId]: [...(library[phraseId] ?? []), summary].slice(-5) };
}

export function rankPersonalSigns(sequence: number[][], library: PersonalSignLibrary, limit = 3): PersonalSignCandidate[] {
  const summary = summarizeSignSequence(sequence);
  return SIGN_PHRASES.flatMap((phrase) => {
    const prototypes = library[phrase.id] ?? [];
    if (prototypes.length < 3) return [];
    const distance = Math.min(...prototypes.filter((item) => item.length === summary.length).map((item) => rmsDistance(summary, item)));
    if (!Number.isFinite(distance)) return [];
    const confidence = Math.max(0, Math.min(0.99, 1 - distance / 1.35));
    return [{ ...phrase, confidence, sampleCount: prototypes.length }];
  }).sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

function rmsDistance(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index++) {
    const delta = left[index] - right[index];
    total += delta * delta;
  }
  return Math.sqrt(total / left.length);
}

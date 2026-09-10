export interface VoiceProfile {
  label: string;
  description: string;
  sample: string;
  rate: number;
  pitch: number;
  preferredVoiceNames: string[];
}

export const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  label: "기본 안내 음성",
  description: "부드럽고 편안한 한국어 안내",
  sample: "안녕하세요. 안전 운전을 위한 기본 안내 음성입니다.",
  rate: 1,
  pitch: 1,
  preferredVoiceNames: ["sunhi", "heami", "korean", "한국어"],
};

export function chooseKoreanVoice<T extends { lang: string; name: string }>(voices: readonly T[]): T | undefined {
  const koreanVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("ko"));
  return koreanVoices.find((voice) => {
    const name = voice.name.toLowerCase();
    return DEFAULT_VOICE_PROFILE.preferredVoiceNames.some((keyword) => name.includes(keyword));
  }) ?? koreanVoices[0];
}

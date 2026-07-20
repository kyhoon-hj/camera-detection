export type VoiceProfileId = "FEMALE" | "MALE" | "CHILD" | "CUTE";

export interface VoiceProfile {
  id: VoiceProfileId;
  label: string;
  description: string;
  sample: string;
  rate: number;
  pitch: number;
  preferredVoiceNames: string[];
}

export const DEFAULT_VOICE_PROFILE: VoiceProfileId = "FEMALE";

export const VOICE_PROFILES: readonly VoiceProfile[] = [
  {
    id: "FEMALE",
    label: "부드러운 기본톤",
    description: "자연스럽고 편안한 기본 안내",
    sample: "안녕하세요. 부드럽고 편안한 톤으로 안내해 드릴게요.",
    rate: 1,
    pitch: 1.08,
    preferredVoiceNames: ["sunhi", "heami", "female", "여성"],
  },
  {
    id: "MALE",
    label: "차분한 저음",
    description: "낮고 느긋한 안정형 안내",
    sample: "안녕하세요. 낮고 차분한 톤으로 안내해 드릴게요.",
    rate: 0.94,
    pitch: 0.82,
    preferredVoiceNames: ["injoon", "male", "남성"],
  },
  {
    id: "CHILD",
    label: "밝은 고음",
    description: "조금 높고 경쾌한 밝은 안내",
    sample: "안녕하세요. 밝고 경쾌한 톤으로 안내해 드릴게요.",
    rate: 1.08,
    pitch: 1.32,
    preferredVoiceNames: ["child", "kid", "아동", "어린이"],
  },
  {
    id: "CUTE",
    label: "발랄한 캐릭터톤",
    description: "가장 높고 빠른 캐릭터형 안내",
    sample: "안녕하세요. 발랄한 캐릭터 톤으로 즐겁게 안내해 드릴게요.",
    rate: 1.12,
    pitch: 1.5,
    preferredVoiceNames: ["cute", "character", "캐릭터"],
  },
] as const;

export function normalizeVoiceProfile(value: unknown): VoiceProfileId {
  return VOICE_PROFILES.some((profile) => profile.id === value) ? value as VoiceProfileId : DEFAULT_VOICE_PROFILE;
}

export function getVoiceProfile(id: VoiceProfileId): VoiceProfile {
  return VOICE_PROFILES.find((profile) => profile.id === id) ?? VOICE_PROFILES[0];
}

export function chooseKoreanVoice<T extends { lang: string; name: string }>(voices: readonly T[], profileId: VoiceProfileId): T | undefined {
  const koreanVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("ko"));
  const profile = getVoiceProfile(profileId);
  return koreanVoices.find((voice) => {
    const name = voice.name.toLowerCase();
    return profile.preferredVoiceNames.some((keyword) => name.includes(keyword));
  }) ?? koreanVoices[0];
}

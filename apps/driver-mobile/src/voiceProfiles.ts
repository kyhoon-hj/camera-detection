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
    label: "여성",
    description: "편안하고 또렷한 안내",
    sample: "안녕하세요. 편안한 여성 목소리로 안내해 드릴게요.",
    rate: 1,
    pitch: 1.08,
    preferredVoiceNames: ["sunhi", "heami", "female", "여성"],
  },
  {
    id: "MALE",
    label: "남성",
    description: "차분하고 안정적인 안내",
    sample: "안녕하세요. 차분한 남성 목소리로 안내해 드릴게요.",
    rate: 0.94,
    pitch: 0.82,
    preferredVoiceNames: ["injoon", "male", "남성"],
  },
  {
    id: "CHILD",
    label: "아이",
    description: "밝고 부드러운 안내",
    sample: "안녕하세요. 밝은 아이 목소리로 함께할게요.",
    rate: 1.08,
    pitch: 1.32,
    preferredVoiceNames: ["child", "kid", "아동", "어린이"],
  },
  {
    id: "CUTE",
    label: "귀여운 목소리",
    description: "발랄하고 친근한 안내",
    sample: "안녕하세요. 귀여운 목소리로 즐겁게 안내해 드릴게요.",
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

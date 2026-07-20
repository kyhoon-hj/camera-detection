import { describe, expect, it } from "vitest";
import { chooseKoreanVoice, getVoiceProfile, normalizeVoiceProfile } from "../src/voiceProfiles";

describe("voice profiles", () => {
  it("keeps supported profiles and falls back to female", () => {
    expect(normalizeVoiceProfile("CUTE")).toBe("CUTE");
    expect(normalizeVoiceProfile("UNKNOWN")).toBe("FEMALE");
  });

  it("provides distinct rate and pitch settings", () => {
    expect(getVoiceProfile("MALE").pitch).toBeLessThan(getVoiceProfile("FEMALE").pitch);
    expect(getVoiceProfile("CUTE").pitch).toBeGreaterThan(getVoiceProfile("CHILD").pitch);
  });

  it("describes profiles by tone instead of implied speaker identity", () => {
    expect(getVoiceProfile("FEMALE").label).toBe("부드러운 기본톤");
    expect(getVoiceProfile("MALE").label).toBe("차분한 저음");
    expect(getVoiceProfile("CHILD").label).toBe("밝은 고음");
    expect(getVoiceProfile("CUTE").label).toBe("발랄한 캐릭터톤");
  });

  it("prefers a matching Korean voice name", () => {
    const voices = [
      { lang: "en-US", name: "English" },
      { lang: "ko-KR", name: "Microsoft InJoon" },
      { lang: "ko-KR", name: "Microsoft SunHi" },
    ];
    expect(chooseKoreanVoice(voices, "MALE")?.name).toBe("Microsoft InJoon");
    expect(chooseKoreanVoice(voices, "FEMALE")?.name).toBe("Microsoft SunHi");
  });
});

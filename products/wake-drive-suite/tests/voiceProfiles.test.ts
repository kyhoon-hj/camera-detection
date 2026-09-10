import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_PROFILE, chooseKoreanVoice } from "../src/voiceProfiles";

describe("voice profiles", () => {
  it("하나의 기본 한국어 안내 음성만 제공한다", () => {
    expect(DEFAULT_VOICE_PROFILE.label).toBe("기본 안내 음성");
    expect(DEFAULT_VOICE_PROFILE.rate).toBe(1);
    expect(DEFAULT_VOICE_PROFILE.pitch).toBe(1);
  });

  it("기본 한국어 음성 이름을 우선 선택한다", () => {
    const voices = [
      { lang: "en-US", name: "English" },
      { lang: "ko-KR", name: "Microsoft InJoon" },
      { lang: "ko-KR", name: "Microsoft SunHi" },
    ];
    expect(chooseKoreanVoice(voices)?.name).toBe("Microsoft SunHi");
  });

  it("일치하는 이름이 없으면 첫 번째 한국어 음성을 사용한다", () => {
    const voices = [
      { lang: "en-US", name: "English" },
      { lang: "ko-KR", name: "기본 한국어" },
    ];
    expect(chooseKoreanVoice(voices)?.name).toBe("기본 한국어");
  });
});

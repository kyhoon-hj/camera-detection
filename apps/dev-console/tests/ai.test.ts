import { describe, expect, it } from "vitest";
import { localActionSpeech, normalizeSpeech, shouldAnnounce } from "../src/ai";

describe("Gemini voice guidance", () => {
  it("normalizes whitespace and ignores an empty message", () => {
    expect(normalizeSpeech("  웃고   있어요 ")).toBe("웃고 있어요");
    expect(shouldAnnounce("", "   ", 0, 1000)).toBe(false);
  });

  it("announces a changed observation immediately", () => {
    expect(shouldAnnounce("웃고 있어요", "손으로 세모를 만들었어요", 1000, 1200)).toBe(true);
  });

  it("suppresses the same observation until the repeat window expires", () => {
    expect(shouldAnnounce("웃고 있어요", "웃고 있어요", 1000, 9000)).toBe(false);
    expect(shouldAnnounce("웃고 있어요", "웃고 있어요", 1000, 13000)).toBe(true);
  });

  it("provides a local spoken fallback when the free Gemini quota is unavailable", () => {
    expect(localActionSpeech("CLOSED_FIST")).toBe("현재 주먹을 쥐고 있어요.");
    expect(localActionSpeech("THUMB_UP")).toBe("현재 엄지를 들어 올리고 있어요.");
    expect(localActionSpeech("UNKNOWN")).toBe("");
  });
});

import { describe, expect, it, vi } from "vitest";
import { playKoreanTts, selectKoreanVoice, type TtsPlayback } from "../src/kslTts";

const voices = [
  {name:"English", lang:"en-US"},
  {name:"Korean Yuna Female", lang:"ko-KR"},
  {name:"Korean Hyunsu Male", lang:"ko-KR"},
];

describe("KSL Korean TTS", () => {
  it("selects a Korean voice using the requested preference", () => {
    expect(selectKoreanVoice(voices, "SYSTEM_KOREAN")?.name).toBe("Korean Yuna Female");
    expect(selectKoreanVoice(voices, "MALE_PREFERRED")?.name).toBe("Korean Hyunsu Male");
  });

  it("applies bounded rate and replaces current speech for replay", () => {
    const cancel = vi.fn();
    const speak = vi.fn();
    const request:TtsPlayback = {
      utteranceId:"one",
      text:"병원 위치를 알려주세요.",
      language:"ko-KR",
      voicePreference:"FEMALE_PREFERRED",
      rate:2.5,
      replay:false,
    };
    const utterance = playKoreanTts(
      {cancel, speak, getVoices:()=>voices},
      request,
      () => ({lang:"", rate:1, voice:null}),
    );
    expect(utterance.lang).toBe("ko-KR");
    expect(utterance.rate).toBe(2);
    expect(utterance.voice?.name).toContain("Female");
    expect(cancel).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledWith(utterance);
  });
});

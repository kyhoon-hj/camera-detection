import { Capacitor, registerPlugin } from "@capacitor/core";
import { chooseKoreanVoice, getVoiceProfile, type VoiceProfileId } from "./voiceProfiles";

interface NativeSpeechStatus {
  ready: boolean;
  languageAvailable: boolean;
  voiceName?: string;
  error?: string;
}

interface NativeSpeechPlugin {
  speak(options: { text: string; rate?: number; pitch?: number }): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<NativeSpeechStatus>;
}

const NativeSpeech = registerPlugin<NativeSpeechPlugin>("NativeSpeech");

export async function speakKorean(text: string, profileId: VoiceProfileId = "FEMALE"): Promise<void> {
  const profile = getVoiceProfile(profileId);
  if (Capacitor.getPlatform() === "android") {
    await NativeSpeech.speak({ text, rate: profile.rate, pitch: profile.pitch });
    return;
  }
  await speakWithBrowser(text, profileId);
}

export async function stopKoreanSpeech(): Promise<void> {
  if (Capacitor.getPlatform() === "android") {
    await NativeSpeech.stop().catch(() => undefined);
    return;
  }
  window.speechSynthesis?.cancel();
}

export async function getKoreanSpeechStatus(): Promise<NativeSpeechStatus> {
  if (Capacitor.getPlatform() === "android") return NativeSpeech.getStatus();
  if (!("speechSynthesis" in window)) {
    return { ready: false, languageAvailable: false, error: "이 브라우저는 음성 안내를 지원하지 않습니다." };
  }
  const voices = window.speechSynthesis.getVoices();
  return {
    ready: true,
    languageAvailable: voices.length === 0 || voices.some((voice) => voice.lang.toLowerCase().startsWith("ko")),
  };
}

function speakWithBrowser(text: string, profileId: VoiceProfileId): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("이 브라우저는 음성 안내를 지원하지 않습니다."));
      return;
    }

    const synthesis = window.speechSynthesis;
    const profile = getVoiceProfile(profileId);
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const koreanVoice = chooseKoreanVoice(synthesis.getVoices(), profileId);
    if (koreanVoice) utterance.voice = koreanVoice;
    utterance.lang = "ko-KR";
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.volume = 1;
    utterance.onstart = () => resolve();
    utterance.onerror = (event) => reject(new Error(`음성 엔진 오류: ${event.error}`));
    synthesis.speak(utterance);
  });
}

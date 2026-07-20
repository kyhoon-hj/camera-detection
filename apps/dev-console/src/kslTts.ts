export type VoicePreference = "SYSTEM_KOREAN" | "FEMALE_PREFERRED" | "MALE_PREFERRED";

export type TtsPlayback = {
  utteranceId:string;
  text:string;
  language:string;
  voicePreference:VoicePreference;
  rate:number;
  replay:boolean;
};

type VoiceLike = {name:string; lang:string};
type UtteranceLike = {lang:string; rate:number; voice:VoiceLike|null};
type SynthesisLike = {
  cancel:()=>void;
  speak:(utterance:UtteranceLike)=>void;
  getVoices:()=>VoiceLike[];
};

const FEMALE_HINTS = ["female", "woman", "유나", "선희", "heami", "yuna", "sora"];
const MALE_HINTS = ["male", "man", "민준", "인준", "hyunsu", "joon"];

export function selectKoreanVoice(voices:VoiceLike[], preference:VoicePreference):VoiceLike|null {
  const korean = voices.filter(voice => voice.lang.toLowerCase().startsWith("ko"));
  if (!korean.length) return null;
  const hints = preference === "FEMALE_PREFERRED" ? FEMALE_HINTS : preference === "MALE_PREFERRED" ? MALE_HINTS : [];
  return hints.length
    ? korean.find(voice => {
      const words = voice.name.toLowerCase().split(/[^a-z0-9가-힣]+/).filter(Boolean);
      return hints.some(hint => words.includes(hint));
    }) ?? korean[0]
    : korean[0];
}

export function playKoreanTts(
  synthesis:SynthesisLike,
  request:TtsPlayback,
  createUtterance:(text:string)=>UtteranceLike,
):UtteranceLike {
  if (!request.text.trim()) throw new Error("음성으로 읽을 한국어 문장이 없습니다.");
  const utterance = createUtterance(request.text);
  utterance.lang = "ko-KR";
  utterance.rate = Math.min(2, Math.max(0.5, request.rate));
  utterance.voice = selectKoreanVoice(synthesis.getVoices(), request.voicePreference);
  synthesis.cancel();
  synthesis.speak(utterance);
  return utterance;
}

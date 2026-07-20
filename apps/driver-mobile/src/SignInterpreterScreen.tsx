import { useEffect, useRef, useState } from "react";
import { speakKorean, stopKoreanSpeech } from "./speech";
import { SignVisionEngine, type SignFrameQuality } from "./signVision";
import { SIGN_PHRASES, addPersonalSample, rankPersonalSigns, type PersonalSignCandidate, type PersonalSignLibrary } from "./personalSign";
import type { WidgetSettings } from "./widgetSettings";

type Mode = "SIGN" | "VOICE" | "PHRASES";
type CameraState = "IDLE" | "LOADING" | "RUNNING" | "ERROR";
type ConversationMessage = { id: string; speaker: "수어 사용자" | "음성 사용자"; text: string; time: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [key: number]: { isFinal: boolean; 0: { transcript: string } } };
};

const EMPTY_QUALITY: SignFrameQuality = { face: false, upperBody: false, leftHand: false, rightHand: false, ready: false, guidance: "카메라를 시작해 주세요." };
const PERSONAL_SIGN_KEY = "suha.personal-sign.v1";
type CaptureJob = { kind: "TRAIN" | "RECOGNIZE"; phraseId?: string; startedAt: number; frames: number[][] };

function loadPersonalLibrary(): PersonalSignLibrary {
  try { return JSON.parse(localStorage.getItem(PERSONAL_SIGN_KEY) || "{}") as PersonalSignLibrary; }
  catch { return {}; }
}

export function SignInterpreterScreen({ widgetSettings, onWidget }: { widgetSettings: WidgetSettings; onWidget(): void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<SignVisionEngine | null>(null);
  const animationRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const captureRef = useRef<CaptureJob | null>(null);
  const libraryRef = useRef<PersonalSignLibrary>(loadPersonalLibrary());
  const lastDetectRef = useRef(0);
  const [mode, setMode] = useState<Mode>("SIGN");
  const [cameraState, setCameraState] = useState<CameraState>("IDLE");
  const [quality, setQuality] = useState(EMPTY_QUALITY);
  const [error, setError] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [selectedGloss, setSelectedGloss] = useState("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [library, setLibrary] = useState<PersonalSignLibrary>(libraryRef.current);
  const [trainingPhraseId, setTrainingPhraseId] = useState(SIGN_PHRASES[0].id);
  const [captureLabel, setCaptureLabel] = useState("");
  const [captureProgress, setCaptureProgress] = useState(0);
  const [candidates, setCandidates] = useState<PersonalSignCandidate[]>([]);

  function appendMessage(speaker: ConversationMessage["speaker"], text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((items) => [...items, { id: `${Date.now()}-${items.length}`, speaker, text: trimmed, time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) }]);
  }

  function stopCamera() {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    engineRef.current?.close();
    engineRef.current = null;
    captureRef.current = null;
    setCaptureLabel("");
    setCaptureProgress(0);
    setCameraState("IDLE");
    setQuality(EMPTY_QUALITY);
  }

  function analyze() {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine || !streamRef.current) return;
    const now = performance.now();
    if (video.readyState >= 2 && now - lastDetectRef.current >= 120) {
      lastDetectRef.current = now;
      try {
        const frame = engine.detect(video, now);
        setQuality(frame.quality);
        const capture = captureRef.current;
        if (capture) {
          if (frame.features) capture.frames.push(frame.features);
          const elapsed = now - capture.startedAt;
          setCaptureProgress(Math.min(1, elapsed / 2200));
          if (elapsed >= 2200) finishCapture(capture);
        }
      }
      catch { setError("입력 분석이 잠시 중단되었습니다. 다시 시작해 주세요."); stopCamera(); return; }
    }
    animationRef.current = requestAnimationFrame(analyze);
  }

  async function startCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("수어 카메라는 HTTPS 환경에서만 사용할 수 있습니다.");
      setCameraState("ERROR");
      return;
    }
    setCameraState("LOADING");
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("카메라 화면을 준비하지 못했습니다.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const engine = new SignVisionEngine();
      await engine.initialize();
      engineRef.current = engine;
      setCameraState("RUNNING");
      lastDetectRef.current = 0;
      animationRef.current = requestAnimationFrame(analyze);
    } catch (cause) {
      stopCamera();
      setCameraState("ERROR");
      setError(cause instanceof DOMException && cause.name === "NotAllowedError" ? "카메라 권한이 차단되었습니다. 브라우저 설정에서 허용해 주세요." : cause instanceof Error ? cause.message : "카메라를 시작하지 못했습니다.");
    }
  }

  function selectPhrase(text: string, gloss: string) {
    setSelectedText(text);
    setSelectedGloss(gloss);
    appendMessage("수어 사용자", text);
  }

  function startCapture(kind: CaptureJob["kind"]) {
    if (cameraState !== "RUNNING" || !quality.ready) { setError("얼굴·양손·상체가 모두 확인된 후 시작해 주세요."); return; }
    if (kind === "RECOGNIZE" && !Object.values(libraryRef.current).some((items) => items.length >= 3)) {
      setError("먼저 한 표현을 3회 학습해 주세요.");
      return;
    }
    setCandidates([]);
    setError("");
    setCaptureProgress(0);
    setCaptureLabel(kind === "TRAIN" ? "학습 동작 기록 중" : "수어 동작 인식 중");
    captureRef.current = { kind, phraseId: kind === "TRAIN" ? trainingPhraseId : undefined, startedAt: performance.now(), frames: [] };
  }

  function finishCapture(job: CaptureJob) {
    if (captureRef.current !== job) return;
    captureRef.current = null;
    setCaptureLabel("");
    setCaptureProgress(0);
    if (job.frames.length < 6) { setError("양손이 충분히 보이지 않았습니다. 천천히 다시 촬영해 주세요."); return; }
    try {
      if (job.kind === "TRAIN" && job.phraseId) {
        const next = addPersonalSample(libraryRef.current, job.phraseId, job.frames);
        libraryRef.current = next;
        setLibrary(next);
        localStorage.setItem(PERSONAL_SIGN_KEY, JSON.stringify(next));
        const phrase = SIGN_PHRASES.find((item) => item.id === job.phraseId);
        setError(`${phrase?.text ?? "표현"} 학습 ${next[job.phraseId].length}/3회를 저장했습니다.`);
      } else {
        const ranked = rankPersonalSigns(job.frames, libraryRef.current);
        setCandidates(ranked);
        setError(ranked.length ? "후보 문장을 확인하고 선택해 주세요." : "인식할 수 있는 학습 표현이 없습니다. 표현을 다시 학습해 주세요.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "동작 특징을 처리하지 못했습니다.");
    }
  }

  function clearPersonalLibrary() {
    libraryRef.current = {};
    setLibrary({});
    setCandidates([]);
    localStorage.removeItem(PERSONAL_SIGN_KEY);
    setError("기기에 저장된 개인 수어 학습 데이터를 삭제했습니다.");
  }

  async function speakSelected() {
    if (!selectedText) return;
    await speakKorean(selectedText).catch(() => setError("한국어 음성을 재생하지 못했습니다. 기기의 TTS 설정을 확인해 주세요."));
  }

  function startListening() {
    const SpeechRecognition = (window as typeof window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as typeof window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setError("이 브라우저는 음성 자막을 지원하지 않습니다. Android Chrome을 사용해 주세요."); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let nextInterim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim();
        if (!text) continue;
        if (result.isFinal) appendMessage("음성 사용자", text);
        else nextInterim += `${text} `;
      }
      setInterim(nextInterim.trim());
    };
    recognition.onerror = (event) => { setError(`음성 인식 오류: ${event.error}`); setListening(false); };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
  }

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        stopCamera();
        recognitionRef.current?.stop();
        void stopKoreanSpeech();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopCamera();
      recognitionRef.current?.stop();
      void stopKoreanSpeech();
    };
  }, []);
  useEffect(() => { if (mode !== "SIGN") stopCamera(); if (mode !== "VOICE") stopListening(); }, [mode]);

  return <section className="sign-interpreter" aria-label="수어 통역">
    <div className="sign-title"><div><span>KOREAN SIGN LANGUAGE</span><h1>수어 통역</h1></div><button onClick={onWidget}>위젯</button></div>
    <nav className="sign-tabs" aria-label="통역 모드">
      <button className={mode === "SIGN" ? "active" : ""} onClick={() => setMode("SIGN")}>수어→음성</button>
      <button className={mode === "VOICE" ? "active" : ""} onClick={() => setMode("VOICE")}>음성→자막</button>
      <button className={mode === "PHRASES" ? "active" : ""} onClick={() => setMode("PHRASES")}>표현</button>
    </nav>

    {mode === "SIGN" && <>
      <div className="sign-camera">
        <video ref={videoRef} playsInline muted />
        {cameraState !== "RUNNING" && <div className="sign-camera-placeholder"><span>⌁</span><strong>{cameraState === "LOADING" ? "입력 엔진 준비 중" : "얼굴·양손·상체를 확인합니다"}</strong><small>일반 통역 영상은 저장하거나 서버로 보내지 않습니다.</small></div>}
        {cameraState === "RUNNING" && <div className={`sign-ready-badge ${quality.ready ? "ready" : ""}`}>● {quality.ready ? "입력 준비 완료" : "화면 맞춤 중"}</div>}
      </div>
      <div className="quality-row">
        <span className={quality.face ? "ok" : ""}>얼굴</span><span className={quality.leftHand ? "ok" : ""}>왼손</span><span className={quality.rightHand ? "ok" : ""}>오른손</span><span className={quality.upperBody ? "ok" : ""}>상체</span>
      </div>
      <p className="sign-guidance">{error || quality.guidance}</p>
      <button className={`sign-camera-button ${cameraState === "RUNNING" ? "stop" : ""}`} onClick={() => cameraState === "RUNNING" ? stopCamera() : void startCamera()} disabled={cameraState === "LOADING"}>{cameraState === "RUNNING" ? "카메라 종료" : cameraState === "LOADING" ? "준비 중…" : "수어 카메라 시작"}</button>
      <section className="personal-sign-model" aria-label="개인 맞춤 수어 학습">
        <div className="personal-model-title"><div><b>내 수어 학습</b><span>기기 안에서만 저장되는 개인 맞춤 실험 기능</span></div><em>{Object.values(library).filter((items) => items.length >= 3).length}개 준비</em></div>
        <label><span>학습할 표현</span><select value={trainingPhraseId} onChange={(event) => setTrainingPhraseId(event.target.value)}>{SIGN_PHRASES.map((phrase) => <option key={phrase.id} value={phrase.id}>{phrase.domain} · {phrase.text} ({library[phrase.id]?.length ?? 0}/3)</option>)}</select></label>
        {captureLabel && <div className="capture-progress"><span>{captureLabel}</span><i><b style={{ width: `${captureProgress * 100}%` }} /></i><small>시작부터 끝까지 한 번에 표현해 주세요.</small></div>}
        <div className="personal-model-actions"><button onClick={() => startCapture("TRAIN")} disabled={Boolean(captureLabel) || !quality.ready}>이 표현 학습</button><button onClick={() => startCapture("RECOGNIZE")} disabled={Boolean(captureLabel) || !quality.ready}>수어 인식</button></div>
        {candidates.length > 0 && <div className="sign-candidates"><small>인식 후보</small>{candidates.map((candidate, index) => <button key={candidate.id} onClick={() => selectPhrase(candidate.text, candidate.gloss)}><b>{index + 1}. {candidate.text}</b><span>{Math.round(candidate.confidence * 100)}% · 학습 {candidate.sampleCount}회</span></button>)}</div>}
        {Object.keys(library).length > 0 && <button className="clear-personal-model" onClick={clearPersonalLibrary}>개인 학습 데이터 전체 삭제</button>}
      </section>
      <div className="model-notice"><b>개인 맞춤 실험 모델</b><span>본인이 학습한 동작만 비교 인식합니다. 전문 한국수어 통역 결과가 아니며, 의료·법률·긴급 상황에서는 반드시 사람의 확인이 필요합니다.</span></div>
      <PhraseStrip onSelect={selectPhrase} />
    </>}

    {mode === "VOICE" && <div className="voice-caption-panel">
      <span>상대방 음성</span>
      <strong>{interim || messages.filter((item) => item.speaker === "음성 사용자").at(-1)?.text || "말씀하시면 큰 글씨로 보여드려요."}</strong>
      <button className={listening ? "listening" : ""} onClick={() => listening ? stopListening() : startListening()}>{listening ? "● 자막 듣기 종료" : "🎙 음성 자막 시작"}</button>
      {error && <small>{error}</small>}
    </div>}

    {mode === "PHRASES" && <div className="phrase-board">{SIGN_PHRASES.map((item) => <button key={item.text} className={item.emergency ? "emergency" : ""} onClick={() => selectPhrase(item.text, item.gloss)}><small>{item.domain}</small><b>{item.text}</b><span>{item.gloss}</span></button>)}</div>}

    {selectedText && <div className="translation-result" style={{ opacity: widgetSettings.opacity }}>{widgetSettings.showGloss && <small>{selectedGloss}</small>}<strong style={{ fontSize: Math.min(widgetSettings.fontSize, 32) }}>{selectedText}</strong><div><button onClick={() => void speakSelected()}>🔊 음성으로 전달</button><button onClick={() => { setSelectedText(""); setSelectedGloss(""); }}>지우기</button></div></div>}

    {messages.length > 0 && <div className="conversation-log"><div><b>대화 기록</b><button onClick={() => setMessages([])}>전체 삭제</button></div>{messages.slice(-8).map((item) => <article key={item.id} className={item.speaker === "수어 사용자" ? "signer" : "speaker"}><small>{item.speaker} · {item.time}</small><p>{item.text}</p></article>)}</div>}
  </section>;
}

function PhraseStrip({ onSelect }: { onSelect(text: string, gloss: string): void }) {
  return <div className="phrase-strip"><div><b>빠른 표현</b><span>선택 후 음성으로 전달</span></div><div>{SIGN_PHRASES.slice(0, 5).map((item) => <button key={item.text} className={item.emergency ? "emergency" : ""} onClick={() => onSelect(item.text, item.gloss)}>{item.text}</button>)}</div></div>;
}

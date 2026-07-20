import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { localActionSpeech, normalizeSpeech, shouldAnnounce } from "./ai";
import { microphonePermissionError, speechRecognitionGuidance } from "./microphone";
import { advanceEraseGesture, type EraseGestureState, isNearFrameEdge, isPenPointerGesture, shouldDrawWithGesture, TemporalPenTracker } from "./pen";
import { KslTtsPanel } from "./KslTtsPanel";
import { ConversationPanel } from "./ConversationPanel";
import { ExpertReviewPanel } from "./ExpertReviewPanel";
import { TranslationWidget } from "./TranslationWidget";
import { ProfessionalQaPanel } from "./ProfessionalQaPanel";
import "./styles.css";

const API = "http://127.0.0.1:8200";
const PEN_COLORS = ["#ff4fd8", "#4de5ad", "#43a5ff", "#ffd84d", "#ffffff"];
const PEN_PREDICTION_MS = 420;
const PEN_REENTRY_MS = 950;
type Camera = {cameraId:string; running:boolean; sessionId:string; mode:string; profile:string; captureFps:number; inferenceFps:number; droppedFrames:number; error?:string};
type EventItem = {eventId:string; cameraId:string; timestamp:string; category:string; eventCode:string; phase:string; intent:string; confidence:number; durationMs:number};
type Pointer = {x:number; y:number; z:number; handedness?:string; timestampMs?:number};
type Drowsiness = {status:"NO_FACE"|"AWAKE"|"WARNING"|"ALARM"; timestampMs:number; faceVisible:boolean; eyeAspectRatio:number|null; eyesClosed:boolean; closedDurationMs:number; perclos:number; blinkCount:number; headDown:boolean; headDownDurationMs:number; combinedDurationMs:number; faceMissingDurationMs:number; riskScore:number; trigger:string; message:string};
type Posture = {status:"NO_POSE"|"CALIBRATING"|"GOOD"|"CHECKING"|"WARNING"; timestampMs:number; poseVisible:boolean; calibrationProgress:number; issue:string; shoulderTiltDegrees:number; headOffsetRatio:number; headHeightRatio:number; forwardHeadDelta:number; badDurationMs:number; postureScore:number; message:string; headLeanDegrees?:number; forwardHeadPercent?:number; cameraViewAngleDegrees?:number; cameraView?:"UNKNOWN"|"FRONT"|"OBLIQUE"|"SIDE"; postureConfidence?:number};
type Diagnostic = Camera & {rawCandidates:Array<{code:string; confidence:number; handedness?:string|null; metadata?:{extendedFingers?:number}}>; pointer?:Pointer|null; featureTimestampMs?:number|null; quality?:{brightness:number; blur:number; handVisibility:number; poseVisibility:number}; drowsiness?:Drowsiness|null; posture?:Posture|null};
type Capture = {captureId:string; label:string; targetSamples:number; samples:number; status:string; outputPath:string; saveVideo:boolean};
type GeminiStatus = {
  configured:boolean;
  model:string;
  privacy:string;
  usage?:{
    apiRequests:number;
    upstreamRequests:number;
    successes:number;
    rateLimits:number;
    cooldownSeconds:number;
    autoMinimumIntervalSeconds:number;
  };
};
type GeminiAnalysis = {speech:string; gesture:string; expression:string; shape:string; confidence:number; observations:string[]; interactionId?:string|null; model:string};
type SpeechRecognitionEventLike = {results:{[index:number]:{[index:number]:{transcript:string}}}};
type SpeechRecognitionErrorEventLike = {error:string; message?:string};
type SpeechRecognitionLike = {
  lang:string;
  interimResults:boolean;
  continuous:boolean;
  start:()=>void;
  onresult:((event:SpeechRecognitionEventLike)=>void)|null;
  onerror:((event:SpeechRecognitionErrorEventLike)=>void)|null;
  onend:(()=>void)|null;
  abort?:()=>void;
};
type SpeechRecognitionConstructor = new()=>SpeechRecognitionLike;

const sleep = (milliseconds:number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export function wsUrl(base = API) { return base.replace(/^http/, "ws") + "/v1/events/stream"; }

function App() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selected, setSelected] = useState("laptop-front");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [penMode, setPenMode] = useState(false);
  const [penDrawing, setPenDrawing] = useState(false);
  const [penColor, setPenColor] = useState("#ff4fd8");
  const [penPointer, setPenPointer] = useState<Pointer | null>(null);
  const [eraseArmed, setEraseArmed] = useState(false);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("서버 연결 대기 중");
  const [actionBusy, setActionBusy] = useState<"start"|"stop"|"mode"|null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [captureLabel, setCaptureLabel] = useState("HAND_WAVE");
  const [captureTarget, setCaptureTarget] = useState(20);
  const [consentId, setConsentId] = useState("test-consent-local");
  const [testerAlias, setTesterAlias] = useState("tester-01");
  const [saveVideo, setSaveVideo] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus | null>(null);
  const [aiVoiceEnabled, setAiVoiceEnabled] = useState(false);
  const [aiMessage, setAiMessage] = useState("AI 음성 안내는 꺼져 있습니다");
  const [aiAnalysis, setAiAnalysis] = useState<GeminiAnalysis | null>(null);
  const [listening, setListening] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");
  const [drowsyAlarmEnabled, setDrowsyAlarmEnabled] = useState(false);
  const captureAbort = useRef(false);
  const drawingCanvas = useRef<HTMLCanvasElement | null>(null);
  const lastDrawPoint = useRef<{x:number; y:number} | null>(null);
  const temporalPointer = useRef(new TemporalPenTracker());
  const lastPointingAt = useRef(0);
  const lastPointerAt = useRef(0);
  const eraseGesture = useRef<EraseGestureState>({armedHand:null, armedAt:0});
  const aiBusy = useRef(false);
  const lastSpoken = useRef("");
  const lastSpokenAt = useRef(0);
  const conversationId = useRef<string | null>(null);
  const aiAutomationEpoch = useRef(0);
  const voiceQuestionTimer = useRef(0);
  const diagnosticRef = useRef<Diagnostic | null>(null);
  const voiceGestureCode = useRef<string | null>(null);
  const safetyAudio = useRef<AudioContext | null>(null);
  const coreActionBusy = useRef(false);
  const microphoneReady = useRef(false);
  const microphoneRequest = useRef<Promise<void> | null>(null);
  const voiceRecognition = useRef<SpeechRecognitionLike | null>(null);
  const camera = useMemo(() => cameras.find(c => c.cameraId === selected), [cameras, selected]);
  const drowsyMode = camera?.mode === "DROWSINESS_MONITOR";
  const drowsiness = diagnostic?.drowsiness;
  const posture = diagnostic?.posture;

  const speakKorean = useCallback((message:string, force = false) => {
    const speech = normalizeSpeech(message);
    const now = Date.now();
    if (!speech || (!force && !shouldAnnounce(lastSpoken.current, speech, lastSpokenAt.current, now))) return false;
    if (!("speechSynthesis" in window)) {
      setAiMessage("이 브라우저는 음성 출력을 지원하지 않습니다");
      return false;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speech);
    utterance.lang = "ko-KR";
    utterance.rate = 0.95;
    const koreanVoice = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith("ko"));
    if (koreanVoice) utterance.voice = koreanVoice;
    window.speechSynthesis.speak(utterance);
    lastSpoken.current = speech;
    lastSpokenAt.current = now;
    return true;
  }, []);

  const activateSafetyAudio = useCallback(() => {
    const AudioContextClass = window.AudioContext || (window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = safetyAudio.current ?? new AudioContextClass();
    safetyAudio.current = context;
    if (context.state === "suspended") void context.resume();
    return context;
  }, []);

  const soundSafetyAlarm = useCallback((urgent = false) => {
    const context = activateSafetyAudio();
    if (!context) return;
    const start = context.currentTime;
    const pulses = urgent ? [0, 0.22, 0.44] : [0];
    for (const offset of pulses) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = urgent ? "square" : "sine";
      oscillator.frequency.setValueAtTime(urgent ? 880 : 660, start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(urgent ? 0.28 : 0.12, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.17);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.18);
    }
  }, [activateSafetyAudio]);

  const analyzeWithGemini = useCallback(async (question?:string, automated = false) => {
    if (aiBusy.current) return "busy" as const;
    const requestEpoch = aiAutomationEpoch.current;
    aiBusy.current = true;
    setAiMessage(question ? `질문 분석 중 · ${question}` : "현재 동작과 표정을 분석 중입니다");
    try {
      const response = await fetch(`${API}/v1/ai/gemini/analyze`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          cameraId:selected,
          question:question || undefined,
          previousInteractionId:question ? conversationId.current || undefined : undefined,
          reason:question ? "question" : "auto",
        }),
      });
      const payload = await response.json() as GeminiAnalysis & {error?:{message?:string}};
      if (!response.ok) throw new Error(payload.error?.message || `Gemini 요청 실패 (${response.status})`);
      if (automated && requestEpoch !== aiAutomationEpoch.current) return "cancelled" as const;
      setAiAnalysis(payload);
      if (question && payload.interactionId) conversationId.current = payload.interactionId;
      const spoken = speakKorean(payload.speech, Boolean(question));
      setAiMessage(payload.speech ? (spoken ? `음성 안내 · ${payload.speech}` : `반복 생략 · ${payload.speech}`) : "확실한 동작이나 표정을 찾지 못했습니다");
      return "ok" as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini 분석에 실패했습니다";
      const rateLimited = message.includes("429");
      const localFallback = rateLimited && question ? localActionSpeech(voiceGestureCode.current) : "";
      const friendlyMessage = rateLimited
        ? question ? localFallback || "무료 Gemini 질문 한도를 잠시 넘었습니다 · 60초 뒤 다시 물어봐 주세요" : "무료 Gemini 요청 한도 대기 중 · 60초 뒤 재시도"
        : message;
      setAiMessage(friendlyMessage);
      if (question) speakKorean(rateLimited ? localFallback || "무료 질문 한도를 잠시 넘었어요. 1분 뒤 다시 물어봐 주세요." : "지금은 답변을 만들지 못했어요. 잠시 후 다시 물어봐 주세요.", true);
      return rateLimited ? "rate-limited" as const : "error" as const;
    } finally {
      aiBusy.current = false;
    }
  }, [selected, speakKorean]);

  const refresh = useCallback(async () => {
    try {
      const list = await fetch(`${API}/v1/cameras`).then(r => r.json()) as Camera[];
      setCameras(list);
      const info = await fetch(`${API}/v1/cameras/${selected}/diagnostics`).then(r => r.json()) as Diagnostic;
      diagnosticRef.current = info;
      setDiagnostic(info); setNotice("코어 정상");
    } catch { setNotice("코어 서버에 연결할 수 없습니다"); }
  }, [selected]);

  useEffect(() => { refresh(); const timer = setInterval(refresh, 1000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => () => voiceRecognition.current?.abort?.(), []);
  useEffect(() => {
    let active = true;
    fetch(`${API}/v1/ai/gemini/status`)
      .then(response => response.json() as Promise<GeminiStatus>)
      .then(status => {
        if (!active) return;
        setGeminiStatus(status);
        if (!status.configured) setAiMessage("서버에 새 GEMINI_API_KEY 설정이 필요합니다");
      })
      .catch(() => { if (active) setAiMessage("Gemini 상태를 확인할 수 없습니다"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const pollGeminiStatus = () => {
      fetch(`${API}/v1/ai/gemini/status`)
        .then(response => response.json() as Promise<GeminiStatus>)
        .then(status => { if (active) setGeminiStatus(status); })
        .catch(() => undefined);
    };
    const timer = window.setInterval(pollGeminiStatus, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (geminiStatus?.configured) {
      setAiMessage(current => current.includes("GEMINI_API_KEY") ? "Gemini AI 음성 안내를 사용할 수 있습니다" : current);
    }
  }, [geminiStatus?.configured]);
  useEffect(() => {
    if (!aiVoiceEnabled || !camera?.running) return;
    let stopped = false;
    let timer = 0;
    const analyze = async () => {
      const result = !document.hidden ? await analyzeWithGemini(undefined, true) : "hidden";
      if (result === "rate-limited") {
        setAiMessage("무료 Gemini 한도로 자동 안내를 껐습니다 · 음성 질문은 로컬 동작으로 답합니다");
        setAiVoiceEnabled(false);
        return;
      }
      const delay = 60000;
      if (!stopped) timer = window.setTimeout(analyze, delay);
    };
    void analyze();
    return () => {
      stopped = true;
      aiAutomationEpoch.current += 1;
      window.clearTimeout(timer);
    };
  }, [aiVoiceEnabled, camera?.running, analyzeWithGemini]);
  useEffect(() => {
    if (!drowsyMode || !drowsyAlarmEnabled || !drowsiness || !["WARNING", "ALARM"].includes(drowsiness.status)) return;
    const urgent = drowsiness.status === "ALARM";
    soundSafetyAlarm(urgent);
    speakKorean(drowsiness.message, true);
    if (!urgent) return;
    const timer = window.setInterval(() => soundSafetyAlarm(true), 4000);
    return () => window.clearInterval(timer);
  }, [drowsyMode, drowsyAlarmEnabled, drowsiness?.status, drowsiness?.message, soundSafetyAlarm, speakKorean]);
  useEffect(() => {
    if (!drowsyMode || !drowsyAlarmEnabled || posture?.status !== "WARNING") return;
    soundSafetyAlarm(false);
    speakKorean(posture.message, true);
  }, [drowsyMode, drowsyAlarmEnabled, posture?.status, posture?.issue, posture?.message, soundSafetyAlarm, speakKorean]);
  useEffect(() => {
    setEvents([]);
    setDiagnostic(null);
    setDrowsyAlarmEnabled(false);
    diagnosticRef.current = null;
    setPenDrawing(false);
    setPenPointer(null);
    lastDrawPoint.current = null;
    temporalPointer.current.reset();
    lastPointingAt.current = 0;
    lastPointerAt.current = 0;
    eraseGesture.current = {armedHand:null, armedAt:0};
    setEraseArmed(false);
    clearDrawing();
  }, [selected]);
  useEffect(() => {
    let closed = false; let retry = 0; let socket: WebSocket;
    const connect = () => {
      socket = new WebSocket(wsUrl());
      socket.onopen = () => { setConnected(true); retry = 0; socket.send(JSON.stringify({action:"SUBSCRIBE", cameraIds:[selected]})); };
      socket.onmessage = message => {
        const event = JSON.parse(message.data) as EventItem;
        if (event.cameraId !== selected) return;
        setEvents(old => [event, ...old].slice(0, 80));
      };
      socket.onclose = () => { setConnected(false); if (!closed) retry = window.setTimeout(connect, 1200); };
    }; connect();
    return () => { closed = true; clearTimeout(retry); socket?.close(); };
  }, [selected]);

  useEffect(() => {
    if (!penMode || !camera?.running) {
      setPenPointer(null);
      setPenDrawing(false);
      lastDrawPoint.current = null;
      temporalPointer.current.reset();
      lastPointingAt.current = 0;
      lastPointerAt.current = 0;
      eraseGesture.current = {armedHand:null, armedAt:0};
      setEraseArmed(false);
      return;
    }
    let stopped = false;
    let busy = false;
    const samplePointer = async () => {
      if (busy) return;
      busy = true;
      try {
        const info = await fetch(`${API}/v1/cameras/${selected}/diagnostics`).then(r => r.json()) as Diagnostic;
        if (stopped) return;
        const eraseResult = advanceEraseGesture(eraseGesture.current, info.rawCandidates ?? [], Date.now());
        eraseGesture.current = eraseResult.state;
        setEraseArmed(Boolean(eraseResult.state.armedHand));
        if (eraseResult.shouldClear) {
          clearDrawing();
          setNotice("손바닥을 보인 뒤 손가락 접기 · 그림을 초기화했습니다");
        }
        const pointer = info.pointer ?? null;
        const gesture = info.rawCandidates?.[0]?.code;
        const now = Date.now();
        const measuredPoint = pointer ? {x:pointer.x, y:pointer.y, z:pointer.z, handedness:pointer.handedness} : null;
        if (measuredPoint) lastPointerAt.current = now;
        const trackedPoint = temporalPointer.current.update(measuredPoint, info.featureTimestampMs ?? pointer?.timestampMs ?? now, PEN_PREDICTION_MS, PEN_REENTRY_MS);
        if (shouldDrawWithGesture(gesture)) lastPointingAt.current = now;
        const uncertainGesture = gesture === "UNKNOWN" || gesture === undefined;
        if (uncertainGesture && measuredPoint && isNearFrameEdge(measuredPoint) && lastPointingAt.current > 0) lastPointingAt.current = now;
        const gestureGrace = trackedPoint && isNearFrameEdge(trackedPoint) ? 650 : 320;
        const drawing = shouldDrawWithGesture(gesture) || (uncertainGesture && now-lastPointingAt.current <= gestureGrace);
        if (!drawing && !uncertainGesture) lastPointingAt.current = 0;
        setPenDrawing(drawing);
        const canvas = drawingCanvas.current;
        const pointerVisible = isPenPointerGesture(gesture) || (drawing && (gesture === "UNKNOWN" || gesture === undefined));
        if (!trackedPoint || !pointerVisible) {
          setPenPointer(null);
          if (!drawing || now-lastPointerAt.current > PEN_REENTRY_MS) lastDrawPoint.current = null;
          return;
        }
        setPenPointer({x:trackedPoint.x,y:trackedPoint.y,z:trackedPoint.z??0,handedness:trackedPoint.handedness});
        if (trackedPoint.reacquired) lastDrawPoint.current = null;
        if (!canvas || !drawing) {
          lastDrawPoint.current = null;
          return;
        }
        const point = {x:trackedPoint.x * canvas.width, y:trackedPoint.y * canvas.height};
        const previous = lastDrawPoint.current;
        if (previous) {
          const context = canvas.getContext("2d");
          if (context) {
            context.strokeStyle = penColor;
            context.lineWidth = 8;
            context.lineCap = "round";
            context.lineJoin = "round";
            context.beginPath();
            context.moveTo(previous.x, previous.y);
            context.lineTo(point.x, point.y);
            context.stroke();
          }
        }
        lastDrawPoint.current = point;
      } catch {
        setPenPointer(null);
        setPenDrawing(false);
        lastDrawPoint.current = null;
        temporalPointer.current.reset();
        lastPointingAt.current = 0;
        lastPointerAt.current = 0;
        eraseGesture.current = {armedHand:null, armedAt:0};
        setEraseArmed(false);
      } finally {
        busy = false;
      }
    };
    samplePointer();
    const timer = window.setInterval(samplePointer, 30);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [penMode, penColor, selected, camera?.running]);

  async function command(action:"start"|"stop") {
    if (coreActionBusy.current) return;
    coreActionBusy.current = true;
    setActionBusy(action);
    setNotice(`${action === "start" ? "카메라와 AI 모델을 시작" : "카메라를 정지"}하는 중입니다…`);
    try {
      const response = await fetch(`${API}/v1/cameras/${selected}/${action}`, {method:"POST"});
      if (!response.ok) throw new Error(await response.text());
      await refresh();
      setNotice(action === "start" ? "카메라가 시작됐습니다" : "카메라가 정지됐습니다");
    } catch (error) {
      setNotice(error instanceof Error && error.message ? `요청 실패 · ${error.message}` : "코어 서버에 연결할 수 없습니다 · 서버를 다시 시작해 주세요");
    } finally {
      coreActionBusy.current = false;
      setActionBusy(null);
    }
  }
  async function changeMode(mode:string) {
    if (!camera || coreActionBusy.current) return;
    coreActionBusy.current = true;
    setActionBusy("mode");
    if (mode !== "DROWSINESS_MONITOR") setDrowsyAlarmEnabled(false);
    setPenMode(false);
    setPenDrawing(false);
    setPenPointer(null);
    lastDrawPoint.current = null;
    temporalPointer.current.reset();
    lastPointingAt.current = 0;
    lastPointerAt.current = 0;
    eraseGesture.current = {armedHand:null, armedAt:0};
    setEraseArmed(false);
    try {
      setNotice("인식 모드를 변경하는 중입니다…");
      const response = await fetch(`${API}/v1/sessions/${camera.sessionId}/mode`, {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({mode, profile:"default"})});
      if (!response.ok) throw new Error(await response.text());
      await refresh();
      setNotice("인식 모드가 변경됐습니다");
    } catch (error) {
      setNotice(error instanceof Error && error.message ? `모드 변경 실패 · ${error.message}` : "코어 서버에 연결할 수 없습니다 · 서버를 다시 시작해 주세요");
    } finally {
      coreActionBusy.current = false;
      setActionBusy(null);
    }
  }
  async function toggleDrowsinessMode() {
    if (!camera) return;
    if (drowsyMode) {
      setDrowsyAlarmEnabled(false);
      window.speechSynthesis?.cancel();
      await changeMode("GENERIC_GESTURE");
      setNotice("졸음 방지 모니터링을 종료했습니다");
      return;
    }
    activateSafetyAudio();
    soundSafetyAlarm(false);
    if (!camera.running) {
      const started = await fetch(`${API}/v1/cameras/${selected}/start`, {method:"POST"});
      if (!started.ok) { setNotice(await started.text()); return; }
      await sleep(350);
    }
    await changeMode("DROWSINESS_MONITOR");
    setAiVoiceEnabled(false);
    setDrowsyAlarmEnabled(true);
    setNotice("졸음 방지 모니터링 시작 · 모든 분석은 노트북에서 처리합니다");
  }
  function toggleDrowsinessAlarm() {
    if (!drowsyAlarmEnabled) {
      activateSafetyAudio();
      soundSafetyAlarm(false);
    }
    setDrowsyAlarmEnabled(value => !value);
  }
  function testDrowsinessAlarm() {
    activateSafetyAudio();
    soundSafetyAlarm(true);
    speakKorean("졸음 방지 경보 테스트입니다.", true);
  }
  async function recalibratePosture() {
    const response = await fetch(`${API}/v1/cameras/${selected}/posture/recalibrate`, {method:"POST"});
    if (!response.ok) { setNotice(await response.text()); return; }
    setNotice("자세 기준을 다시 측정합니다 · 허리를 펴고 정면을 봐 주세요");
    await refresh();
  }
  function clearDrawing() {
    const canvas = drawingCanvas.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    lastDrawPoint.current = null;
  }
  function toggleAiVoice() {
    if (!geminiStatus?.configured) {
      setAiMessage("노출된 키 대신 새 GEMINI_API_KEY를 서버에 설정해 주세요");
      return;
    }
    if (!camera?.running) {
      setAiMessage("카메라를 먼저 시작해 주세요");
      return;
    }
    const enabled = !aiVoiceEnabled;
    setAiVoiceEnabled(enabled);
    if (!enabled) {
      aiAutomationEpoch.current += 1;
      window.speechSynthesis?.cancel();
      setAiMessage("AI 음성 안내를 껐습니다 · 카메라 프레임을 전송하지 않습니다");
    } else {
      setAiMessage("AI 음성 안내 ON · 현재 프레임만 Gemini로 전송합니다");
    }
  }
  function submitVoiceQuestion(transcript:string) {
    setLastQuestion(transcript);
    setAiVoiceEnabled(false);
    aiAutomationEpoch.current += 1;
    window.clearTimeout(voiceQuestionTimer.current);
    setAiMessage(`들은 질문 · ${transcript}`);
    speakKorean("질문을 들었어요. 답변을 준비할게요.", true);
    const queuedAt = Date.now();
    const runQuestion = () => {
      if (aiBusy.current) {
        if (Date.now() - queuedAt > 50000) {
          setAiMessage("이전 분석이 오래 걸리고 있습니다 · 잠시 후 다시 물어봐 주세요");
          speakKorean("이전 분석이 오래 걸리고 있어요. 잠시 후 다시 물어봐 주세요.", true);
          return;
        }
        setAiMessage(`질문 대기 중 · ${transcript}`);
        voiceQuestionTimer.current = window.setTimeout(runQuestion, 300);
        return;
      }
      void analyzeWithGemini(transcript);
    };
    runQuestion();
  }
  async function ensureMicrophoneAccess() {
    if (microphoneReady.current) return;
    if (microphoneRequest.current) return microphoneRequest.current;
    const request = (async () => {
      if (!window.isSecureContext) {
        throw new DOMException("마이크는 HTTPS 또는 localhost에서만 사용할 수 있습니다.", "SecurityError");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("이 브라우저는 마이크 입력을 지원하지 않습니다.");
      }
      try {
        const permission = await navigator.permissions?.query({name:"microphone" as PermissionName});
        if (permission?.state === "denied") throw new DOMException("마이크 권한이 차단됐습니다.", "NotAllowedError");
        if (permission?.state === "granted") {
          microphoneReady.current = true;
          return;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotAllowedError") throw error;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {echoCancellation:true, noiseSuppression:true, autoGainControl:true},
        video: false,
      });
      stream.getTracks().forEach(track => track.stop());
      microphoneReady.current = true;
    })();
    microphoneRequest.current = request;
    try {
      await request;
    } finally {
      microphoneRequest.current = null;
    }
  }
  async function askByVoice() {
    if (!geminiStatus?.configured) {
      setAiMessage("음성 질문 전에 새 GEMINI_API_KEY를 서버에 설정해 주세요");
      return;
    }
    if (!camera?.running) {
      setAiMessage("카메라를 먼저 시작해 주세요");
      return;
    }
    setAiVoiceEnabled(false);
    aiAutomationEpoch.current += 1;
    window.speechSynthesis?.cancel();
    const speechWindow = window as typeof window & {
      SpeechRecognition?:SpeechRecognitionConstructor;
      webkitSpeechRecognition?:SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setAiMessage("이 브라우저는 음성 질문 인식을 지원하지 않습니다");
      speakKorean("이 브라우저에서는 음성 질문을 사용할 수 없어요.", true);
      return;
    }
    try {
      setAiMessage("마이크 권한을 확인하고 있습니다…");
      await ensureMicrophoneAccess();
    } catch (error) {
      const guidance = microphonePermissionError(error);
      setAiMessage(guidance.message);
      if (guidance.speech) speakKorean(guidance.speech, true);
      return;
    }
    const recognition = voiceRecognition.current ?? new Recognition();
    voiceRecognition.current = recognition;
    recognition.lang = "ko-KR";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        voiceGestureCode.current = diagnosticRef.current?.rawCandidates?.[0]?.code ?? null;
        submitVoiceQuestion(transcript);
      }
      else {
        setAiMessage("질문을 듣지 못했습니다 · 다시 말해 주세요");
        speakKorean("질문을 듣지 못했어요. 다시 말해 주세요.", true);
      }
    };
    recognition.onerror = event => {
      const guidance = speechRecognitionGuidance(event.error);
      if (guidance.permissionProblem) microphoneReady.current = false;
      setAiMessage(guidance.message);
      if (guidance.speech) speakKorean(guidance.speech, true);
    };
    recognition.onend = () => setListening(false);
    setListening(true);
    setAiMessage("듣고 있어요 · 현재 화면에 대해 질문해 보세요");
    recognition.start();
  }
  async function togglePenMode() {
    const enabled = !penMode;
    setDrowsyAlarmEnabled(false);
    setPenMode(enabled);
    setPenDrawing(false);
    setPenPointer(null);
    lastDrawPoint.current = null;
    temporalPointer.current.reset();
    lastPointingAt.current = 0;
    lastPointerAt.current = 0;
    eraseGesture.current = {armedHand:null, armedAt:0};
    setEraseArmed(false);
    if (camera) {
      await fetch(`${API}/v1/sessions/${camera.sessionId}/mode`, {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({mode:enabled?"PEN_DRAW":"GENERIC_GESTURE", profile:"default"})});
      await refresh();
    }
  }
  function exportDiagnostics() {
    const blob = new Blob([JSON.stringify({camera:diagnostic, events}, null, 2)], {type:"application/json"});
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `suha-diagnostics-${Date.now()}.json`; link.click(); URL.revokeObjectURL(link.href);
  }

  async function startCapture() {
    if (countdown > 0 || capture?.status === "CREATED" || capture?.status === "CAPTURING") return;
    captureAbort.current = false;
    if (!consentId.trim()) { setNotice("데이터 수집 동의 ID가 필요합니다"); return; }
    if (!camera?.running) {
      const started = await fetch(`${API}/v1/cameras/${selected}/start`, {method:"POST"});
      if (!started.ok) { setNotice(await started.text()); return; }
      await sleep(400);
    }
    const createdResponse = await fetch(`${API}/v1/capture/sessions`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({label:captureLabel, targetSamples:captureTarget, saveVideo, saveLandmarks:true, consentId, cameraId:selected, testerAlias, metadata:{source:"dev-console"}})
    });
    if (!createdResponse.ok) { setNotice(await createdResponse.text()); return; }
    const created = await createdResponse.json() as Capture; setCapture(created);
    for (let value=3; value>0; value--) { setCountdown(value); await sleep(1000); }
    setCountdown(0);
    const startedResponse = await fetch(`${API}/v1/capture/sessions/${created.captureId}/start`, {method:"POST"});
    if (!startedResponse.ok) { setNotice(await startedResponse.text()); return; }
    setCapture(await startedResponse.json() as Capture); setNotice(`${captureLabel} 수집 중`);
    let completed = false;
    while (!completed && !captureAbort.current) {
      const markedResponse = await fetch(`${API}/v1/capture/sessions/${created.captureId}/mark`, {method:"POST"});
      if (markedResponse.ok) {
        const updated = await markedResponse.json() as Capture; setCapture(updated);
        completed = updated.status === "COMPLETE";
        if (completed) setNotice(`${updated.samples}개 샘플 수집 완료`);
      } else if (markedResponse.status !== 409) {
        setNotice(await markedResponse.text()); break;
      }
      await sleep(350);
    }
    await refresh();
  }

  async function stopCapture() {
    captureAbort.current = true;
    if (!capture) return;
    const response = await fetch(`${API}/v1/capture/sessions/${capture.captureId}/stop`, {method:"POST"});
    if (response.ok) { const stopped = await response.json() as Capture; setCapture(stopped); setNotice("데이터 수집을 중지했습니다"); }
  }

  const confirmedEvents = events.filter(event => event.intent && event.intent !== "NONE");
  const timelineEvents = showAllEvents ? events : confirmedEvents;
  const latest = confirmedEvents[0]; const quality = diagnostic?.quality;
  return <main>
    <header><div><span className="eyebrow">LOCAL VISION RUNTIME</span><h1>SuhaAI <em>Core Console</em></h1></div><div className={`connection ${connected ? "online":""}`}><i />{connected ? "WebSocket 연결됨":"재연결 중"}</div></header>
    <section className="toolbar">
      <label>카메라<select value={selected} onChange={e=>setSelected(e.target.value)}>{cameras.map(c=><option key={c.cameraId} value={c.cameraId}>{cameraLabel(c.cameraId)}</option>)}</select></label>
      <div className="mode"><button disabled={Boolean(actionBusy)} className={!penMode&&camera?.mode==="GENERIC_GESTURE"?"active":""} onClick={()=>changeMode("GENERIC_GESTURE")}>제스처</button><button disabled={Boolean(actionBusy)} className={camera?.mode==="SIGN_LANGUAGE_KSL"?"active":""} onClick={()=>changeMode("SIGN_LANGUAGE_KSL")}>수어 통역</button><button disabled={Boolean(actionBusy)} className={penMode?"active":""} onClick={togglePenMode}>펜</button><button disabled={Boolean(actionBusy)} className={drowsyMode?"active safety":""} onClick={toggleDrowsinessMode}>졸음 방지</button><button disabled={Boolean(actionBusy)} className={!penMode&&camera?.mode==="DIAGNOSTIC"?"active":""} onClick={()=>changeMode("DIAGNOSTIC")}>진단</button><button disabled={Boolean(actionBusy)} className={!penMode&&camera?.mode==="IDLE"?"active":""} onClick={()=>changeMode("IDLE")}>대기</button></div>
      {penMode&&<div className="pen-colors" aria-label="펜 색상">{PEN_COLORS.map(color=><button key={color} aria-label={`펜 색상 ${color}`} className={penColor===color?"selected":""} style={{backgroundColor:color}} onClick={()=>setPenColor(color)}/>)}</div>}
      <div className="actions"><button className="secondary" onClick={exportDiagnostics}>진단 내보내기</button>{camera?.running?<button disabled={Boolean(actionBusy)} className="danger" onClick={()=>command("stop")}>{actionBusy==="stop"?"정지 중…":"정지"}</button>:<button disabled={Boolean(actionBusy)} className="primary" onClick={()=>command("start")}>{actionBusy==="start"?"시작 중…":"카메라 시작"}</button>}</div>
    </section>
    <div className="statusline"><span>{notice}</span><span>원본 영상 저장 <b>OFF</b></span></div>
    {drowsyMode ? <section className={`drowsy-strip ${drowsiness?.status?.toLowerCase() ?? "no-face"}`}>
      <div className="drowsy-heading"><span>LOCAL DROWSINESS GUARD</span><strong>Gemini 호출 없음</strong></div>
      <div className="drowsy-summary"><b>{drowsiness?.message ?? "얼굴 랜드마크를 준비하고 있습니다"}</b><small>눈 단독 1.5초 · 고개 단독 5초 · 눈+고개 동시 0.65초부터 확인 · 모두 노트북에서 처리</small></div>
      <div className="drowsy-actions"><button className={drowsyAlarmEnabled?"on":""} onClick={toggleDrowsinessAlarm}>{drowsyAlarmEnabled?"경보음 켜짐":"경보음 켜기"}</button><button onClick={testDrowsinessAlarm}>경보 테스트</button></div>
    </section> : <section className={`ai-strip ${aiVoiceEnabled ? "active" : ""}`}>
      <div className="ai-heading"><span>GEMINI VISION VOICE</span><strong>{geminiStatus?.model ?? "상태 확인 중"}</strong></div>
      <div className="ai-summary"><b>{aiMessage}</b><small>{aiAnalysis ? [lastQuestion && `들은 질문 ${lastQuestion}`, aiAnalysis.shape && `모양 ${aiAnalysis.shape}`, aiAnalysis.gesture && `동작 ${aiAnalysis.gesture}`, aiAnalysis.expression && `표정 ${aiAnalysis.expression}`, `${Math.round(aiAnalysis.confidence*100)}%`].filter(Boolean).join(" · ") : "AI 안내를 켠 동안에만 현재 카메라 프레임 한 장을 Google Gemini로 전송합니다"}{geminiStatus?.usage && ` · 실제 Gemini 호출 ${geminiStatus.usage.upstreamRequests}회 · 성공 ${geminiStatus.usage.successes}회 · 제한 ${geminiStatus.usage.rateLimits}회 · 자동 최소 ${geminiStatus.usage.autoMinimumIntervalSeconds}초${geminiStatus.usage.cooldownSeconds ? ` · 대기 ${geminiStatus.usage.cooldownSeconds}초` : ""}`}</small></div>
      <div className="ai-actions"><button className={aiVoiceEnabled ? "on" : ""} aria-pressed={aiVoiceEnabled} onClick={toggleAiVoice}>{aiVoiceEnabled ? "AI 음성 안내 끄기" : geminiStatus?.configured ? "AI 음성 안내 켜기" : "새 API 키 필요"}</button><button className={listening ? "listening" : ""} disabled={listening} onClick={askByVoice}>{listening ? "듣는 중…" : "🎙 음성 질문"}</button></div>
    </section>}
    <section className="grid">
      <div className="viewer panel"><div className="panel-title"><span>{drowsyMode?"DRIVER CAMERA + FACE LANDMARKS":"LIVE CAMERA + LANDMARKS"}</span><div className="viewer-tools">{penMode&&<><button onClick={clearDrawing}>그림 지우기</button><b className={penDrawing||eraseArmed?"armed":""}>{penDrawing?"DRAWING · 검지 1개 이동":eraseArmed?"CLEAR READY · 손가락을 접으세요":"검지 1개: 그리기 · 2개: 멈춤 · 손바닥→손가락 접기: 초기화"}</b></>}<small>{camera?.running?"LIVE":"STOPPED"}</small></div></div>{camera?.running?<div className="video-stage">{drowsyMode&&<div className={`drowsy-overlay ${drowsiness?.status?.toLowerCase()??"no-face"}`}><strong>{drowsiness?.status??"준비 중"}</strong><span>{drowsiness?.eyesClosed&&drowsiness.headDown?`눈+고개 동시 ${(drowsiness.combinedDurationMs/1000).toFixed(1)}초`:drowsiness?.eyesClosed?`눈 감김 ${(drowsiness.closedDurationMs/1000).toFixed(1)}초`:drowsiness?.headDown?`고개 숙임 ${(drowsiness.headDownDurationMs/1000).toFixed(1)}초`:drowsiness?.faceVisible?"눈과 고개 정상":"얼굴 찾는 중"}</span></div>}<img src={`${API}/v1/cameras/${selected}/stream.mjpeg`} alt="실시간 카메라와 랜드마크"/><canvas ref={drawingCanvas} width="1280" height="720" className={penMode?"drawing active":"drawing"}/>{penMode&&penPointer&&<i className={`pen-cursor ${penDrawing?"armed":""}`} style={{left:`${penPointer.x*100}%`,top:`${penPointer.y*100}%`,borderColor:penDrawing?penColor:undefined,boxShadow:penDrawing?`0 0 16px ${penColor}`:undefined}}/>}</div>:<div className="empty"><div className="hand">✦</div><strong>카메라가 정지되었습니다</strong><p>합성 카메라로 하드웨어 없이 전체 경로를 확인할 수 있습니다.</p></div>}<div className="stats">{drowsyMode?<><Metric label="RISK" value={`${Math.round((drowsiness?.riskScore??0)*100)}%`}/><Metric label="PERCLOS" value={`${Math.round((drowsiness?.perclos??0)*100)}%`}/><Metric label="BLINKS" value={String(drowsiness?.blinkCount??0)}/></>:<><Metric label="CAPTURE FPS" value={camera?.captureFps?.toFixed(1)??"0.0"}/><Metric label="INFERENCE FPS" value={camera?.inferenceFps?.toFixed(1)??"0.0"}/><Metric label="DROPPED" value={String(camera?.droppedFrames??0)}/></>}</div></div>
      {drowsyMode?<aside className={`panel recognition drowsy-card ${drowsiness?.status?.toLowerCase()??"no-face"}`}><div className="panel-title"><span>DROWSINESS STATUS</span><small>LOCAL ONLY</small></div><div className="hero-result"><span>DRIVER STATE</span><strong>{drowsiness?.status??"CALIBRATING"}</strong></div><div className="result-row"><span>판정 근거</span><b>{drowsinessTriggerLabel(drowsiness?.trigger)}</b></div><div className="result-row"><span>눈 상태</span><b>{drowsiness?.eyesClosed?"감김":"뜸"}</b></div><div className="result-row"><span>연속 눈 감김</span><b>{((drowsiness?.closedDurationMs??0)/1000).toFixed(1)}초</b></div><div className="result-row"><span>눈 종횡비(EAR)</span><b>{drowsiness?.eyeAspectRatio?.toFixed(3)??"—"}</b></div><div className="result-row"><span>고개 숙임</span><b>{drowsiness?.headDown?`${(drowsiness.headDownDurationMs/1000).toFixed(1)}초`:"아님"}</b></div><div className="result-row"><span>눈+고개 동시</span><b>{((drowsiness?.combinedDurationMs??0)/1000).toFixed(1)}초</b></div><div className="confidence"><span>졸음 위험도</span><div><i style={{width:`${(drowsiness?.riskScore??0)*100}%`}} /></div><b>{Math.round((drowsiness?.riskScore??0)*100)}%</b></div><p className="privacy-note">영상 저장·Gemini 전송 없이 얼굴 좌표만 메모리에서 계산합니다.</p></aside>:<aside className="panel recognition"><div className="panel-title"><span>RECOGNITION</span><small>{camera?.mode??"—"}</small></div><div className="hero-result"><span>FINAL INTENT</span><strong>{latest?.intent && latest.intent!=="NONE"?latest.intent:"WAITING"}</strong></div><div className="result-row"><span>Raw candidate</span><b>{diagnostic?.rawCandidates?.[0]?.code??"—"}</b></div><div className="result-row"><span>Stable event</span><b>{latest?`${latest.eventCode} · ${latest.phase}`:"—"}</b></div><div className="confidence"><span>Confidence</span><div><i style={{width:`${(latest?.confidence??0)*100}%`}} /></div><b>{latest?`${Math.round(latest.confidence*100)}%`:"0%"}</b></div><h3>QUALITY</h3><Quality label="Brightness" value={quality?.brightness}/><Quality label="Sharpness" value={quality?.blur}/><Quality label="Hand visibility" value={quality?.handVisibility}/><Quality label="Pose visibility" value={quality?.poseVisibility}/></aside>}
      {drowsyMode&&<section className={`panel posture-panel ${posture?.status?.toLowerCase()??"no-pose"}`}><div className="panel-title"><span>SITTING POSTURE COACH · 3D SIDE VIEW</span><div className="posture-tools"><small>{posture?.status??"준비 중"}</small><button onClick={recalibratePosture}>현재 각도로 재보정</button></div></div><div className="posture-body"><div className="posture-message"><strong>{posture?.message??"상반신 3D 자세 좌표를 준비하고 있습니다"}</strong><span>{posture?.status==="CALIBRATING"?`기준 자세 측정 ${Math.round((posture.calibrationProgress??0)*100)}%`:`교정 항목 · ${postureIssueLabel(posture?.issue)} · 신뢰도 ${Math.round((posture?.postureConfidence??0)*100)}%`}</span></div><div className="posture-metrics"><Metric label="POSTURE SCORE" value={`${Math.round((posture?.postureScore??0)*100)}점`}/><Metric label="CAMERA VIEW" value={postureViewLabel(posture)}/><Metric label="SHOULDER TILT" value={`${signed(posture?.shoulderTiltDegrees)}°`}/><Metric label="HEAD LEAN" value={`${(posture?.headLeanDegrees??0).toFixed(1)}°`}/><Metric label="FORWARD HEAD" value={`${signed(posture?.forwardHeadPercent)}%`}/><Metric label="BAD DURATION" value={`${((posture?.badDurationMs??0)/1000).toFixed(1)}초`}/></div></div></section>}
      {camera?.mode==="SIGN_LANGUAGE_KSL"&&<KslTtsPanel sessionId={camera.sessionId}/>}
      {camera?.mode==="SIGN_LANGUAGE_KSL"&&<TranslationWidget sessionId={camera.sessionId}/>}
      {!drowsyMode&&camera&&<ConversationPanel sessionId={camera.sessionId}/>}
      {!drowsyMode&&<ExpertReviewPanel/>}
      {!drowsyMode&&<ProfessionalQaPanel/>}
      {!drowsyMode&&<section className="panel capture-panel"><div className="panel-title"><span>TRAINING DATA CAPTURE</span><small>{capture?.status??"READY"}</small></div><div className="capture-body"><div className="capture-form"><label>동작명<select value={captureLabel} onChange={e=>setCaptureLabel(e.target.value)} disabled={capture?.status==="CAPTURING"}><option>HAND_WAVE</option><option>SWIPE_LEFT</option><option>SWIPE_RIGHT</option><option>RAISE_HAND</option><option>NONE</option></select></label><label>반복 횟수<input type="number" min="1" max="100" value={captureTarget} onChange={e=>setCaptureTarget(Number(e.target.value))}/></label><label>테스터 별칭<input value={testerAlias} onChange={e=>setTesterAlias(e.target.value)}/></label><label>동의 ID<input value={consentId} onChange={e=>setConsentId(e.target.value)}/></label><label className="video-option"><input type="checkbox" checked={saveVideo} onChange={e=>setSaveVideo(e.target.checked)}/> 원본 영상 저장 {saveVideo?"ON":"OFF"}</label></div><div className="capture-progress"><strong>{countdown || `${capture?.samples??0} / ${capture?.targetSamples??captureTarget}`}</strong><span>{countdown?"촬영 준비":capture?.status==="COMPLETE"?"수집 완료":"랜드마크 샘플"}</span><div><i style={{width:`${capture?Math.min(100,capture.samples/capture.targetSamples*100):0}%`}}/></div><small>{capture?.outputPath??"기본값은 랜드마크만 저장합니다."}</small></div><div className="capture-actions">{capture?.status==="CAPTURING"?<button className="danger" onClick={stopCapture}>수집 중지</button>:<button className="primary" onClick={startCapture}>3초 후 수집 시작</button>}</div></div></section>}
      <section className="panel timeline"><div className="panel-title"><span>EVENT TIMELINE · {cameraLabel(selected)}</span><div className="timeline-tools"><button onClick={()=>setShowAllEvents(value=>!value)}>{showAllEvents?"확정 동작만":"전체 진단 이벤트"}</button><small>{timelineEvents.length} EVENTS</small></div></div>{timelineEvents.length===0?<div className="timeline-empty">{showAllEvents?"이 카메라의 이벤트가 없습니다.":"확정된 동작이 아직 없습니다. 동작을 0.45초 이상 유지해 보세요."}</div>:timelineEvents.map(e=><article key={e.eventId}><time>{new Date(e.timestamp).toLocaleTimeString()}</time><span className={`tag ${e.category.toLowerCase()}`}>{e.category}</span><strong>{e.eventCode}</strong><span>{e.phase}</span><em>{e.intent!=="NONE"?`→ ${e.intent}`:""}</em></article>)}</section>
    </section>
  </main>;
}
function Metric({label,value}:{label:string;value:string}) { return <div><span>{label}</span><b>{value}</b></div>; }
function Quality({label,value}:{label:string;value?:number}) { const p=Math.round((value??0)*100); return <div className="quality"><span>{label}</span><div><i style={{width:`${p}%`}} /></div><b>{p}%</b></div>; }
function cameraLabel(cameraId:string) { return cameraId === "laptop-front" ? "노트북 실제 카메라" : cameraId === "synthetic-front" ? "합성 테스트 화면" : cameraId === "mock-depth-front" ? "RGB-D 모의 카메라" : cameraId; }
function drowsinessTriggerLabel(trigger?:string) { return ({NONE:"정상",EYES_ONLY:"눈 감김",HEAD_ONLY:"고개 숙임",EYES_AND_HEAD:"눈+고개 동시",PERCLOS:"누적 눈 감김",FACE_MISSING:"얼굴 이탈"} as Record<string,string>)[trigger??""]??"확인 중"; }
function postureIssueLabel(issue?:string) { return ({NONE:"없음",POSE_MISSING:"상반신 미감지",SHOULDER_TILT:"어깨 기울기",LEANING:"상체 쏠림",SLOUCHING:"구부정한 자세",FORWARD_HEAD:"거북목",CAMERA_ANGLE:"촬영 각도 재측정"} as Record<string,string>)[issue??""]??"확인 중"; }
function signed(value?:number) { const number=value??0; return `${number>0?"+":""}${number.toFixed(1)}`; }
function postureViewLabel(posture?:Posture|null) { if (posture?.cameraViewAngleDegrees==null) return "—"; const label=({FRONT:"정면",OBLIQUE:"사선",SIDE:"측면",UNKNOWN:"확인 중"} as const)[posture.cameraView??"UNKNOWN"]; return `${label} ${posture.cameraViewAngleDegrees.toFixed(0)}°`; }

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

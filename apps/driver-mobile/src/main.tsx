import { Capacitor } from "@capacitor/core";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { DriverMonitor, type MonitorSnapshot } from "./monitor";
import { getMeditationGuidance } from "./meditation";
import { getKoreanSpeechStatus, speakKorean, stopKoreanSpeech } from "./speech";
import { VOICE_PROFILES, getVoiceProfile, normalizeVoiceProfile, type VoiceProfileId } from "./voiceProfiles";
import { SignInterpreterScreen } from "./SignInterpreterScreen";
import {
  MobileVisionEngine,
  VisionFrameUnavailableError,
  drawLandmarks,
  isRecoverableVisionError,
  isUsableVideoFrame,
  visionErrorMessage,
} from "./vision";
import {
  DEFAULT_WIDGET_SETTINGS,
  normalizeWidgetSettings,
  type WidgetPosition,
  type WidgetSettings,
} from "./widgetSettings";
import "./styles.css";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface WakeLockSentinelLike extends EventTarget {
  release(): Promise<void>;
}

type RunState = "READY" | "LOADING" | "RUNNING" | "ERROR";
type CameraPermission = "CHECKING" | "PROMPT" | "GRANTED" | "DENIED" | "UNAVAILABLE";
type MobileTab = "MONITOR" | "SETTINGS";
type AppModule = "HOME" | "DROWSINESS" | "POSTURE" | "MEDITATION" | "SIGN" | "WIDGET";
const isNativeApp = Capacitor.isNativePlatform();
const WIDGET_STORAGE_KEY = "suha.translation-widget.v1";
const VOICE_STORAGE_KEY = "suha.voice-profile.v1";

function loadWidgetSettings(): WidgetSettings {
  try {
    return normalizeWidgetSettings(JSON.parse(localStorage.getItem(WIDGET_STORAGE_KEY) || "{}") as Partial<WidgetSettings>);
  } catch {
    return DEFAULT_WIDGET_SETTINGS;
  }
}

function loadVoiceProfile(): VoiceProfileId {
  return normalizeVoiceProfile(localStorage.getItem(VOICE_STORAGE_KEY));
}

const initialSnapshot: MonitorSnapshot = {
  status: "IDLE",
  trigger: "NONE",
  message: "시작을 누르면 5초 기준 측정 후 감지를 시작합니다.",
  faceVisible: false,
  poseVisible: false,
  eyeAspectRatio: null,
  baselineEyeAspectRatio: null,
  eyesClosed: false,
  closedDurationMs: 0,
  headDown: false,
  headDownDurationMs: 0,
  combinedDurationMs: 0,
  postureStatus: "WAITING",
  postureIssue: "NONE",
  postureScore: null,
  postureConfidence: 0,
  postureMessage: "기준 측정 전입니다.",
  shoulderTiltDegrees: null,
  headLeanDegrees: null,
  forwardHeadPercent: null,
  cameraViewAngleDegrees: null,
  cameraView: "UNKNOWN",
  calibrationProgress: 0,
  calibrationRemainingMs: 5_000,
  calibrationStable: false,
};

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<MobileVisionEngine | null>(null);
  const monitorRef = useRef(new DriverMonitor());
  const animationRef = useRef<number | null>(null);
  const lastInferenceRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastVideoProgressRef = useRef(0);
  const recoveryRef = useRef(false);
  const cpuRecoveryUsedRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const lastAlertRef = useRef(0);
  const meditationCueRef = useRef("");
  const activeModuleRef = useRef<AppModule>("HOME");
  const drowsyNoticeAcceptedRef = useRef(false);
  const mountedRef = useRef(true);
  const [runState, setRunState] = useState<RunState>("READY");
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState("");
  const [cameraPermission, setCameraPermission] = useState<CameraPermission>("CHECKING");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [voiceProfile, setVoiceProfile] = useState(loadVoiceProfile);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState("");
  const [activeTab, setActiveTab] = useState<MobileTab>("MONITOR");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [activeModule, setActiveModule] = useState<AppModule>("HOME");
  const [widgetSettings, setWidgetSettings] = useState(loadWidgetSettings);
  const [meditationSeconds, setMeditationSeconds] = useState(300);
  const [meditationRunning, setMeditationRunning] = useState(false);
  const [showDrowsyNotice, setShowDrowsyNotice] = useState(false);

  const requestWakeLock = useCallback(async () => {
    try {
      const manager = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
      if (manager && document.visibilityState === "visible") wakeLockRef.current = await manager.request("screen");
    } catch {
      wakeLockRef.current = null;
    }
  }, []);

  const stopResources = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    engineRef.current?.close();
    engineRef.current = null;
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
    void stopKoreanSpeech();
    lastInferenceRef.current = 0;
    lastVideoTimeRef.current = -1;
    lastVideoProgressRef.current = 0;
    recoveryRef.current = false;
    cpuRecoveryUsedRef.current = false;
  }, []);

  const stop = useCallback(() => {
    stopResources();
    monitorRef.current.stop();
    setSnapshot(initialSnapshot);
    setError("");
    setRunState("READY");
  }, [stopResources]);

  const runDetection = useCallback(() => {
    if (!mountedRef.current || streamRef.current === null) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    const now = performance.now();
    const hasNewFrame = video !== null && video.currentTime !== lastVideoTimeRef.current;
    if (hasNewFrame) lastVideoProgressRef.current = now;
    if (lastVideoProgressRef.current > 0 && now - lastVideoProgressRef.current >= 4_000) {
      stopResources();
      monitorRef.current.stop();
      setSnapshot(initialSnapshot);
      setError("카메라 영상이 멈췄습니다. 카메라를 사용하는 다른 앱을 닫고 다시 시작해 주세요.");
      setRunState("ERROR");
      return;
    }
    if (video && canvas && engine && !recoveryRef.current && isUsableVideoFrame(video) && hasNewFrame && now - lastInferenceRef.current >= 80) {
      lastInferenceRef.current = now;
      lastVideoTimeRef.current = video.currentTime;
      try {
        const frame = engine.detect(video, now);
        const next = monitorRef.current.process(frame);
        setSnapshot(next);
        setError("");
        const showWarning = activeModuleRef.current !== "MEDITATION" && (next.status === "ALARM" || next.status === "WARNING");
        drawLandmarks(canvas, video, frame, showWarning);
      } catch (cause) {
        if (cause instanceof VisionFrameUnavailableError) {
          animationRef.current = requestAnimationFrame(runDetection);
          return;
        }
        if (isRecoverableVisionError(cause) && engine.activeDelegate === "GPU" && !cpuRecoveryUsedRef.current) {
          const activeStream = streamRef.current;
          cpuRecoveryUsedRef.current = true;
          recoveryRef.current = true;
          engineRef.current = null;
          engine.close();
          setError("기기 호환 모드로 영상 분석을 다시 준비하고 있습니다…");
          const replacement = new MobileVisionEngine();
          void replacement.initialize("CPU").then(() => {
            if (!mountedRef.current || streamRef.current !== activeStream) {
              replacement.close();
              return;
            }
            engineRef.current = replacement;
            monitorRef.current.recalibrate();
            lastInferenceRef.current = 0;
            lastVideoTimeRef.current = -1;
            setError("");
          }).catch((recoveryCause) => {
            replacement.close();
            if (streamRef.current !== activeStream) return;
            stopResources();
            monitorRef.current.stop();
            setSnapshot(initialSnapshot);
            setError(visionErrorMessage(recoveryCause));
            setRunState("ERROR");
          }).finally(() => {
            recoveryRef.current = false;
          });
        } else {
          stopResources();
          monitorRef.current.stop();
          setSnapshot(initialSnapshot);
          setError(visionErrorMessage(cause));
          setRunState("ERROR");
          return;
        }
      }
    }
    animationRef.current = requestAnimationFrame(runDetection);
  }, [stopResources]);

  const start = useCallback(async (): Promise<boolean> => {
    if (activeModuleRef.current === "DROWSINESS" && !drowsyNoticeAcceptedRef.current) {
      setShowDrowsyNotice(true);
      return false;
    }
    if (!window.isSecureContext) {
      setError("모바일 Chrome 카메라는 HTTPS 주소에서만 사용할 수 있습니다. 안전한 HTTPS 주소로 다시 접속해 주세요.");
      setRunState("ERROR");
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저에서는 카메라를 사용할 수 없습니다. HTTPS 또는 설치된 앱에서 실행해 주세요.");
      setRunState("ERROR");
      return false;
    }
    setRunState("LOADING");
    setError("");
    try {
      if (soundEnabled) {
        audioRef.current ??= new AudioContext();
        await audioRef.current.resume();
      }
      const [stream] = await Promise.all([
        requestUserCamera({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, min: 20 },
          },
        }),
        requestWakeLock(),
      ]);
      setCameraPermission("GRANTED");
      streamRef.current = stream;
      const handleCameraEnded = () => {
        if (!mountedRef.current || streamRef.current !== stream) return;
        stopResources();
        monitorRef.current.stop();
        setSnapshot(initialSnapshot);
        setError("카메라 연결이 끊어졌습니다. 다른 앱에서 카메라를 사용 중인지 확인한 뒤 다시 시작해 주세요.");
        setRunState("ERROR");
      };
      stream.getVideoTracks().forEach((track) => track.addEventListener("ended", handleCameraEnded, { once: true }));
      if (videoRef.current === null) throw new Error("카메라 화면을 준비하지 못했습니다.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await waitForUsableVideoFrame(videoRef.current);
      const engine = new MobileVisionEngine();
      await engine.initialize();
      engineRef.current = engine;
      cpuRecoveryUsedRef.current = engine.activeDelegate === "CPU";
      monitorRef.current.begin();
      lastInferenceRef.current = 0;
      lastVideoTimeRef.current = -1;
      lastVideoProgressRef.current = performance.now();
      setRunState("RUNNING");
      animationRef.current = requestAnimationFrame(runDetection);
      return true;
    } catch (cause) {
      stopResources();
      const message = cameraErrorMessage(cause);
      setError(message);
      if (cause instanceof DOMException && cause.name === "NotAllowedError") setCameraPermission("DENIED");
      setRunState("ERROR");
      return false;
    }
  }, [requestWakeLock, runDetection, soundEnabled, stopResources]);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    if ("serviceWorker" in navigator && !isNativeApp) {
      if (import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      else navigator.serviceWorker.getRegistrations().then((items) => items.forEach((item) => void item.unregister())).catch(() => undefined);
    }
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraPermission("UNAVAILABLE");
      return;
    }
    let status: PermissionStatus | null = null;
    let disposed = false;
    const update = () => {
      if (!disposed && status) setCameraPermission(status.state === "granted" ? "GRANTED" : status.state === "denied" ? "DENIED" : "PROMPT");
    };
    const query = async () => {
      try {
        status = await navigator.permissions.query({ name: "camera" as PermissionName });
        update();
        status.addEventListener("change", update);
      } catch {
        if (!disposed) setCameraPermission("PROMPT");
      }
    };
    void query();
    return () => {
      disposed = true;
      status?.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" && runState === "RUNNING") {
        stop();
        setError("앱이 백그라운드로 전환되어 카메라를 안전하게 종료했습니다. 다시 시작해 주세요.");
        return;
      }
      if (document.visibilityState === "visible" && runState === "RUNNING") {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [requestWakeLock, runState, stop]);

  useEffect(() => {
    if (runState !== "RUNNING") return;
    const handleOrientationChange = () => {
      stop();
      setError("화면 방향이 변경되어 카메라를 안전하게 종료했습니다. 휴대폰을 세로로 놓고 다시 시작해 주세요.");
    };
    window.addEventListener("orientationchange", handleOrientationChange);
    return () => window.removeEventListener("orientationchange", handleOrientationChange);
  }, [runState, stop]);

  useEffect(() => {
    if (activeModule === "MEDITATION" || !soundEnabled || runState !== "RUNNING" || snapshot.status === "CALIBRATING" || snapshot.status === "AWAKE") return;
    const now = Date.now();
    const interval = snapshot.status === "ALARM" ? 2_500 : 7_000;
    if (now - lastAlertRef.current < interval) return;
    lastAlertRef.current = now;
    beep(audioRef.current, snapshot.status === "ALARM");
    void speakKorean(snapshot.message, voiceProfile).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "음성 안내를 재생하지 못했습니다.";
      setVoiceFeedback(`${message} Android 설정에서 한국어 TTS를 확인해 주세요.`);
    });
  }, [activeModule, runState, snapshot.message, snapshot.status, soundEnabled, voiceProfile]);

  const meditationPhase = Math.floor(meditationSeconds / 4) % 2 === 0 ? "내쉬기" : "들이쉬기";
  const meditationGuidance = useMemo(() => getMeditationGuidance({
    seconds: meditationSeconds,
    running: meditationRunning,
    runState,
    error,
    snapshot,
    breathPhase: meditationPhase,
  }), [error, meditationPhase, meditationRunning, meditationSeconds, runState, snapshot]);

  useEffect(() => {
    const cue = meditationGuidance.voiceCue;
    if (activeModule !== "MEDITATION" || !soundEnabled || !cue || cue === meditationCueRef.current) return;
    meditationCueRef.current = cue;
    void speakKorean(cue, voiceProfile).catch(() => undefined);
  }, [activeModule, meditationGuidance.voiceCue, soundEnabled, voiceProfile]);

  useEffect(() => {
    if (!meditationRunning || activeModule !== "MEDITATION" || !meditationGuidance.timerActive) return;
    const timer = window.setInterval(() => {
      setMeditationSeconds((seconds) => {
        if (seconds <= 1) {
          setMeditationRunning(false);
          return 0;
        }
        return seconds - 1;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [activeModule, meditationGuidance.timerActive, meditationRunning]);

  useEffect(() => {
    // React StrictMode intentionally runs effect setup/cleanup twice in development.
    // Reset the mounted flag on every setup so the detection loop remains active
    // after StrictMode's simulated unmount.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopResources();
      monitorRef.current.stop();
    };
  }, [stopResources]);

  const openModule = useCallback((module: AppModule) => {
    if (module !== "DROWSINESS" && module !== "POSTURE") stop();
    activeModuleRef.current = module;
    meditationCueRef.current = "";
    if (module === "DROWSINESS") {
      drowsyNoticeAcceptedRef.current = false;
      setShowDrowsyNotice(true);
    }
    setActiveModule(module);
    if (module === "DROWSINESS") setActiveTab("MONITOR");
    if (module === "POSTURE") setActiveTab("MONITOR");
  }, [stop]);

  const goHome = useCallback(() => {
    stop();
    setMeditationRunning(false);
    setShowDrowsyNotice(false);
    drowsyNoticeAcceptedRef.current = false;
    activeModuleRef.current = "HOME";
    meditationCueRef.current = "";
    setActiveModule("HOME");
  }, [stop]);

  const toggleMeditation = useCallback(async () => {
    if (meditationRunning) {
      setMeditationRunning(false);
      return;
    }
    if (runState === "LOADING") return;
    if (meditationSeconds === 0) setMeditationSeconds(300);
    if (runState !== "RUNNING" && !(await start())) return;
    meditationCueRef.current = "";
    setMeditationRunning(true);
  }, [meditationRunning, meditationSeconds, runState, start]);

  const updateWidgetSettings = useCallback((next: Partial<WidgetSettings>) => {
    setWidgetSettings((current) => {
      const normalized = normalizeWidgetSettings({ ...current, ...next });
      localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    });
  }, []);

  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } else {
      setShowInstallHelp((value) => !value);
    }
  };

  const selectVoiceProfile = (profileId: VoiceProfileId) => {
    setVoiceProfile(profileId);
    localStorage.setItem(VOICE_STORAGE_KEY, profileId);
    setSoundEnabled(true);
    setVoiceFeedback(`${getVoiceProfile(profileId).label} 음성으로 설정했습니다.`);
    void speakKorean(getVoiceProfile(profileId).sample, profileId).catch(() => {
      setVoiceFeedback("선택한 음성 미리듣기를 재생하지 못했습니다. 기기의 한국어 TTS 설정을 확인해 주세요.");
    });
  };

  const testVoice = async () => {
    setSoundEnabled(true);
    setVoiceFeedback("한국어 음성 엔진을 확인하고 있습니다…");
    try {
      const status = await getKoreanSpeechStatus();
      if (status.error) throw new Error(status.error);
      await speakKorean(getVoiceProfile(voiceProfile).sample, voiceProfile);
      setVoiceFeedback(`${getVoiceProfile(voiceProfile).label} 음성 테스트를 재생했습니다.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "한국어 음성 엔진을 사용할 수 없습니다.";
      setVoiceFeedback(`${message} Android 설정 → 일반 관리 → 글자 읽어주기에서 한국어 음성을 설치해 주세요.`);
    }
  };

  const calibrating = snapshot.status === "CALIBRATING";
  const countdown = Math.max(1, Math.ceil(snapshot.calibrationRemainingMs / 1_000));
  const statusLabel = getStatusLabel(snapshot.status);
  const postureLabel = getPostureLabel(snapshot.postureStatus, snapshot.postureIssue);
  const permissionLabel = getPermissionLabel(cameraPermission);

  return (
    <main className={`app status-${activeModule === "MEDITATION" ? "awake" : snapshot.status.toLowerCase()}`}>
      <header className="topbar">
        <div className="brand-lockup">
          {activeModule !== "HOME" && <button className="header-icon back" onClick={goHome} aria-label="홈으로 이동">‹</button>}
          <div className="brand" aria-label="졸음운전"><img src="/icon-192.png" alt="" /><span>졸음운전<small>AI SAFETY</small></span></div>
        </div>
        <button className="header-icon" onClick={() => {
          if (activeModule !== "DROWSINESS" && activeModule !== "POSTURE") {
            stop();
            activeModuleRef.current = "DROWSINESS";
            setActiveModule("DROWSINESS");
          }
          setActiveTab("SETTINGS");
        }} aria-label="설정 열기">⚙</button>
      </header>

      {activeModule === "HOME" && <HomeScreen onOpen={openModule} widgetSettings={widgetSettings} />}
      {activeModule === "MEDITATION" && (
        <MeditationScreen
          seconds={meditationSeconds}
          running={meditationRunning}
          guidance={meditationGuidance}
          snapshot={snapshot}
          runState={runState}
          cameraPermission={cameraPermission}
          permissionLabel={permissionLabel}
          videoRef={videoRef}
          canvasRef={canvasRef}
          postureLabel={postureLabel}
          onToggle={() => void toggleMeditation()}
          onReset={() => { setMeditationRunning(false); setMeditationSeconds(300); meditationCueRef.current = ""; }}
        />
      )}
      {activeModule === "SIGN" && <SignInterpreterScreen widgetSettings={widgetSettings} onWidget={() => setActiveModule("WIDGET")} />}
      {activeModule === "WIDGET" && <WidgetSettingsScreen settings={widgetSettings} onUpdate={updateWidgetSettings} />}

      {(activeModule === "DROWSINESS" || activeModule === "POSTURE") && <>

      <nav className="mode-switcher" aria-label="감지 모드 선택">
        <button className={activeModule === "DROWSINESS" ? "active" : ""} onClick={() => openModule("DROWSINESS")}>졸음 감지</button>
        <span aria-hidden="true">⇄</span>
        <button className={activeModule === "POSTURE" ? "active" : ""} onClick={() => openModule("POSTURE")}>자세 교정</button>
      </nav>

      {showInstallHelp && (
        <aside className="install-help">
          iPhone은 Safari의 <b>공유 → 홈 화면에 추가</b>, Android는 Chrome 메뉴의 <b>앱 설치</b>를 선택하세요.
        </aside>
      )}

      <section className={`camera-stage ${activeTab!=="MONITOR"?"mobile-screen-hidden":""}`} aria-label={activeModule === "POSTURE" ? "자세 교정 카메라" : "운전자 카메라"}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {runState !== "RUNNING" && (
          <div className="camera-placeholder">
            <div className="face-guide"><span /><span /></div>
            <strong>{runState === "LOADING" ? "카메라 허용을 기다리고 있습니다" : activeModule === "POSTURE" ? "자세 교정 준비" : "운전자 감지 준비"}</strong>
            <p>{runState === "LOADING" && cameraPermission !== "GRANTED"
              ? "브라우저의 카메라 권한 창에서 ‘허용’을 선택해 주세요. 허용 후 자동으로 시작합니다."
              : "휴대폰을 고정하고 얼굴과 양쪽 어깨가 보이게 맞춰 주세요."}</p>
            <div className={`permission-state ${cameraPermission.toLowerCase()}`}>{permissionLabel}</div>
          </div>
        )}
        {calibrating && (
          <div className="calibration-overlay">
            <div className={`countdown ${snapshot.calibrationStable ? "stable" : "lost"}`}>
              {snapshot.calibrationStable ? countdown : "!"}
            </div>
            <strong>평상시 모습 측정 중</strong>
            <p>{snapshot.message}</p>
            <div className="progress-track"><i style={{ width: `${snapshot.calibrationProgress * 100}%` }} /></div>
            <small>{snapshot.calibrationStable ? "움직이지 말고 5초만 유지해 주세요" : "얼굴·눈·양쪽 어깨 확인 중"}</small>
          </div>
        )}
        {runState === "RUNNING" && !calibrating && (
          <div className={`status-badge ${snapshot.status.toLowerCase()}`}>
            <span className="status-dot" />{statusLabel}
          </div>
        )}
      </section>

      <section className={`status-panel ${activeTab==="SETTINGS"?"mobile-screen-hidden":""}`} aria-live="polite">
        <div className="status-heading">
          <div>
            <span className="eyebrow">{activeModule === "POSTURE" ? "POSTURE COACH" : "DRIVER STATUS"}</span>
            <h1>{calibrating ? "기준 측정 중" : statusLabel}</h1>
          </div>
          <div className="privacy-chip">기기 내 분석</div>
        </div>
        <p className="main-message">{error || snapshot.message}</p>

        <div className="summary-metrics">
          <article><span>눈</span><strong>{snapshot.eyeAspectRatio === null ? "—" : snapshot.eyesClosed ? "감김" : "정상"}</strong></article>
          <article><span>고개</span><strong>{snapshot.headDown ? "숙임" : snapshot.faceVisible ? "정상" : "—"}</strong></article>
          <article><span>자세</span><strong>{snapshot.postureScore === null ? "—" : `${snapshot.postureScore}점`}</strong></article>
        </div>
        <button className="details-toggle" onClick={() => setDetailsExpanded((value) => !value)} aria-expanded={detailsExpanded}>
          {detailsExpanded ? "상세 정보 접기" : "상세 정보 보기"}<span>{detailsExpanded ? "⌃" : "⌄"}</span>
        </button>

        {detailsExpanded&&<div className="metric-grid">
          <article>
            <span>눈 상태</span>
            <strong>{snapshot.eyeAspectRatio === null ? "—" : snapshot.eyesClosed ? "감김" : "정상"}</strong>
            <small>EAR {snapshot.eyeAspectRatio?.toFixed(3) ?? "—"} / 기준 {snapshot.baselineEyeAspectRatio?.toFixed(3) ?? "—"}</small>
          </article>
          <article>
            <span>고개 상태</span>
            <strong>{snapshot.headDown ? "숙임" : snapshot.faceVisible ? "정상" : "—"}</strong>
            <small>{formatDuration(snapshot.headDownDurationMs)}</small>
          </article>
          <article className="posture-card">
            <div className="posture-title">
              <div><span>3D 앉은 자세</span><strong>{postureLabel}</strong></div>
              <b>{snapshot.postureScore === null ? "—" : `${snapshot.postureScore}점`}</b>
            </div>
            <p>{snapshot.postureMessage}</p>
            <div className="posture-metrics">
              <label><span>촬영 각도</span><b>{formatView(snapshot.cameraView, snapshot.cameraViewAngleDegrees)}</b></label>
              <label><span>어깨 수평</span><b>{formatSignedDegrees(snapshot.shoulderTiltDegrees)}</b></label>
              <label><span>머리 기울기</span><b>{formatDegrees(snapshot.headLeanDegrees)}</b></label>
              <label><span>앞쪽 이동</span><b>{formatPercent(snapshot.forwardHeadPercent)}</b></label>
            </div>
            <small className="confidence">3D 추정 신뢰도 {Math.round(snapshot.postureConfidence * 100)}% · 5프레임 흔들림 보정</small>
          </article>
        </div>}
      </section>

      <nav className={`controls ${activeTab!=="MONITOR"?"mobile-screen-hidden":""}`} aria-label="감지 제어">
        {runState === "RUNNING" ? (
          <button className="primary stop" onClick={stop}><span className="stop-icon" />감지 종료</button>
        ) : (
          <button className="primary" onClick={() => void start()} disabled={runState === "LOADING" || cameraPermission === "UNAVAILABLE"}>
            <span className="play-icon" />{runState === "LOADING" ? "준비 중…" : "5초 측정 후 감지 시작"}
          </button>
        )}
      </nav>

      {activeTab==="SETTINGS"&&<section className="mobile-settings" aria-label="앱 설정">
        <div className="settings-heading"><span className="eyebrow">APP SETTINGS</span><h1>설정</h1><p>운전 중에는 조작하지 말고 출발 전에 설정해 주세요.</p></div>
        <button className="setting-row" onClick={()=>setSoundEnabled(value=>!value)} aria-pressed={soundEnabled}><span><b>경보음과 음성 안내</b><small>주의·위험 상태를 한국어로 알립니다.</small></span><i className={soundEnabled?"on":""}>{soundEnabled?"켜짐":"꺼짐"}</i></button>
        <div className="voice-profile-setting" role="group" aria-label="안내 음성 선택">
          <div className="voice-profile-heading"><span><b>안내 음성</b><small>선택하면 바로 미리듣기가 재생됩니다.</small></span><i>{getVoiceProfile(voiceProfile).label}</i></div>
          <div className="voice-profile-grid">
            {VOICE_PROFILES.map((profile) => <button key={profile.id} className={voiceProfile === profile.id ? "selected" : ""} onClick={() => selectVoiceProfile(profile.id)} aria-pressed={voiceProfile === profile.id}><span>{profile.id === "FEMALE" ? "♀" : profile.id === "MALE" ? "♂" : profile.id === "CHILD" ? "○" : "✦"}</span><b>{profile.label}</b><small>{profile.description}</small></button>)}
          </div>
        </div>
        <button className="setting-row" onClick={()=>void testVoice()}><span><b>선택 음성 다시 듣기</b><small>현재 선택한 목소리와 한국어 TTS 상태를 확인합니다.</small></span><i>재생</i></button>
        <button className="setting-row" onClick={()=>monitorRef.current.recalibrate()} disabled={runState!=="RUNNING"}><span><b>운전자 기준 재측정</b><small>얼굴과 자세 기준을 5초간 다시 측정합니다.</small></span><i>재측정</i></button>
        <button className="setting-row" onClick={() => setActiveModule("WIDGET")}><span><b>번역 위젯 설정</b><small>위치, 글자 크기, 투명도와 Gloss 표시를 설정합니다.</small></span><i>열기</i></button>
        {!isNativeApp&&<button className="setting-row" onClick={()=>void install()} aria-expanded={showInstallHelp}><span><b>홈 화면에 앱 설치</b><small>전체 화면에서 빠르게 실행할 수 있습니다.</small></span><i>설치</i></button>}
        {voiceFeedback&&<p className="voice-feedback" role="status">{voiceFeedback}</p>}
        <div className="privacy-card"><b>기기 내 개인정보 처리</b><p>카메라 영상은 서버로 보내거나 저장하지 않습니다. 앱이 백그라운드로 가면 카메라를 즉시 종료합니다.</p></div>
      </section>}

      {activeTab==="SETTINGS"&&<footer>
        <b>안전 안내</b> 이 기능은 실험용 보조 장치이며 운전자의 전방 주시를 대신하지 않습니다. 경고가 발생하면 즉시 안전한 곳에 정차하세요.
      </footer>}

      {activeTab==="SETTINGS"&&<button className="back-to-monitor" onClick={() => setActiveTab("MONITOR")}>카메라 화면으로 돌아가기</button>}
      {showDrowsyNotice&&<DrowsySafetyNotice
        onConfirm={() => {
          drowsyNoticeAcceptedRef.current = true;
          setShowDrowsyNotice(false);
        }}
        onCancel={goHome}
      />}
      </>}
    </main>
  );
}

function DrowsySafetyNotice({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  return <div className="safety-modal-backdrop">
    <section className="safety-modal" role="dialog" aria-modal="true" aria-labelledby="drowsy-safety-title" aria-describedby="drowsy-safety-description">
      <div className="safety-modal-icon" aria-hidden="true">!</div>
      <span className="eyebrow">SAFETY FIRST</span>
      <h2 id="drowsy-safety-title">졸음운전 안전 안내</h2>
      <p id="drowsy-safety-description">이 기능을 사용하기 전에 아래 내용을 반드시 확인해 주세요.</p>
      <ul>
        <li><b>운전 중에는 휴대전화를 조작하지 마세요.</b> 모든 설정은 출발 전에 완료해야 합니다.</li>
        <li>본 앱은 졸음운전을 예방하거나 운전자의 안전을 보장하는 장치가 아닙니다.</li>
        <li>피곤하거나 졸리면 즉시 휴게소·졸음쉼터 등 안전한 장소에 정차하고 충분히 휴식한 뒤 운전하세요.</li>
        <li>앱의 경고보다 도로 상황과 운전자의 판단을 항상 우선하세요.</li>
      </ul>
      <button className="safety-confirm" onClick={onConfirm}>확인했습니다</button>
      <button className="safety-cancel" onClick={onCancel}>사용하지 않고 홈으로</button>
    </section>
  </div>;
}

function HomeScreen({ onOpen, widgetSettings }: { onOpen(module: AppModule): void; widgetSettings: WidgetSettings }) {
  return <section className="mobile-home" aria-label="졸음운전 홈">
    <div className="home-hero">
      <div className="home-kicker"><i />오늘도 안전운전</div>
      <h1>당신의 하루를<br /><b>더 편안하게.</b></h1>
      <p>안전과 건강, 소통을 하나의 AI로 돌봐요.</p>
      <div className="hero-signal"><i /><span><b>기기 내 AI</b><small>카메라 영상은 저장되지 않아요</small></span></div>
    </div>
    <div className="home-bento">
      <button className="suha-card drive" onClick={() => onOpen("DROWSINESS")}>
        <span className="card-icon"><i /></span><div><small>DRIVE SAFE</small><b>졸음운전 감지</b><p>눈과 고개 움직임을 살펴<br />안전한 운전을 도와요.</p></div><em>시작하기 <span>→</span></em>
      </button>
      <button className="suha-card posture" onClick={() => onOpen("POSTURE")}>
        <span className="card-symbol">◇</span><small>POSTURE</small><b>자세 교정</b><p>바른 자세를<br />함께 찾아요.</p><em>열기 →</em>
      </button>
      <button className="suha-card sign" onClick={() => onOpen("SIGN")}>
        <span className="card-symbol">⌁</span><small>KSL CARE</small><b>수어 통역</b><p>수어와 음성을<br />서로 이어줘요.</p><em>열기 →</em>
      </button>
      <button className="suha-card meditation" onClick={() => onOpen("MEDITATION")}><span className="breath-mark">◌</span><div><small>MINDFUL BREATH</small><b>잠시, 호흡할까요?</b><p>5분 호흡 명상으로 마음을 가볍게.</p></div><em>시작 →</em></button>
    </div>
    <button className="home-utility" onClick={() => onOpen("WIDGET")}><span><i>▣</i><b>통역 위젯</b><small>{widgetSettings.enabled ? `표시 중 · ${widgetPositionLabel(widgetSettings.position)}` : "현재 숨김"}</small></span><em>설정</em></button>
  </section>;
}

function MeditationScreen({ seconds, running, guidance, snapshot, runState, cameraPermission, permissionLabel, videoRef, canvasRef, postureLabel, onToggle, onReset }: {
  seconds: number;
  running: boolean;
  guidance: ReturnType<typeof getMeditationGuidance>;
  snapshot: MonitorSnapshot;
  runState: RunState;
  cameraPermission: CameraPermission;
  permissionLabel: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  postureLabel: string;
  onToggle(): void;
  onReset(): void;
}) {
  return <section className="meditation-screen" aria-label="호흡 명상">
    <span className="eyebrow">5 MINUTE BREATH</span>
    <h1>호흡 명상</h1>
    <p>카메라가 눈 상태와 앉은 자세를 살피며 편안한 호흡을 안내합니다.</p>
    <div className="meditation-layout">
      <div className="meditation-visual">
        <div className={`breath-orb ${guidance.timerActive ? "running" : ""}`}><span>{guidance.title}</span></div>
        <strong className="meditation-time">{formatClock(seconds)}</strong>
      </div>
      <div className="meditation-camera camera-stage" aria-label="명상 자세 확인 카메라">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {runState !== "RUNNING" && <div className="camera-placeholder compact"><div className="face-guide"><span /><span /></div><strong>{runState === "LOADING" ? "카메라 준비 중" : "자세 확인 준비"}</strong><p>얼굴과 양쪽 어깨가 보이게 맞춰 주세요.</p><div className={`permission-state ${cameraPermission.toLowerCase()}`}>{permissionLabel}</div></div>}
        {runState === "RUNNING" && <div className="meditation-camera-badge"><i />기기 내 자세 분석</div>}
      </div>
    </div>
    <article className={`meditation-guide stage-${guidance.stage.toLowerCase()}`} aria-live="polite"><span>{guidance.stage === "BREATHING" ? "LIVE COACH" : "MEDITATION GUIDE"}</span><strong>{guidance.title}</strong><p>{guidance.message}</p></article>
    <div className="meditation-metrics">
      <article><span>눈 상태</span><strong>{snapshot.eyeAspectRatio === null ? "준비 전" : snapshot.eyesClosed ? "편안히 감음" : "눈 뜸"}</strong></article>
      <article><span>앉은 자세</span><strong>{snapshot.postureScore === null ? "준비 전" : `${postureLabel} · ${snapshot.postureScore}점`}</strong></article>
    </div>
    <div className="meditation-actions"><button className="primary" onClick={onToggle} disabled={runState === "LOADING"}>{runState === "LOADING" ? "카메라 준비 중…" : running ? "잠시 멈춤" : seconds === 0 ? "다시 시작" : runState === "RUNNING" ? "계속하기" : "카메라로 명상 시작"}</button><button onClick={onReset}>5분 초기화</button></div>
    <small>운전 중에는 명상을 사용하지 마세요. 안전한 장소에서만 실행하세요.</small>
  </section>;
}

function WidgetSettingsScreen({ settings, onUpdate }: { settings: WidgetSettings; onUpdate(next: Partial<WidgetSettings>): void }) {
  return <section className="widget-settings-screen" aria-label="번역 위젯 설정">
    <span className="eyebrow">TRANSLATION WIDGET</span><h1>위젯 설정</h1><p>수어 통역 자막의 표시 방법을 기기에 저장합니다.</p>
    <button className="setting-row" onClick={() => onUpdate({ enabled: !settings.enabled })} aria-pressed={settings.enabled}><span><b>번역 위젯 표시</b><small>수어 통역 화면 위에 번역 결과를 표시합니다.</small></span><i className={settings.enabled ? "on" : ""}>{settings.enabled ? "켜짐" : "꺼짐"}</i></button>
    <label className="widget-control"><span><b>표시 위치</b><small>{widgetPositionLabel(settings.position)}</small></span><select value={settings.position} onChange={(event) => onUpdate({ position: event.target.value as WidgetPosition })}><option value="TOP_LEFT">왼쪽 위</option><option value="TOP_RIGHT">오른쪽 위</option><option value="BOTTOM_LEFT">왼쪽 아래</option><option value="BOTTOM_RIGHT">오른쪽 아래</option></select></label>
    <label className="widget-control range"><span><b>글자 크기</b><small>{settings.fontSize}px</small></span><input type="range" min="16" max="44" value={settings.fontSize} onChange={(event) => onUpdate({ fontSize: Number(event.target.value) })} /></label>
    <label className="widget-control range"><span><b>투명도</b><small>{Math.round(settings.opacity * 100)}%</small></span><input type="range" min="0.55" max="1" step="0.01" value={settings.opacity} onChange={(event) => onUpdate({ opacity: Number(event.target.value) })} /></label>
    <button className="setting-row" onClick={() => onUpdate({ showGloss: !settings.showGloss })} aria-pressed={settings.showGloss}><span><b>Gloss 함께 표시</b><small>한국수어 중간 표기를 번역문 위에 표시합니다.</small></span><i className={settings.showGloss ? "on" : ""}>{settings.showGloss ? "표시" : "숨김"}</i></button>
    <div className="widget-preview" style={{ opacity: settings.opacity }}><span>● PREVIEW</span>{settings.showGloss && <small>안녕하세요 / 도움</small>}<strong style={{ fontSize: settings.fontSize }}>무엇을 도와드릴까요?</strong></div>
  </section>;
}

function widgetPositionLabel(position: WidgetPosition): string {
  return { TOP_LEFT: "왼쪽 위", TOP_RIGHT: "오른쪽 위", BOTTOM_LEFT: "왼쪽 아래", BOTTOM_RIGHT: "오른쪽 아래" }[position];
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function beep(context: AudioContext | null, urgent: boolean): void {
  if (context === null) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = urgent ? 920 : 650;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(urgent ? 0.28 : 0.16, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (urgent ? 0.55 : 0.25));
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + (urgent ? 0.58 : 0.28));
}

function getStatusLabel(status: MonitorSnapshot["status"]): string {
  return { IDLE: "준비", CALIBRATING: "측정 중", AWAKE: "정상", WARNING: "주의", ALARM: "위험", NO_FACE: "얼굴 확인" }[status];
}

function getPostureLabel(status: MonitorSnapshot["postureStatus"], issue: string): string {
  if (status === "NO_POSE" || status === "WAITING") return "확인 대기";
  if (status === "GOOD") return "바른 자세";
  const labels: Record<string, string> = {
    SHOULDER_TILT: "어깨 기울어짐",
    LEANING: "몸 기울어짐",
    SLOUCHING: "등 굽음",
    FORWARD_HEAD: "거북목",
    CAMERA_ANGLE: "각도 재측정 필요",
  };
  return labels[issue] ?? "자세 확인";
}

function formatView(view: MonitorSnapshot["cameraView"], angle: number | null): string {
  if (angle === null || view === "UNKNOWN") return "—";
  const label = { FRONT: "정면", OBLIQUE: "사선", SIDE: "측면", UNKNOWN: "—" }[view];
  return `${label} ${angle.toFixed(0)}°`;
}

function formatSignedDegrees(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}°`;
}

function formatDegrees(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}°`;
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatDuration(durationMs: number): string {
  return durationMs <= 0 ? "지속 시간 —" : `지속 ${(durationMs / 1_000).toFixed(1)}초`;
}

function getPermissionLabel(permission: CameraPermission): string {
  return {
    CHECKING: "카메라 사용 가능 여부 확인 중",
    PROMPT: "시작할 때 카메라 권한을 한 번 요청합니다",
    GRANTED: "카메라 권한 허용됨",
    DENIED: "카메라 권한 차단됨 · 주소창의 카메라 설정을 확인하세요",
    UNAVAILABLE: window.isSecureContext ? "이 브라우저에서는 카메라를 사용할 수 없습니다" : "HTTPS 접속이 필요합니다",
  }[permission];
}

function cameraErrorMessage(cause: unknown): string {
  if (!(cause instanceof DOMException)) return cause instanceof Error ? cause.message : "카메라를 시작하지 못했습니다.";
  if (cause.name === "NotAllowedError" || cause.name === "SecurityError") {
    return "카메라 권한이 차단됐습니다. Chrome 주소창의 사이트 설정 → 카메라 → 허용으로 바꾼 뒤 다시 시작해 주세요.";
  }
  if (cause.name === "NotReadableError" || cause.name === "AbortError") {
    return "다른 앱이 카메라를 사용 중입니다. 카메라 앱이나 화상회의를 종료한 뒤 다시 시도해 주세요.";
  }
  if (cause.name === "NotFoundError" || cause.name === "OverconstrainedError") {
    return "사용 가능한 전면 카메라를 찾지 못했습니다. 기기의 카메라 연결과 Chrome 권한을 확인해 주세요.";
  }
  if (cause.name === "TimeoutError") {
    return "카메라 허용을 기다리는 시간이 초과됐습니다. Chrome의 권한 창에서 허용을 선택한 뒤 다시 시작해 주세요.";
  }
  return `카메라를 시작하지 못했습니다. ${cause.message}`;
}

async function requestUserCamera(constraints: MediaStreamConstraints): Promise<MediaStream> {
  let timedOut = false;
  const request = navigator.mediaDevices.getUserMedia(constraints);
  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => {
      timedOut = true;
      reject(new DOMException("카메라 권한 응답 시간 초과", "TimeoutError"));
    }, 20_000);
  });
  void request.then((stream) => {
    if (timedOut) stream.getTracks().forEach((track) => track.stop());
  }).catch(() => undefined);
  return Promise.race([request, timeout]);
}

async function waitForUsableVideoFrame(video: HTMLVideoElement, timeoutMs = 7_000): Promise<void> {
  const startedAt = performance.now();
  while (!isUsableVideoFrame(video)) {
    if (performance.now() - startedAt >= timeoutMs) {
      throw new Error("카메라 영상 크기를 확인하지 못했습니다. 앱을 다시 시작해 주세요.");
    }
    await nextVideoFrame(video);
  }
}

function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (typeof video.requestVideoFrameCallback === "function") {
    return new Promise((resolve) => {
      let settled = false;
      let timeout = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };
      const callbackId = video.requestVideoFrameCallback(finish);
      timeout = window.setTimeout(() => {
        video.cancelVideoFrameCallback(callbackId);
        finish();
      }, 250);
    });
  }
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);

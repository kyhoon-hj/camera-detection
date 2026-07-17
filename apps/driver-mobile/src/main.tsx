import { Capacitor } from "@capacitor/core";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DriverMonitor, type MonitorSnapshot } from "./monitor";
import { getKoreanSpeechStatus, speakKorean, stopKoreanSpeech } from "./speech";
import {
  MobileVisionEngine,
  VisionFrameUnavailableError,
  drawLandmarks,
  isRecoverableVisionError,
  isUsableVideoFrame,
  visionErrorMessage,
} from "./vision";
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
const isNativeApp = Capacitor.isNativePlatform();

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
  const recoveryRef = useRef(false);
  const cpuRecoveryUsedRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const lastAlertRef = useRef(0);
  const mountedRef = useRef(true);
  const [runState, setRunState] = useState<RunState>("READY");
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState("");
  const [cameraPermission, setCameraPermission] = useState<CameraPermission>("CHECKING");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState("");

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
    if (video && canvas && engine && !recoveryRef.current && isUsableVideoFrame(video) && hasNewFrame && now - lastInferenceRef.current >= 80) {
      lastInferenceRef.current = now;
      lastVideoTimeRef.current = video.currentTime;
      try {
        const frame = engine.detect(video, now);
        const next = monitorRef.current.process(frame);
        setSnapshot(next);
        setError("");
        drawLandmarks(canvas, video, frame, next.status === "ALARM" || next.status === "WARNING");
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

  const start = useCallback(async () => {
    if (!window.isSecureContext) {
      setError("모바일 Chrome 카메라는 HTTPS 주소에서만 사용할 수 있습니다. 안전한 HTTPS 주소로 다시 접속해 주세요.");
      setRunState("ERROR");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저에서는 카메라를 사용할 수 없습니다. HTTPS 또는 설치된 앱에서 실행해 주세요.");
      setRunState("ERROR");
      return;
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
      setRunState("RUNNING");
      animationRef.current = requestAnimationFrame(runDetection);
    } catch (cause) {
      stopResources();
      const message = cameraErrorMessage(cause);
      setError(message);
      if (cause instanceof DOMException && cause.name === "NotAllowedError") setCameraPermission("DENIED");
      setRunState("ERROR");
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
    if (!soundEnabled || runState !== "RUNNING" || snapshot.status === "CALIBRATING" || snapshot.status === "AWAKE") return;
    const now = Date.now();
    const interval = snapshot.status === "ALARM" ? 2_500 : 7_000;
    if (now - lastAlertRef.current < interval) return;
    lastAlertRef.current = now;
    beep(audioRef.current, snapshot.status === "ALARM");
    void speakKorean(snapshot.message).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "음성 안내를 재생하지 못했습니다.";
      setVoiceFeedback(`${message} Android 설정에서 한국어 TTS를 확인해 주세요.`);
    });
  }, [runState, snapshot.message, snapshot.status, soundEnabled]);

  useEffect(() => () => {
    mountedRef.current = false;
    stop();
  }, [stop]);

  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } else {
      setShowInstallHelp((value) => !value);
    }
  };

  const testVoice = async () => {
    setSoundEnabled(true);
    setVoiceFeedback("한국어 음성 엔진을 확인하고 있습니다…");
    try {
      const status = await getKoreanSpeechStatus();
      if (status.error) throw new Error(status.error);
      await speakKorean("수하 드라이버 음성 안내가 정상적으로 작동합니다.");
      setVoiceFeedback("음성 테스트를 재생했습니다.");
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
    <main className={`app status-${snapshot.status.toLowerCase()}`}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark" />SUHA <b>DRIVER</b></div>
        {isNativeApp ? (
          <span className="native-badge">설치형 앱</span>
        ) : (
          <button className="install-button" onClick={() => void install()} aria-expanded={showInstallHelp}>앱 설치</button>
        )}
      </header>

      {showInstallHelp && (
        <aside className="install-help">
          iPhone은 Safari의 <b>공유 → 홈 화면에 추가</b>, Android는 Chrome 메뉴의 <b>앱 설치</b>를 선택하세요.
        </aside>
      )}

      <section className="camera-stage" aria-label="운전자 카메라">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {runState !== "RUNNING" && (
          <div className="camera-placeholder">
            <div className="face-guide"><span /><span /></div>
            <strong>{runState === "LOADING" ? "카메라 허용을 기다리고 있습니다" : "운전자 감지 준비"}</strong>
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

      <section className="status-panel" aria-live="polite">
        <div className="status-heading">
          <div>
            <span className="eyebrow">DRIVER STATUS</span>
            <h1>{calibrating ? "기준 측정 중" : statusLabel}</h1>
          </div>
          <div className="privacy-chip">기기 내 분석</div>
        </div>
        <p className="main-message">{error || snapshot.message}</p>

        <div className="metric-grid">
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
        </div>
      </section>

      <nav className="controls" aria-label="감지 제어">
        {runState === "RUNNING" ? (
          <button className="primary stop" onClick={stop}><span className="stop-icon" />감지 종료</button>
        ) : (
          <button className="primary" onClick={() => void start()} disabled={runState === "LOADING" || cameraPermission === "UNAVAILABLE"}>
            <span className="play-icon" />{runState === "LOADING" ? "준비 중…" : "5초 측정 후 감지 시작"}
          </button>
        )}
        <div className="secondary-controls">
          <button onClick={() => setSoundEnabled((value) => !value)} aria-pressed={soundEnabled}>
            {soundEnabled ? "🔊 경보음 켜짐" : "🔇 경보음 꺼짐"}
          </button>
          <button onClick={() => monitorRef.current.recalibrate()} disabled={runState !== "RUNNING"}>↻ 기준 재측정</button>
          <button className="voice-test" onClick={() => void testVoice()}>🗣 한국어 음성 테스트</button>
        </div>
        {voiceFeedback && <p className="voice-feedback" role="status">{voiceFeedback}</p>}
      </nav>

      <footer>
        <b>안전 안내</b> 이 기능은 실험용 보조 장치이며 운전자의 전방 주시를 대신하지 않습니다. 경고가 발생하면 즉시 안전한 곳에 정차하세요.
      </footer>
    </main>
  );
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

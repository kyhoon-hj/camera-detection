import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { removeBottomBannerAd, showBottomBannerAd, showMenuInterstitialAd, showRewardedDownloadAd } from "./ads";
import { cameraErrorMessage, requestUserCamera, waitForUsableVideoFrame } from "./cameraAccess";
import { applyNativeSafeAreaInsets } from "./displayControl";
import { FIRST_RUN_NOTICE_ACKNOWLEDGED, FIRST_RUN_NOTICE_STORAGE_KEY, shouldShowFirstRunNotice } from "./firstRunNotice";
import { DriverMonitor, type MonitorSnapshot } from "./monitor";
import { getMeditationGuidance } from "./meditation";
import { REMOVE_ADS_PRODUCT_ID, purchaseRemoveAds, restoreRemoveAdsPurchase } from "./purchases";
import { getKoreanSpeechStatus, speakKorean, stopKoreanSpeech } from "./speech";
import { DEFAULT_VOICE_PROFILE } from "./voiceProfiles";
import { SignInterpreterScreen } from "./SignInterpreterScreen";
import { StudyModeScreen } from "./StudyModeScreen";
import { STUDY_REWARDS_STORAGE_KEY, loadStudyRewardState, studyRewardPath } from "./studyRewards";
import {
  STUDY_ENDING_LIBRARY_STORAGE_KEY,
  STUDY_ENDING_VIDEO_PROFILES,
  STUDY_WARNING_LIBRARY_STORAGE_KEY,
  STUDY_WARNING_VIDEO_PROFILES,
  addDownloadedStudyVideo,
  applyDownloadedStudyVideo,
  getStudyEndingVideoProfile,
  getStudyWarningVideoProfile,
  loadStudyEndingLibraryState,
  loadStudyWarningLibraryState,
  type StudyEndingVideoId,
  type StudyVideoLibraryState,
  type StudyWarningVideoId,
} from "./studyVideoProfiles";
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
import {
  WAKE_UP_LIBRARY_STORAGE_KEY,
  addDownloadedWakeUpVideo,
  advanceAlertLatch,
  applyDownloadedWakeUpVideo,
  getAppliedWakeUpVideoPath,
  getForcedWakeUpReason,
  getWakeUpCountActivity,
  getWakeUpDecision,
  getWakeUpVideoProfile,
  loadWakeUpLibraryState,
  orderWakeUpVideoProfiles,
  type WakeUpLibraryState,
  type WakeUpReason,
  type WakeUpVideoId,
} from "./wakeUpVideos";
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
type AppModule = "HOME" | "DROWSINESS" | "STUDY" | "POSTURE" | "MEDITATION" | "SIGN" | "WIDGET";
type TimelineMode = "DROWSINESS" | "POSTURE";

interface TimelineSample {
  elapsedSeconds: number;
  risk: 0 | 1 | 2 | 3;
  eyeCount: number;
  headCount: number;
  auxiliaryCount: number;
}
const isNativeApp = Capacitor.isNativePlatform();
const WIDGET_STORAGE_KEY = "suha.translation-widget.v1";
const ADS_REMOVED_STORAGE_KEY = "suha.ads-removed.v1";
const ACTIVE_MONITOR_MODULE_STORAGE_KEY = "suha.active-monitor-module.v1";

function loadActiveMonitorModule(): AppModule {
  try {
    if (new URLSearchParams(window.location.search).get("mode")?.toLowerCase() === "study") {
      return "STUDY";
    }
    const saved = sessionStorage.getItem(ACTIVE_MONITOR_MODULE_STORAGE_KEY);
    return saved === "DROWSINESS" || saved === "POSTURE" ? saved : "HOME";
  } catch {
    return "HOME";
  }
}

function loadWidgetSettings(): WidgetSettings {
  try {
    return normalizeWidgetSettings(JSON.parse(localStorage.getItem(WIDGET_STORAGE_KEY) || "{}") as Partial<WidgetSettings>);
  } catch {
    return DEFAULT_WIDGET_SETTINGS;
  }
}

function loadAdsRemoved(): boolean {
  return localStorage.getItem(ADS_REMOVED_STORAGE_KEY) === "true";
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
  baselineDeviated: false,
  baselineGuide: null,
  combinedDurationMs: 0,
  bodyCollapseDurationMs: 0,
  bodyCollapseCountReady: false,
  postureStatus: "WAITING",
  postureIssue: "NONE",
  postureScore: null,
  postureConfidence: 0,
  postureMessage: "기준 측정 전입니다.",
  shoulderTiltDegrees: null,
  headLeanDegrees: null,
  torsoLeanDegrees: null,
  forwardHeadPercent: null,
  cameraViewAngleDegrees: null,
  cameraView: "UNKNOWN",
  calibrationProgress: 0,
  calibrationRemainingMs: 5_000,
  calibrationStable: false,
};

function App() {
  const initialActiveModuleRef = useRef<AppModule | null>(null);
  initialActiveModuleRef.current ??= loadActiveMonitorModule();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wakeUpVideoRef = useRef<HTMLVideoElement>(null);
  const initialWakeUpLibraryRef = useRef<WakeUpLibraryState | null>(null);
  initialWakeUpLibraryRef.current ??= loadWakeUpLibraryState(localStorage.getItem(WAKE_UP_LIBRARY_STORAGE_KEY));
  const appliedWakeUpVideoPathRef = useRef(getAppliedWakeUpVideoPath(initialWakeUpLibraryRef.current));
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
  const eyeClosureAlertActiveRef = useRef(false);
  const headDownAlertActiveRef = useRef(false);
  const eyeAlertClearedAtRef = useRef<number | null>(null);
  const headAlertClearedAtRef = useRef<number | null>(null);
  const eyeClosureAlertCountRef = useRef(0);
  const headDownAlertCountRef = useRef(0);
  const sessionEyeClosureCountRef = useRef(0);
  const sessionHeadDownCountRef = useRef(0);
  const sessionVideoWarningCountRef = useRef(0);
  const postureBlinkActiveRef = useRef(false);
  const postureHeadDownActiveRef = useRef(false);
  const postureSeatAwayActiveRef = useRef(false);
  const postureBlinkCountRef = useRef(0);
  const postureHeadDownCountRef = useRef(0);
  const postureSeatAwayCountRef = useRef(0);
  const sessionStartedAtRef = useRef(0);
  const lastTimelineSampleRef = useRef(0);
  const wakeUpVideoPlayingRef = useRef(false);
  const forcedWakeUpActiveRef = useRef(false);
  const meditationCueRef = useRef("");
  const activeModuleRef = useRef<AppModule>(initialActiveModuleRef.current);
  const drowsyNoticeAcceptedRef = useRef(false);
  const mountedRef = useRef(true);
  const [runState, setRunState] = useState<RunState>("READY");
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState("");
  const [showFirstRunNotice, setShowFirstRunNotice] = useState(() => shouldShowFirstRunNotice(localStorage.getItem(FIRST_RUN_NOTICE_STORAGE_KEY)));
  const [cameraPermission, setCameraPermission] = useState<CameraPermission>("CHECKING");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState("");
  const [activeTab, setActiveTab] = useState<MobileTab>("MONITOR");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [activeModule, setActiveModule] = useState<AppModule>(initialActiveModuleRef.current);
  const [widgetSettings, setWidgetSettings] = useState(loadWidgetSettings);
  const [wakeUpLibrary, setWakeUpLibrary] = useState<WakeUpLibraryState>(() => initialWakeUpLibraryRef.current!);
  const [selectedWakeUpVideoId, setSelectedWakeUpVideoId] = useState<WakeUpVideoId>(() => initialWakeUpLibraryRef.current!.appliedId);
  const [pendingWakeUpApplyId, setPendingWakeUpApplyId] = useState<WakeUpVideoId | null>(null);
  const [wakeUpDownloadBusy, setWakeUpDownloadBusy] = useState(false);
  const [, setWakeUpLibraryFeedback] = useState("");
  const [studyWarningLibrary, setStudyWarningLibrary] = useState<StudyVideoLibraryState<StudyWarningVideoId>>(
    () => loadStudyWarningLibraryState(localStorage.getItem(STUDY_WARNING_LIBRARY_STORAGE_KEY)),
  );
  const [selectedStudyWarningVideoId, setSelectedStudyWarningVideoId] = useState<StudyWarningVideoId>(
    () => loadStudyWarningLibraryState(localStorage.getItem(STUDY_WARNING_LIBRARY_STORAGE_KEY)).appliedId,
  );
  const [studyWarningDownloadBusy, setStudyWarningDownloadBusy] = useState(false);
  const [studyEndingLibrary, setStudyEndingLibrary] = useState<StudyVideoLibraryState<StudyEndingVideoId>>(
    () => loadStudyEndingLibraryState(localStorage.getItem(STUDY_ENDING_LIBRARY_STORAGE_KEY)),
  );
  const [selectedStudyEndingVideoId, setSelectedStudyEndingVideoId] = useState<StudyEndingVideoId>(
    () => loadStudyEndingLibraryState(localStorage.getItem(STUDY_ENDING_LIBRARY_STORAGE_KEY)).appliedId,
  );
  const [studyEndingDownloadBusy, setStudyEndingDownloadBusy] = useState(false);
  const [meditationSeconds, setMeditationSeconds] = useState(300);
  const [meditationRunning, setMeditationRunning] = useState(false);
  const [showDrowsyNotice, setShowDrowsyNotice] = useState(false);
  const [showSignComingSoon, setShowSignComingSoon] = useState(false);
  const [comingSoonModule, setComingSoonModule] = useState<"SIGN" | "POSTURE" | "MEDITATION">("SIGN");
  const [adsRemoved, setAdsRemoved] = useState(loadAdsRemoved);
  const [showRemoveAdsDialog, setShowRemoveAdsDialog] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [purchaseFeedback, setPurchaseFeedback] = useState("");
  const [wakeUpVideoPlaying, setWakeUpVideoPlaying] = useState(false);
  const [wakeUpVideoNeedsTap, setWakeUpVideoNeedsTap] = useState(false);
  const [, setEyeClosureAlertCount] = useState(0);
  const [sessionEyeClosureCount, setSessionEyeClosureCount] = useState(0);
  const [sessionHeadDownCount, setSessionHeadDownCount] = useState(0);
  const [postureBlinkCount, setPostureBlinkCount] = useState(0);
  const [postureHeadDownCount, setPostureHeadDownCount] = useState(0);
  const [postureSeatAwayCount, setPostureSeatAwayCount] = useState(0);
  const [timelineSamples, setTimelineSamples] = useState<TimelineSample[]>([]);
  const [wakeUpVideoSrc, setWakeUpVideoSrc] = useState<string>(appliedWakeUpVideoPathRef.current);
  const [wakeUpVideoReason, setWakeUpVideoReason] = useState<WakeUpReason>("EYES");

  const requestWakeLock = useCallback(async () => {
    try {
      const manager = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
      if (manager && document.visibilityState === "visible") wakeLockRef.current = await manager.request("screen");
    } catch {
      wakeLockRef.current = null;
    }
  }, []);

  const resetWakeUpVideo = useCallback(() => {
    const alertVideo = wakeUpVideoRef.current;
    if (alertVideo) {
      alertVideo.pause();
      alertVideo.currentTime = 0;
    }
    wakeUpVideoPlayingRef.current = false;
    eyeClosureAlertActiveRef.current = false;
    eyeAlertClearedAtRef.current = null;
    headAlertClearedAtRef.current = null;
    eyeClosureAlertCountRef.current = 0;
    headDownAlertCountRef.current = 0;
    setWakeUpVideoPlaying(false);
    setWakeUpVideoNeedsTap(false);
    setEyeClosureAlertCount(0);
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
    resetWakeUpVideo();
    headDownAlertActiveRef.current = false;
    eyeAlertClearedAtRef.current = null;
    headAlertClearedAtRef.current = null;
    postureBlinkActiveRef.current = false;
    postureHeadDownActiveRef.current = false;
    postureSeatAwayActiveRef.current = false;
    forcedWakeUpActiveRef.current = false;
  }, [resetWakeUpVideo]);

  const stop = useCallback(() => {
    stopResources();
    monitorRef.current.stop();
    setSnapshot(initialSnapshot);
    setError("");
    setRunState("READY");
  }, [stopResources]);

  const runDetection = useCallback(() => {
    if (!mountedRef.current || streamRef.current === null) return;
    if (wakeUpVideoPlayingRef.current) {
      animationRef.current = requestAnimationFrame(runDetection);
      return;
    }
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
        const wakeUpCountActivity = getWakeUpCountActivity(next);
        const drowsinessCounting = activeModuleRef.current === "DROWSINESS";
        const eyeClosureAlertActive = drowsinessCounting && wakeUpCountActivity.eye;
        const headDownAlertActive = drowsinessCounting && wakeUpCountActivity.head;
        const forcedWakeUpReason = drowsinessCounting ? getForcedWakeUpReason(next) : null;
        if (forcedWakeUpReason === null) forcedWakeUpActiveRef.current = false;
        const wakeUpDecision = getWakeUpDecision({
          eyeAlertActive: eyeClosureAlertActive,
          eyeAlertWasActive: eyeClosureAlertActiveRef.current,
          headAlertActive: headDownAlertActive,
          headAlertWasActive: headDownAlertActiveRef.current,
          eyeClosureCount: eyeClosureAlertCountRef.current,
          headDownCount: headDownAlertCountRef.current,
        });
        if (wakeUpDecision.eyeClosureCount !== eyeClosureAlertCountRef.current) {
          eyeClosureAlertCountRef.current = wakeUpDecision.eyeClosureCount;
          setEyeClosureAlertCount(wakeUpDecision.eyeClosureCount);
          sessionEyeClosureCountRef.current += 1;
          setSessionEyeClosureCount(sessionEyeClosureCountRef.current);
        }
        if (wakeUpDecision.headDownCount !== headDownAlertCountRef.current) {
          headDownAlertCountRef.current = wakeUpDecision.headDownCount;
          sessionHeadDownCountRef.current += 1;
          setSessionHeadDownCount(sessionHeadDownCountRef.current);
        }
        const postureMonitoring = activeModuleRef.current === "POSTURE" && next.status !== "CALIBRATING";
        const postureBlinkActive = postureMonitoring && next.eyesClosed;
        if (postureMonitoring && postureBlinkActiveRef.current && !postureBlinkActive) {
          postureBlinkCountRef.current += 1;
          setPostureBlinkCount(postureBlinkCountRef.current);
        }
        const postureHeadDownActive = postureMonitoring && next.headDownDurationMs >= 2_000;
        if (postureHeadDownActive && !postureHeadDownActiveRef.current) {
          postureHeadDownCountRef.current += 1;
          setPostureHeadDownCount(postureHeadDownCountRef.current);
        }
        const postureSeatAwayActive = postureMonitoring
          && next.trigger === "FACE_MISSING"
          && (next.status === "WARNING" || next.status === "DANGER");
        if (postureSeatAwayActive && !postureSeatAwayActiveRef.current) {
          postureSeatAwayCountRef.current += 1;
          setPostureSeatAwayCount(postureSeatAwayCountRef.current);
        }
        const wakeUpReason = wakeUpDecision.reason
          ?? (forcedWakeUpReason !== null && !forcedWakeUpActiveRef.current ? forcedWakeUpReason : null);
        if (wakeUpReason !== null && !wakeUpVideoPlayingRef.current) {
          const selectedVideo = appliedWakeUpVideoPathRef.current;
          setWakeUpVideoSrc(selectedVideo);
          setWakeUpVideoReason(wakeUpReason);
          activeModuleRef.current = "DROWSINESS";
          setActiveModule("DROWSINESS");
          setActiveTab("MONITOR");
          forcedWakeUpActiveRef.current = true;
          eyeClosureAlertCountRef.current = 0;
          headDownAlertCountRef.current = 0;
          sessionEyeClosureCountRef.current = 0;
          sessionHeadDownCountRef.current = 0;
          setEyeClosureAlertCount(0);
          setSessionEyeClosureCount(0);
          setSessionHeadDownCount(0);
          sessionVideoWarningCountRef.current += 1;
          wakeUpVideoPlayingRef.current = true;
          setWakeUpVideoNeedsTap(false);
          setWakeUpVideoPlaying(true);
          void stopKoreanSpeech();
        }
        updateAlertLatch(eyeClosureAlertActiveRef, eyeAlertClearedAtRef, eyeClosureAlertActive, now);
        updateAlertLatch(headDownAlertActiveRef, headAlertClearedAtRef, headDownAlertActive, now);
        postureBlinkActiveRef.current = postureBlinkActive;
        postureHeadDownActiveRef.current = postureHeadDownActive;
        postureSeatAwayActiveRef.current = postureSeatAwayActive;
        const timelineMode = activeModuleRef.current === "POSTURE" ? "POSTURE" : "DROWSINESS";
        if (next.status !== "CALIBRATING" && now - lastTimelineSampleRef.current >= 1_000) {
          lastTimelineSampleRef.current = now;
          const risk: TimelineSample["risk"] = next.status === "DANGER"
            ? 3
            : next.status === "WARNING" || next.postureStatus === "WARNING"
              ? 2
              : next.status === "CAUTION" || next.status === "NO_FACE"
                ? 1
                : 0;
          const sample: TimelineSample = {
            elapsedSeconds: Math.max(0, (now - sessionStartedAtRef.current) / 1_000),
            risk,
            eyeCount: timelineMode === "POSTURE" ? postureBlinkCountRef.current : sessionEyeClosureCountRef.current,
            headCount: timelineMode === "POSTURE" ? postureHeadDownCountRef.current : sessionHeadDownCountRef.current,
            auxiliaryCount: timelineMode === "POSTURE" ? postureSeatAwayCountRef.current : sessionVideoWarningCountRef.current,
          };
          setTimelineSamples((samples) => [...samples, sample].slice(-300));
        }
        const showWarning = activeModuleRef.current !== "MEDITATION" && (next.status === "DANGER" || next.status === "WARNING");
        drawLandmarks(
          canvas,
          video,
          frame,
          showWarning,
          activeModuleRef.current === "POSTURE",
          null,
          false,
        );
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
    resetWakeUpVideo();
    sessionEyeClosureCountRef.current = 0;
    sessionHeadDownCountRef.current = 0;
    sessionVideoWarningCountRef.current = 0;
    setSessionEyeClosureCount(0);
    setSessionHeadDownCount(0);
    postureBlinkCountRef.current = 0;
    postureHeadDownCountRef.current = 0;
    postureSeatAwayCountRef.current = 0;
    forcedWakeUpActiveRef.current = false;
    sessionStartedAtRef.current = performance.now();
    lastTimelineSampleRef.current = 0;
    setPostureBlinkCount(0);
    setPostureHeadDownCount(0);
    setPostureSeatAwayCount(0);
    setTimelineSamples([]);
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
      monitorRef.current.begin(activeModuleRef.current === "POSTURE" ? "POSTURE" : "DROWSINESS");
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
  }, [requestWakeLock, resetWakeUpVideo, runDetection, soundEnabled, stopResources]);

  const finishWakeUpVideo = useCallback(() => {
    resetWakeUpVideo();
    // An ongoing condition must clear before it can count toward the next cycle.
    eyeClosureAlertActiveRef.current = true;
    headDownAlertActiveRef.current = true;
    lastInferenceRef.current = 0;
    lastVideoTimeRef.current = -1;
    lastVideoProgressRef.current = performance.now();
    setError("");
  }, [resetWakeUpVideo]);

  const playWakeUpVideo = useCallback(async () => {
    const alertVideo = wakeUpVideoRef.current;
    if (!alertVideo) return;
    try {
      alertVideo.muted = false;
      alertVideo.volume = 1;
      await alertVideo.play();
      setWakeUpVideoNeedsTap(false);
    } catch {
      setWakeUpVideoNeedsTap(true);
    }
  }, []);

  useEffect(() => {
    if (!wakeUpVideoPlaying) return;
    const alertVideo = wakeUpVideoRef.current;
    if (!alertVideo) return;
    alertVideo.currentTime = 0;
    alertVideo.muted = false;
    alertVideo.volume = 1;
    void playWakeUpVideo();
  }, [playWakeUpVideo, wakeUpVideoPlaying, wakeUpVideoSrc]);

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
        if (wakeUpVideoPlayingRef.current) return;
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
      setError("화면 방향이 변경되어 카메라를 안전하게 종료했습니다. 현재 방향에서 다시 시작해 기준 위치를 측정해 주세요.");
    };
    window.addEventListener("orientationchange", handleOrientationChange);
    return () => window.removeEventListener("orientationchange", handleOrientationChange);
  }, [runState, stop]);

  useEffect(() => {
    if (wakeUpVideoPlaying || activeModule === "MEDITATION" || !soundEnabled || runState !== "RUNNING" || snapshot.status === "CALIBRATING" || snapshot.status === "NORMAL") return;
    const now = Date.now();
    const interval = snapshot.status === "DANGER" ? 2_500 : snapshot.status === "WARNING" ? 5_000 : 7_000;
    if (now - lastAlertRef.current < interval) return;
    lastAlertRef.current = now;
    beep(audioRef.current, snapshot.status === "DANGER");
    void speakKorean(snapshot.message).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "음성 안내를 재생하지 못했습니다.";
      setVoiceFeedback(`${message} Android 설정에서 한국어 TTS를 확인해 주세요.`);
    });
  }, [activeModule, runState, snapshot.message, snapshot.status, soundEnabled, wakeUpVideoPlaying]);

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
    void speakKorean(cue).catch(() => undefined);
  }, [activeModule, meditationGuidance.voiceCue, soundEnabled]);

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

  useEffect(() => {
    try {
      if (activeModule === "DROWSINESS" || activeModule === "POSTURE") {
        sessionStorage.setItem(ACTIVE_MONITOR_MODULE_STORAGE_KEY, activeModule);
      } else {
        sessionStorage.removeItem(ACTIVE_MONITOR_MODULE_STORAGE_KEY);
      }
    } catch {
      // Some embedded browsers can disable session storage; the app still works without it.
    }
  }, [activeModule]);

  const bannerSuppressed = activeModule === "STUDY" || showDrowsyNotice || showFirstRunNotice || showRemoveAdsDialog || showSignComingSoon;

  useEffect(() => {
    if (!isNativeApp) return;
    let updateTimer = 0;
    const updateInsets = () => {
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(() => void applyNativeSafeAreaInsets(), 120);
    };
    void applyNativeSafeAreaInsets();
    window.addEventListener("resize", updateInsets);
    window.addEventListener("orientationchange", updateInsets);
    return () => {
      window.clearTimeout(updateTimer);
      window.removeEventListener("resize", updateInsets);
      window.removeEventListener("orientationchange", updateInsets);
    };
  }, []);

  useEffect(() => {
    if (adsRemoved || bannerSuppressed) void removeBottomBannerAd();
    else void showBottomBannerAd();
    return () => {
      void removeBottomBannerAd();
    };
  }, [adsRemoved, bannerSuppressed]);

  const openModule = useCallback(async (module: AppModule) => {
    if (module === activeModuleRef.current) return;
    if (module === "SIGN" || module === "POSTURE" || module === "MEDITATION") {
      setComingSoonModule(module);
      setShowSignComingSoon(true);
      return;
    }
    if (!adsRemoved) await showMenuInterstitialAd();
    if (module !== "DROWSINESS") stop();
    activeModuleRef.current = module;
    meditationCueRef.current = "";
    if (module === "DROWSINESS") {
      drowsyNoticeAcceptedRef.current = false;
      setShowDrowsyNotice(true);
    }
    setActiveModule(module);
    if (module === "DROWSINESS") setActiveTab("MONITOR");
  }, [adsRemoved, stop]);

  const completeRemoveAdsPurchase = useCallback(() => {
    localStorage.setItem(ADS_REMOVED_STORAGE_KEY, "true");
    setAdsRemoved(true);
    setPurchaseFeedback("광고 제거가 적용되었습니다. 배너와 전면 광고가 더 이상 표시되지 않습니다.");
    void removeBottomBannerAd();
  }, []);

  const buyRemoveAds = useCallback(async () => {
    setPurchaseBusy(true);
    setPurchaseFeedback("");
    try {
      const result = await purchaseRemoveAds();
      if (result.success) completeRemoveAdsPurchase();
      else setPurchaseFeedback(result.message);
    } catch (cause) {
      setPurchaseFeedback(cause instanceof Error ? cause.message : "결제를 시작하지 못했습니다.");
    } finally {
      setPurchaseBusy(false);
    }
  }, [completeRemoveAdsPurchase]);

  const restoreRemoveAds = useCallback(async () => {
    setPurchaseBusy(true);
    setPurchaseFeedback("");
    try {
      const result = await restoreRemoveAdsPurchase();
      if (result.success) completeRemoveAdsPurchase();
      else setPurchaseFeedback(result.message);
    } catch (cause) {
      setPurchaseFeedback(cause instanceof Error ? cause.message : "구매 복원을 확인하지 못했습니다.");
    } finally {
      setPurchaseBusy(false);
    }
  }, [completeRemoveAdsPurchase]);

  const goHome = useCallback(() => {
    if (runState === "RUNNING" && !window.confirm("감지를 종료하고 홈 화면으로 이동할까요?")) return;
    stop();
    setMeditationRunning(false);
    setShowDrowsyNotice(false);
    drowsyNoticeAcceptedRef.current = false;
    activeModuleRef.current = "HOME";
    try {
      sessionStorage.removeItem(ACTIVE_MONITOR_MODULE_STORAGE_KEY);
    } catch {
      // Ignore storage restrictions in embedded browsers.
    }
    meditationCueRef.current = "";
    setActiveModule("HOME");
  }, [runState, stop]);

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

  const testVoice = async () => {
    setSoundEnabled(true);
    setVoiceFeedback("한국어 음성 엔진을 확인하고 있습니다…");
    try {
      const status = await getKoreanSpeechStatus();
      if (status.error) throw new Error(status.error);
      await speakKorean(DEFAULT_VOICE_PROFILE.sample);
      setVoiceFeedback("기본 안내 음성 테스트를 재생했습니다.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "한국어 음성 엔진을 사용할 수 없습니다.";
      setVoiceFeedback(`${message} Android 설정 → 일반 관리 → 글자 읽어주기에서 한국어 음성을 설치해 주세요.`);
    }
  };

  const acknowledgeFirstRunNotice = () => {
    localStorage.setItem(FIRST_RUN_NOTICE_STORAGE_KEY, FIRST_RUN_NOTICE_ACKNOWLEDGED);
    setShowFirstRunNotice(false);
  };

  useEffect(() => {
    if (!isNativeApp) return;
    const removeListener = CapacitorApp.addListener("backButton", () => {
      if (showFirstRunNotice) {
        setShowFirstRunNotice(false);
        return;
      }
      if (showRemoveAdsDialog) {
        setShowRemoveAdsDialog(false);
        return;
      }
      if (showDrowsyNotice) {
        goHome();
        return;
      }
      if (showSignComingSoon) {
        setShowSignComingSoon(false);
        return;
      }
      if (wakeUpVideoPlayingRef.current) {
        finishWakeUpVideo();
        return;
      }
      if (showInstallHelp) {
        setShowInstallHelp(false);
        return;
      }
      if (detailsExpanded) {
        setDetailsExpanded(false);
        return;
      }
      if (activeTab === "SETTINGS") {
        setActiveTab("MONITOR");
        return;
      }
      if (activeModule !== "HOME") {
        goHome();
      }
    });
    return () => {
      void removeListener.then((listener) => listener.remove());
    };
  }, [
    activeModule,
    activeTab,
    detailsExpanded,
    finishWakeUpVideo,
    goHome,
    showDrowsyNotice,
    showFirstRunNotice,
    showInstallHelp,
    showRemoveAdsDialog,
    showSignComingSoon,
  ]);

  const persistWakeUpLibrary = useCallback((next: WakeUpLibraryState) => {
    localStorage.setItem(WAKE_UP_LIBRARY_STORAGE_KEY, JSON.stringify(next));
    setWakeUpLibrary(next);
  }, []);

  const selectWakeUpVideo = useCallback((id: WakeUpVideoId) => {
    const profile = getWakeUpVideoProfile(id);
    const downloaded = wakeUpLibrary.downloadedIds.includes(id);
    setSelectedWakeUpVideoId(id);
    if (!downloaded) {
      setPendingWakeUpApplyId(null);
      setWakeUpLibraryFeedback(`${profile.name} 영상을 받으려면 아래 다운로드 버튼을 눌러 주세요.`);
      return;
    }
    if (wakeUpLibrary.appliedId === id) {
      setPendingWakeUpApplyId(null);
      setWakeUpLibraryFeedback(`${profile.name} 영상이 현재 적용되어 있습니다.`);
      return;
    }
    if (pendingWakeUpApplyId === id) {
      const next = applyDownloadedWakeUpVideo(wakeUpLibrary, id);
      persistWakeUpLibrary(next);
      appliedWakeUpVideoPathRef.current = profile.path;
      setWakeUpVideoSrc(profile.path);
      setPendingWakeUpApplyId(null);
      setWakeUpLibraryFeedback(`${profile.name} 영상이 졸음 경고에 적용되었습니다.`);
      return;
    }
    setPendingWakeUpApplyId(id);
    setWakeUpLibraryFeedback(`${profile.name} 영상을 한 번 더 터치하면 적용됩니다.`);
  }, [pendingWakeUpApplyId, persistWakeUpLibrary, wakeUpLibrary]);

  const downloadSelectedWakeUpVideo = useCallback(async () => {
    const profile = getWakeUpVideoProfile(selectedWakeUpVideoId);
    if (wakeUpDownloadBusy) return;
    const downloaded = wakeUpLibrary.downloadedIds.includes(profile.id);
    if (downloaded) {
      if (wakeUpLibrary.appliedId === profile.id) return;
      const next = applyDownloadedWakeUpVideo(wakeUpLibrary, profile.id);
      persistWakeUpLibrary(next);
      appliedWakeUpVideoPathRef.current = profile.path;
      setWakeUpVideoSrc(profile.path);
      setPendingWakeUpApplyId(null);
      setWakeUpLibraryFeedback(`${profile.name} 영상이 졸음 경고에 적용되었습니다.`);
      return;
    }
    setWakeUpDownloadBusy(true);
    setWakeUpLibraryFeedback("보상형 동영상 광고를 끝까지 시청하면 영상 다운로드가 시작됩니다.");
    try {
      const rewarded = await showRewardedDownloadAd();
      if (!rewarded) {
        setWakeUpLibraryFeedback("동영상 광고 시청 보상이 확인되지 않아 다운로드를 시작하지 않았습니다.");
        return;
      }
      const response = await fetch(profile.path, { cache: "force-cache" });
      if (!response.ok) throw new Error("영상 파일을 받지 못했습니다.");
      if ("caches" in window) {
        const cache = await window.caches.open("suha-wake-up-videos-v1");
        await cache.put(profile.path, response.clone());
      }
      const next = addDownloadedWakeUpVideo(wakeUpLibrary, profile.id);
      persistWakeUpLibrary(next);
      setPendingWakeUpApplyId(profile.id);
      setWakeUpLibraryFeedback(`${profile.name} 다운로드 완료 · 영상 카드를 한 번 더 터치하면 적용됩니다.`);
    } catch (cause) {
      setWakeUpLibraryFeedback(cause instanceof Error ? cause.message : "영상 다운로드 중 문제가 발생했습니다.");
    } finally {
      setWakeUpDownloadBusy(false);
    }
  }, [persistWakeUpLibrary, selectedWakeUpVideoId, wakeUpDownloadBusy, wakeUpLibrary]);

  const persistStudyWarningLibrary = useCallback((next: StudyVideoLibraryState<StudyWarningVideoId>) => {
    localStorage.setItem(STUDY_WARNING_LIBRARY_STORAGE_KEY, JSON.stringify(next));
    setStudyWarningLibrary(next);
  }, []);

  const persistStudyEndingLibrary = useCallback((next: StudyVideoLibraryState<StudyEndingVideoId>) => {
    localStorage.setItem(STUDY_ENDING_LIBRARY_STORAGE_KEY, JSON.stringify(next));
    setStudyEndingLibrary(next);
  }, []);

  const downloadOrApplySelectedStudyWarningVideo = useCallback(async () => {
    if (studyWarningDownloadBusy) return;
    const profile = getStudyWarningVideoProfile(selectedStudyWarningVideoId);
    if (studyWarningLibrary.downloadedIds.includes(profile.id)) {
      persistStudyWarningLibrary(applyDownloadedStudyVideo(studyWarningLibrary, profile.id));
      return;
    }
    setStudyWarningDownloadBusy(true);
    try {
      const rewarded = await showRewardedDownloadAd();
      if (!rewarded) return;
      const response = await fetch(profile.path, { cache: "force-cache" });
      if (!response.ok) throw new Error("열공 경고 영상을 받지 못했습니다.");
      if ("caches" in window) {
        const cache = await window.caches.open("suha-study-warning-v1");
        await cache.put(profile.path, response.clone());
      }
      persistStudyWarningLibrary(addDownloadedStudyVideo(studyWarningLibrary, profile.id));
    } finally {
      setStudyWarningDownloadBusy(false);
    }
  }, [
    persistStudyWarningLibrary,
    selectedStudyWarningVideoId,
    studyWarningDownloadBusy,
    studyWarningLibrary,
  ]);

  const downloadOrApplySelectedStudyEndingVideo = useCallback(async () => {
    if (studyEndingDownloadBusy) return;
    const profile = getStudyEndingVideoProfile(selectedStudyEndingVideoId);
    if (studyEndingLibrary.downloadedIds.includes(profile.id)) {
      persistStudyEndingLibrary(applyDownloadedStudyVideo(studyEndingLibrary, profile.id));
      return;
    }
    setStudyEndingDownloadBusy(true);
    try {
      const rewarded = await showRewardedDownloadAd();
      if (!rewarded) return;
      const response = await fetch(profile.path, { cache: "force-cache" });
      if (!response.ok) throw new Error("공부 종료 영상을 받지 못했습니다.");
      if ("caches" in window) {
        const cache = await window.caches.open("suha-study-ending-v1");
        await cache.put(profile.path, response.clone());
      }
      persistStudyEndingLibrary(addDownloadedStudyVideo(studyEndingLibrary, profile.id));
    } finally {
      setStudyEndingDownloadBusy(false);
    }
  }, [
    persistStudyEndingLibrary,
    selectedStudyEndingVideoId,
    studyEndingDownloadBusy,
    studyEndingLibrary,
  ]);

  const calibrating = snapshot.status === "CALIBRATING";
  const countdown = Math.max(1, Math.ceil(snapshot.calibrationRemainingMs / 1_000));
  const statusLabel = getStatusLabel(snapshot.status);
  const postureLabel = getPostureLabel(snapshot.postureStatus, snapshot.postureIssue);
  const postureBaselineDeviated = snapshot.postureStatus === "WARNING";
  const shoulderDeviated = snapshot.postureIssue === "SHOULDER_TILT";
  const drowsinessActivity = getWakeUpCountActivity(snapshot);
  const permissionLabel = getPermissionLabel(cameraPermission);

  return (
    <main className={`app module-${activeModule.toLowerCase()} ${isNativeApp ? "native-app" : ""} status-${activeModule === "MEDITATION" ? "awake" : snapshot.status.toLowerCase()}`}>
      {showFirstRunNotice && createPortal(<FirstRunNotice onConfirm={acknowledgeFirstRunNotice} />, document.body)}
      <header className="topbar">
        <div className="brand-lockup">
          {activeModule !== "HOME" && activeModule !== "STUDY" && <button className="header-icon back" onClick={goHome} aria-label="이전 화면">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
          </button>}
          {activeModule !== "STUDY" && <div className="brand" aria-label="졸방">
            <img src="/icon-192.png" alt="" />
            <span>졸방</span>
          </div>}
        </div>
        {activeModule !== "STUDY" && <button className="header-icon" onClick={() => void (async () => {
          if (activeModule !== "DROWSINESS" && activeModule !== "POSTURE") {
            if (!adsRemoved) await showMenuInterstitialAd();
            stop();
            activeModuleRef.current = "DROWSINESS";
            setActiveModule("DROWSINESS");
          }
          setActiveTab("SETTINGS");
        })()} aria-label="설정 열기">⚙</button>}
      </header>

      {activeModule === "HOME" && <HomeScreen
        onOpen={openModule}
        widgetSettings={widgetSettings}
        wakeUpLibrary={wakeUpLibrary}
        selectedWakeUpVideoId={selectedWakeUpVideoId}
        pendingWakeUpApplyId={pendingWakeUpApplyId}
        downloadBusy={wakeUpDownloadBusy}
        onSelectWakeUpVideo={selectWakeUpVideo}
        onDownloadWakeUpVideo={() => void downloadSelectedWakeUpVideo()}
        studyWarningLibrary={studyWarningLibrary}
        selectedStudyWarningVideoId={selectedStudyWarningVideoId}
        studyWarningDownloadBusy={studyWarningDownloadBusy}
        onSelectStudyWarningVideo={setSelectedStudyWarningVideoId}
        onDownloadOrApplyStudyWarningVideo={() => void downloadOrApplySelectedStudyWarningVideo()}
        studyEndingLibrary={studyEndingLibrary}
        selectedStudyEndingVideoId={selectedStudyEndingVideoId}
        studyEndingDownloadBusy={studyEndingDownloadBusy}
        onSelectStudyEndingVideo={setSelectedStudyEndingVideoId}
        onDownloadOrApplyStudyEndingVideo={() => void downloadOrApplySelectedStudyEndingVideo()}
      />}
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
      {activeModule === "STUDY" && <StudyModeScreen
        onExit={goHome}
        alertVideoPath={getStudyWarningVideoProfile(studyWarningLibrary.appliedId).path}
        endingVideoPath={getStudyEndingVideoProfile(studyEndingLibrary.appliedId).path}
        adsRemoved={adsRemoved}
      />}
      {activeModule === "SIGN" && <SignInterpreterScreen widgetSettings={widgetSettings} onWidget={() => void openModule("WIDGET")} />}
      {activeModule === "WIDGET" && <WidgetSettingsScreen settings={widgetSettings} onUpdate={updateWidgetSettings} />}
      {showSignComingSoon && <SignComingSoonDialog module={comingSoonModule} onClose={() => setShowSignComingSoon(false)} />}

      {(activeModule === "DROWSINESS" || activeModule === "POSTURE") && <>

      {showInstallHelp && (
        <aside className="install-help">
          iPhone은 Safari의 <b>공유 → 홈 화면에 추가</b>, Android는 Chrome 메뉴의 <b>앱 설치</b>를 선택하세요.
        </aside>
      )}

      <section className={`camera-stage ${activeTab!=="MONITOR"?"mobile-screen-hidden":""}`} aria-label={activeModule === "POSTURE" ? "자세 교정 카메라" : "운전자 카메라"}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        <div className={`wake-up-overlay ${wakeUpVideoPlaying ? "playing" : ""}`} aria-hidden={!wakeUpVideoPlaying}>
          <video
            ref={wakeUpVideoRef}
            className="wake-up-video"
            src={wakeUpVideoSrc}
            playsInline
            preload="auto"
            aria-label="졸음운전 깨우기 경고 영상"
            onEnded={finishWakeUpVideo}
            onError={() => {
              finishWakeUpVideo();
              setError("경고 영상을 재생하지 못했습니다. 카메라 감지를 계속합니다.");
            }}
          />
          {wakeUpVideoPlaying && wakeUpVideoNeedsTap && (
            <button className="wake-up-video-play-button" onClick={() => void playWakeUpVideo()}>영상 재생</button>
          )}
        </div>
        {runState !== "RUNNING" && (
          <div className="camera-placeholder">
            <div className="face-guide"><span /><span /></div>
            <strong>{runState === "LOADING" ? "카메라 허용을 기다리고 있습니다" : activeModule === "POSTURE" ? "자세 교정 준비" : "운전자 감지 준비"}</strong>
            <p>{runState === "LOADING" && cameraPermission !== "GRANTED"
              ? "브라우저의 카메라 권한 창에서 ‘허용’을 선택해 주세요. 허용 후 자동으로 시작합니다."
              : activeModule === "POSTURE"
                ? "휴대폰을 고정하고 얼굴부터 허리까지 보이게 맞춰 주세요."
                : "휴대폰을 실제 사용할 위치에 고정하고 현재 각도에서 얼굴이 보이게 해 주세요."}</p>
            <div className={`permission-state ${cameraPermission.toLowerCase()}`}>{permissionLabel}</div>
          </div>
        )}
        {calibrating && (
          <div className={`calibration-overlay ${snapshot.calibrationStable ? "stable" : "searching"}`}>
            {activeModule === "POSTURE" && <div className="calibration-position-guide" aria-hidden="true">
              <span className="calibration-face-target"><i /></span>
              <span className="calibration-center-line" />
              <span className="calibration-shoulder-target"><i /><i /></span>
            </div>}
            <div className="calibration-copy">
              <div className={`countdown ${snapshot.calibrationStable ? "stable" : "lost"}`}>
                {snapshot.calibrationStable ? countdown : "!"}
              </div>
              <div>
                <strong>{snapshot.calibrationStable ? activeModule === "POSTURE" ? "현재 위치를 유지해 주세요" : "얼굴이 보이면 자동으로 시작합니다" : activeModule === "POSTURE" ? "얼굴·양쪽 어깨·허리선을 화면에 맞춰 주세요" : "방향과 자세에 관계없이 얼굴만 보여 주세요"}</strong>
                <p>{snapshot.message}</p>
              </div>
              <div className="progress-track"><i style={{ width: `${snapshot.calibrationProgress * 100}%` }} /></div>
              <small>{activeModule === "POSTURE" ? "어깨선과 목에서 허리로 이어지는 상체 축을 함께 측정합니다" : "정면·사선·측면 어느 방향이든 얼굴이 보이면 시작합니다"}</small>
            </div>
          </div>
        )}
        {runState === "RUNNING" && !calibrating && (
          <div className={`status-badge ${snapshot.status.toLowerCase()}`}>
            <span className="status-dot" />{statusLabel}
          </div>
        )}
        {activeModule === "DROWSINESS" && runState === "RUNNING" && !calibrating && (
          <div className="drowsy-camera-signals" aria-label="졸음운전 감지 상태">
            <span className={snapshot.eyesClosed ? "active" : ""}><i />눈 감김</span>
            <span className={snapshot.headDown ? "active" : ""}><i />고개 숙임</span>
          </div>
        )}
      </section>

      <section className={`status-panel ${activeTab==="SETTINGS"?"mobile-screen-hidden":""}`} aria-live="polite">
        <div className="status-heading">
          <div>
            <span className="eyebrow">{activeModule === "POSTURE" ? "POSTURE COACH" : "DRIVER STATUS"}</span>
            <h1>{calibrating ? "기준 측정 중" : statusLabel}</h1>
          </div>
          {activeModule === "DROWSINESS" && <div className="drowsy-quick-metrics" aria-label="졸음운전 감지 횟수">
            <article><span>눈</span><strong>{snapshot.eyeAspectRatio === null ? "—" : snapshot.eyesClosed ? "감김" : "정상"}</strong><small>감지 {sessionEyeClosureCount}회</small></article>
            <article><span>고개</span><strong>{snapshot.headDown ? "숙임" : snapshot.faceVisible ? "정상" : "—"}</strong><small>감지 {sessionHeadDownCount}회</small></article>
          </div>}
        </div>
        <p className="main-message">{error || (wakeUpVideoPlaying ? (wakeUpVideoReason === "COMBINED" ? "눈 감김과 고개 숙임이 지속 감지되어 안전 경고 영상을 재생합니다." : wakeUpVideoReason === "HEAD" ? "고개 숙임이 지속 감지되어 안전 경고 영상을 재생합니다." : "눈 감김이 지속 감지되어 안전 경고 영상을 재생합니다.") : snapshot.message)}</p>

        {activeModule === "POSTURE" && <div className="detection-labels" aria-label="자세 교정 감지 항목">
          <>
            <span className={shoulderDeviated ? "active warning" : ""}><i />어깨 기울기</span>
            <span className={postureBaselineDeviated ? "active warning" : ""}><i />기준 자세 이탈</span>
            <span className={snapshot.eyesClosed ? "active danger" : ""}><i />눈 감김</span>
            <span className={snapshot.headDown ? "active danger" : ""}><i />고개 숙임</span>
          </>
        </div>}

        {activeModule === "POSTURE" && <div className="summary-metrics">
          <>
            <article className="posture-count-card"><span>눈 깜박임</span><strong>{postureBlinkCount}회</strong><small>이번 측정</small></article>
            <article className="posture-count-card"><span>고개 숙임</span><strong>{postureHeadDownCount}회</strong><small>{snapshot.headDown ? "숙임 확인 중" : "고개 안정"}</small></article>
            <article className="posture-count-card"><span>자리 이탈</span><strong>{postureSeatAwayCount}회</strong><small>{snapshot.trigger === "FACE_MISSING" ? "자리 확인 필요" : "자리 유지"}</small></article>
          </>
        </div>}
        {runState !== "RUNNING" && !calibrating && (
          <section className="monitor-start-guide" aria-label="기본 위치 설정 안내">
            <div className="monitor-start-guide-heading"><span>START GUIDE</span><strong>기본 위치를 먼저 맞춰요</strong></div>
            <p>휴대폰을 실제 사용할 위치에 고정한 뒤 시작을 누르면, 현재 화면을 기준으로 5초 측정 후 감지를 시작합니다.</p>
            <div className="monitor-start-steps"><span><b>1</b>얼굴이 화면 중앙</span><span><b>2</b>눈·고개가 보임</span><span><b>3</b>흔들림 없이 유지</span></div>
          </section>
        )}
        <nav className={`controls ${activeTab!=="MONITOR"?"mobile-screen-hidden":""}`} aria-label="감지 제어">
          {runState === "RUNNING" ? (
            <>
              <button className="primary stop portrait-stop" onClick={stop}><span className="stop-icon" />감지 종료</button>
              <LandscapeStopButton onStop={stop} />
            </>
          ) : (
            <button className="primary" onClick={() => void start()} disabled={runState === "LOADING" || cameraPermission === "UNAVAILABLE"}>
              <span className="play-icon" />{runState === "LOADING" ? "준비 중…" : "기본 위치 설정 후 시작"}
            </button>
          )}
        </nav>
        <DetectionTimeline
          samples={timelineSamples}
          mode={activeModule === "POSTURE" ? "POSTURE" : "DROWSINESS"}
        />
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
          {activeModule === "POSTURE" ? <article className="posture-card">
            <div className="posture-title">
              <div><span>3D 앉은 자세</span><strong>{postureLabel}</strong></div>
              <b>{snapshot.postureScore === null ? "—" : `${snapshot.postureScore}점`}</b>
            </div>
            <p>{snapshot.postureMessage}</p>
            <div className="posture-metrics">
              <label><span>촬영 각도</span><b>{formatView(snapshot.cameraView, snapshot.cameraViewAngleDegrees)}</b></label>
              <label><span>어깨 수평</span><b>{formatSignedDegrees(snapshot.shoulderTiltDegrees)}</b></label>
              <label><span>상체 축</span><b>{formatDegrees(snapshot.torsoLeanDegrees)}</b></label>
              <label><span>앞쪽 이동</span><b>{formatPercent(snapshot.forwardHeadPercent)}</b></label>
            </div>
            <small className="confidence">3D 추정 신뢰도 {Math.round(snapshot.postureConfidence * 100)}% · 5프레임 흔들림 보정</small>
          </article> : <article className="posture-card">
            <div className="posture-title"><div><span>졸음·쓰러짐 감지</span><strong>{snapshot.postureIssue === "BODY_COLLAPSE" ? "상체 쓰러짐" : "상체 안정"}</strong></div></div>
            <p>{snapshot.postureMessage}</p>
            <div className="posture-metrics">
              <label><span>머리 기울기</span><b>{formatDegrees(snapshot.headLeanDegrees)}</b></label>
              <label><span>아래쪽 이동</span><b>{formatPercent(snapshot.forwardHeadPercent)}</b></label>
            </div>
            <small className="confidence">어깨 수평은 졸음 판정에 사용하지 않습니다.</small>
          </article>}
        </div>}
      </section>

      {activeTab==="SETTINGS"&&<section className="mobile-settings" aria-label="앱 설정">
        <div className="settings-heading"><span className="eyebrow">APP SETTINGS</span><h1>설정</h1><p>운전 중에는 조작하지 말고 출발 전에 설정해 주세요.</p></div>
        <button className="setting-row" onClick={()=>setSoundEnabled(value=>!value)} aria-pressed={soundEnabled}><span><b>경보음과 음성 안내</b><small>주의·위험 상태를 한국어로 알립니다.</small></span><i className={soundEnabled?"on":""}>{soundEnabled?"켜짐":"꺼짐"}</i></button>
        <button className="setting-row" onClick={()=>void testVoice()}><span><b>안내 음성 테스트</b><small>기본 한국어 음성과 TTS 상태를 확인합니다.</small></span><i>재생</i></button>
        <button className="setting-row" onClick={()=>monitorRef.current.recalibrate()} disabled={runState!=="RUNNING"}><span><b>운전자 기준 재측정</b><small>{activeModule === "POSTURE" ? "얼굴과 자세 기준을 5초간 다시 측정합니다." : "눈과 고개 움직임 기준을 5초간 다시 측정합니다."}</small></span><i>재측정</i></button>
        <button className="setting-row remove-ads-row" onClick={() => { setPurchaseFeedback(""); setShowRemoveAdsDialog(true); }}><span><b>광고 제거</b><small>{adsRemoved ? "광고 제거가 적용되어 있습니다." : "배너와 메뉴 이동 전면 광고를 제거합니다."}</small></span><i className={adsRemoved ? "on" : ""}>{adsRemoved ? "적용됨" : "구매"}</i></button>
        <button className="setting-row" onClick={() => void openModule("WIDGET")}><span><b>번역 위젯 설정</b><small>위치, 글자 크기, 투명도와 Gloss 표시를 설정합니다.</small></span><i>열기</i></button>
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
      {showRemoveAdsDialog&&<RemoveAdsDialog
        adsRemoved={adsRemoved}
        busy={purchaseBusy}
        feedback={purchaseFeedback}
        onBuy={() => void buyRemoveAds()}
        onClose={() => setShowRemoveAdsDialog(false)}
        onRestore={() => void restoreRemoveAds()}
      />}
      </>}
    </main>
  );
}

function LandscapeStopButton({ onStop }: { onStop(): void }) {
  return <button
    className="primary stop landscape-stop"
    onClick={onStop}
    aria-label="종료하기"
  ><span className="stop-icon" /><span>종료하기</span></button>;
}

function DetectionTimeline({ samples, mode }: { samples: TimelineSample[]; mode: TimelineMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestRisk = samples.at(-1)?.risk ?? 0;
  const riskLabel = latestRisk === 3 ? "위험" : latestRisk === 2 ? "경고" : latestRisk === 1 ? "주의" : "정상";
  const riskClass = latestRisk === 3 ? "danger" : latestRisk === 2 ? "warning" : latestRisk === 1 ? "caution" : "normal";
  const eventLabels = mode === "POSTURE"
    ? ["눈 깜박임", "고개 숙임", "자리 이탈"]
    : ["눈 감김", "고개 숙임", "영상 경고"];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(bounds.width * ratio);
      const height = Math.max(120, bounds.height || 160);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = bounds.width;
      const top = 12;
      const eventLaneTop = height - 38;
      const graphBottom = eventLaneTop - 8;
      const eventRows = [eventLaneTop + 8, eventLaneTop + 19, eventLaneTop + 30];
      const stageHeight = (graphBottom - top) / 3;
      const yForRisk = (risk: TimelineSample["risk"]) => graphBottom - risk * stageHeight;
      context.clearRect(0, 0, width, height);

      context.fillStyle = "rgba(255,104,97,.04)";
      context.fillRect(0, top, width, stageHeight);
      context.fillStyle = "rgba(255,151,57,.03)";
      context.fillRect(0, top + stageHeight, width, stageHeight);
      context.fillStyle = "rgba(255,214,84,.025)";
      context.fillRect(0, top + stageHeight * 2, width, stageHeight);
      context.strokeStyle = "rgba(139,188,170,.13)";
      context.lineWidth = 1;
      context.setLineDash([3, 5]);
      [0, 1, 2, 3].map((stage) => top + stageHeight * stage).forEach((y) => {
        context.beginPath();
        context.moveTo(0, y + .5);
        context.lineTo(width, y + .5);
        context.stroke();
      });
      context.setLineDash([]);

      context.fillStyle = "rgba(126,200,173,.035)";
      context.fillRect(0, eventLaneTop, width, height - eventLaneTop);
      context.strokeStyle = "rgba(126,200,173,.18)";
      context.beginPath();
      context.moveTo(0, eventLaneTop + .5);
      context.lineTo(width, eventLaneTop + .5);
      context.stroke();
      context.strokeStyle = "rgba(126,200,173,.07)";
      for (const row of eventRows) {
        context.beginPath();
        context.moveTo(0, row + .5);
        context.lineTo(width, row + .5);
        context.stroke();
      }

      if (samples.length === 0) return;
      const lastSecond = samples.at(-1)?.elapsedSeconds ?? 0;
      const windowStart = Math.max(0, lastSecond - 300);
      const visibleSpan = Math.max(30, lastSecond - windowStart);
      const xForTime = (seconds: number) => ((seconds - windowStart) / visibleSpan) * width;
      const visibleSamples = samples.filter((sample) => sample.elapsedSeconds >= windowStart);

      context.strokeStyle = mode === "POSTURE" ? "#67c9ff" : "#45e5a4";
      context.lineWidth = 2.25;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      visibleSamples.forEach((sample, index) => {
        const x = xForTime(sample.elapsedSeconds);
        const y = yForRisk(sample.risk);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();

      visibleSamples.forEach((sample, index) => {
        const x = xForTime(sample.elapsedSeconds);
        const y = yForRisk(sample.risk);
        if (sample.risk > 0 || index === visibleSamples.length - 1) {
          context.beginPath();
          context.fillStyle = sample.risk === 3 ? "#ff6861" : sample.risk === 2 ? "#ff9739" : sample.risk === 1 ? "#ffd654" : mode === "POSTURE" ? "#67c9ff" : "#45e5a4";
          context.arc(x, y, sample.risk === 3 ? 4 : 3, 0, Math.PI * 2);
          context.fill();
        }
        const previous = visibleSamples[index - 1];
        const previousCounts = previous ? [previous.eyeCount, previous.headCount, previous.auxiliaryCount] : [0, 0, 0];
        const currentCounts = [sample.eyeCount, sample.headCount, sample.auxiliaryCount];
        currentCounts.forEach((count, eventIndex) => {
          if (count <= previousCounts[eventIndex]) return;
          context.strokeStyle = ["#75d9ff", "#ffbe61", "#ff7470"][eventIndex];
          context.lineWidth = 3;
          context.lineCap = "round";
          context.beginPath();
          context.moveTo(x, eventRows[eventIndex] - 3);
          context.lineTo(x, eventRows[eventIndex] + 3);
          context.stroke();
        });
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mode, samples]);

  return <section className="timeline-panel" aria-label="시간 흐름 분석">
    <header className="timeline-heading">
      <div><span>SESSION TIMELINE</span><strong>시간 흐름 분석</strong></div>
      <div className="timeline-status"><i className={riskClass} />현재 {riskLabel}</div>
    </header>
    <div className="timeline-chart">
      <div className="timeline-axis" aria-hidden="true"><span>위험</span><span>경고</span><span>주의</span><span>정상</span><small>감지<br />기록</small></div>
      <canvas ref={canvasRef} className="timeline-canvas" role="img" aria-label={`최근 5분 ${eventLabels.join(", ")} 상태 그래프`} />
    </div>
    <div className="timeline-footer">
      <div className="timeline-legend">
        {eventLabels.map((label, index) => <span key={label}><i className={`event-${index + 1}`} />{label}</span>)}
      </div>
      <small>최근 5분 · 1초 간격</small>
    </div>
    {samples.length < 2 && <p className="timeline-empty">감지를 시작하면 정상·주의·경고·위험 변화가 여기에 기록됩니다.</p>}
  </section>;
}

function RemoveAdsDialog({ adsRemoved, busy, feedback, onBuy, onClose, onRestore }: {
  adsRemoved: boolean;
  busy: boolean;
  feedback: string;
  onBuy(): void;
  onClose(): void;
  onRestore(): void;
}) {
  return <div className="purchase-modal-backdrop">
    <section className="purchase-modal" role="dialog" aria-modal="true" aria-labelledby="remove-ads-title">
      <span className="eyebrow">AD FREE</span>
      <h2 id="remove-ads-title">광고 제거</h2>
      <p>한 번 구매하면 이 기기와 같은 Google Play 계정에서 배너 광고와 메뉴 이동 전면 광고를 표시하지 않습니다.</p>
      <div className="purchase-summary">
        <b>구매 상품</b>
        <code>{REMOVE_ADS_PRODUCT_ID}</code>
      </div>
      <ol className="purchase-steps">
        <li>Google Play 결제창을 엽니다.</li>
        <li>결제가 완료되면 구매 토큰을 확인합니다.</li>
        <li>검증이 끝나면 광고 제거 상태를 저장하고 광고를 즉시 숨깁니다.</li>
      </ol>
      {adsRemoved&&<p className="purchase-feedback success">광고 제거가 이미 적용되어 있습니다.</p>}
      {feedback&&<p className="purchase-feedback">{feedback}</p>}
      <div className="purchase-actions">
        <button className="purchase-primary" onClick={onBuy} disabled={busy || adsRemoved}>{busy ? "처리 중…" : adsRemoved ? "구매 완료" : "광고 제거 구매"}</button>
        <button onClick={onRestore} disabled={busy}>구매 복원</button>
      </div>
      <button className="purchase-close" onClick={onClose}>닫기</button>
    </section>
  </div>;
}

function SignComingSoonDialog({ module, onClose }: { module: "SIGN" | "POSTURE" | "MEDITATION"; onClose(): void }) {
  const content = module === "POSTURE"
    ? { kicker: "POSTURE", description: "더 정확하고 편안한 자세 교정 기능을 준비하고 있습니다." }
    : module === "MEDITATION"
      ? { kicker: "MINDFUL BREATH", description: "편안하게 쉴 수 있는 호흡 안내 기능을 준비하고 있습니다." }
      : { kicker: "KSL CARE", description: "더 정확하고 편안한 수어 통역 기능을 준비하고 있습니다." };
  return <div className="coming-soon-backdrop" onClick={onClose}>
    <section className="coming-soon-dialog" role="dialog" aria-modal="true" aria-labelledby="feature-coming-soon-title" onClick={(event) => event.stopPropagation()}>
      <span className="coming-soon-mark" aria-hidden="true">⌁</span>
      <small>{content.kicker}</small>
      <h2 id="feature-coming-soon-title">현재 준비 중입니다</h2>
      <p>{content.description}</p>
      <button onClick={onClose}>확인</button>
    </section>
  </div>;
}

function DrowsySafetyNotice({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  return <div className="safety-modal-backdrop">
    <section className="safety-modal" role="dialog" aria-modal="true" aria-labelledby="drowsy-safety-title" aria-describedby="drowsy-safety-description">
      <div className="safety-modal-icon" aria-hidden="true">✓</div>
      <span className="safety-kicker">안전 운전 약속</span>
      <h2 id="drowsy-safety-title">안전하게 시작해요</h2>
      <p id="drowsy-safety-description">출발 전에 3가지만 확인해 주세요.</p>
      <ul>
        <li><strong>휴대폰은 출발 전에 설정해요</strong><span>운전 중에는 화면을 만지지 마세요.</span></li>
        <li><strong>졸리면 바로 쉬어가요</strong><span>안전한 곳에 정차하고 충분히 쉬세요.</span></li>
        <li><strong>도로와 내 판단이 먼저예요</strong><span>앱 알림은 안전운전을 돕는 참고 기능이에요.</span></li>
      </ul>
      <button className="safety-confirm" onClick={onConfirm}>확인하고 시작</button>
      <button className="safety-cancel" onClick={onCancel}>다음에 할게요</button>
    </section>
  </div>;
}

function FirstRunNotice({ onConfirm }: { onConfirm(): void }) {
  return <div className="first-run-notice-backdrop">
    <section className="first-run-notice" role="dialog" aria-modal="true" aria-labelledby="first-run-notice-title" aria-describedby="first-run-notice-description">
      <span className="first-run-notice-badge">꼭 필독</span>
      <h2 id="first-run-notice-title">안심하고 이용해 주세요</h2>
      <div id="first-run-notice-description" className="first-run-notice-copy">
        <p>저희 앱은 카메라로 촬영된 영상을 <b>저장하거나 서버로 전송하지 않습니다.</b></p>
        <p>영상은 운전자 상태를 확인하기 위해 화면에만 표시되며, 별도의 파일로 저장되지 않습니다.</p>
      </div>
      <div className="first-run-notice-assurance"><i>✓</i><span><b>기기 내에서만 분석</b><small>카메라 영상 비저장 · 서버 미전송</small></span></div>
      <p className="first-run-notice-closing">더 나은 서비스를 제공하기 위해 계속 노력하겠습니다.</p>
      <button onClick={onConfirm}>확인하고 시작하기</button>
    </section>
  </div>;
}

function HomeScreen({
  onOpen,
  widgetSettings,
  wakeUpLibrary,
  selectedWakeUpVideoId,
  pendingWakeUpApplyId,
  downloadBusy,
  onSelectWakeUpVideo,
  onDownloadWakeUpVideo,
  studyWarningLibrary,
  selectedStudyWarningVideoId,
  studyWarningDownloadBusy,
  onSelectStudyWarningVideo,
  onDownloadOrApplyStudyWarningVideo,
  studyEndingLibrary,
  selectedStudyEndingVideoId,
  studyEndingDownloadBusy,
  onSelectStudyEndingVideo,
  onDownloadOrApplyStudyEndingVideo,
}: {
  onOpen(module: AppModule): void;
  widgetSettings: WidgetSettings;
  wakeUpLibrary: WakeUpLibraryState;
  selectedWakeUpVideoId: WakeUpVideoId;
  pendingWakeUpApplyId: WakeUpVideoId | null;
  downloadBusy: boolean;
  onSelectWakeUpVideo(id: WakeUpVideoId): void;
  onDownloadWakeUpVideo(): void;
  studyWarningLibrary: StudyVideoLibraryState<StudyWarningVideoId>;
  selectedStudyWarningVideoId: StudyWarningVideoId;
  studyWarningDownloadBusy: boolean;
  onSelectStudyWarningVideo(id: StudyWarningVideoId): void;
  onDownloadOrApplyStudyWarningVideo(): void;
  studyEndingLibrary: StudyVideoLibraryState<StudyEndingVideoId>;
  selectedStudyEndingVideoId: StudyEndingVideoId;
  studyEndingDownloadBusy: boolean;
  onSelectStudyEndingVideo(id: StudyEndingVideoId): void;
  onDownloadOrApplyStudyEndingVideo(): void;
}) {
  const wakeProfileScrollRef = useRef<HTMLDivElement>(null);
  const wakeProfileDragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number; moved: boolean } | null>(null);
  const suppressWakeProfileClickRef = useRef(false);
  const [homeMediaMode, setHomeMediaMode] = useState<"DROWSINESS" | "STUDY">("DROWSINESS");
  const [comingSoonOpen, setComingSoonOpen] = useState(false);
  const selectedStudyReward = loadStudyRewardState(localStorage.getItem(STUDY_REWARDS_STORAGE_KEY)).selected;
  const orderedProfiles = orderWakeUpVideoProfiles(wakeUpLibrary.downloadedIds);
  const appliedProfile = getWakeUpVideoProfile(wakeUpLibrary.appliedId);
  const appliedStudyWarningProfile = getStudyWarningVideoProfile(studyWarningLibrary.appliedId);
  const appliedStudyEndingProfile = getStudyEndingVideoProfile(studyEndingLibrary.appliedId);
  const selectedDownloaded = wakeUpLibrary.downloadedIds.includes(selectedWakeUpVideoId);
  const selectedApplied = wakeUpLibrary.appliedId === selectedWakeUpVideoId;
  const selectedStudyWarningDownloaded = studyWarningLibrary.downloadedIds.includes(selectedStudyWarningVideoId);
  const selectedStudyWarningApplied = studyWarningLibrary.appliedId === selectedStudyWarningVideoId;
  const selectedStudyEndingDownloaded = studyEndingLibrary.downloadedIds.includes(selectedStudyEndingVideoId);
  const selectedStudyEndingApplied = studyEndingLibrary.appliedId === selectedStudyEndingVideoId;

  const beginWakeProfileDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    wakeProfileDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  };

  const moveWakeProfileDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = wakeProfileDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 12) {
      drag.moved = true;
      event.currentTarget.classList.add("is-dragging");
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (drag.moved) event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
  };

  const endWakeProfileDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = wakeProfileDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressWakeProfileClickRef.current = drag.moved;
    wakeProfileDragRef.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const scrollWakeProfilesWithWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const next = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + delta));
    if (next === element.scrollLeft) return;
    event.preventDefault();
    element.scrollLeft = next;
  };

  return <section className="mobile-home" aria-label="졸음운전 홈">
    <section className="wake-library" aria-label="졸음 깨우기 영상 보관함">
      <nav className="home-media-mode-switcher" aria-label="홈 영상 모드 선택">
        <button
          type="button"
          className={`home-mode-card drive ${homeMediaMode === "DROWSINESS" ? "active" : ""}`}
          aria-pressed={homeMediaMode === "DROWSINESS"}
          onClick={() => setHomeMediaMode("DROWSINESS")}
        >
          <span className="home-mode-copy">
            <small>DRIVE SAFE</small>
            <strong>졸음운전 방지</strong>
            <em>{appliedProfile.name}</em>
          </span>
          <span className="home-mode-profile-preview" aria-hidden="true">
            <video key={`mode-drive-${appliedProfile.id}`} src={`${appliedProfile.path}#t=0.12`} muted playsInline preload="metadata" />
          </span>
        </button>
        <button
          type="button"
          className={`home-mode-card study ${homeMediaMode === "STUDY" ? "active" : ""}`}
          aria-pressed={homeMediaMode === "STUDY"}
          onClick={() => setHomeMediaMode("STUDY")}
        >
          <span className="home-mode-copy">
            <small>STUDY FOCUS</small>
            <strong>열공 모드</strong>
            <em>{appliedStudyWarningProfile.name} · {appliedStudyEndingProfile.name}</em>
          </span>
          <span className="home-mode-profile-preview dual" aria-hidden="true">
            <video key={`mode-study-warning-${appliedStudyWarningProfile.id}`} src={`${appliedStudyWarningProfile.path}#t=0.12`} muted playsInline preload="metadata" />
            <video key={`mode-study-ending-${appliedStudyEndingProfile.id}`} src={`${appliedStudyEndingProfile.path}#t=0.12`} muted playsInline preload="metadata" />
          </span>
        </button>
      </nav>
      <button
        type="button"
        className={`home-mode-start-action ${homeMediaMode === "DROWSINESS" ? "drive" : "study"}`}
        onClick={() => onOpen(homeMediaMode)}
      >
        <span className={`home-mode-start-icon ${homeMediaMode === "STUDY" ? "reward" : ""}`} aria-hidden="true">
          {homeMediaMode === "STUDY" ? <img src={studyRewardPath(selectedStudyReward)} alt="" /> : "▶"}
        </span>
        <span>
          <strong>{homeMediaMode === "DROWSINESS" ? "졸음운전 방지 시작" : "열공 모드 시작"}</strong>
          <small>{homeMediaMode === "DROWSINESS"
            ? `적용 중 · ${appliedProfile.name}`
            : `경고 ${appliedStudyWarningProfile.name} · 종료 ${appliedStudyEndingProfile.name}`}</small>
        </span>
        <em aria-hidden="true">→</em>
      </button>
      {homeMediaMode === "STUDY" && <section className="study-media-library" aria-label="열공 모드 영상">
        <section className="study-video-profile-group" aria-label="열공 경고 영상">
          <header className="wake-library-heading">
            <div><span>WARNING VIDEO</span><h1>경고 영상</h1><p>열공 중 경고 상황이 감지되면 재생됩니다.</p></div>
            <em>{studyWarningLibrary.downloadedIds.length}/{STUDY_WARNING_VIDEO_PROFILES.length} 보유</em>
          </header>
          <div className="wake-profile-scroll study-video-profile-scroll" role="list">
            {STUDY_WARNING_VIDEO_PROFILES.map((profile) => {
              const downloaded = studyWarningLibrary.downloadedIds.includes(profile.id);
              const selected = selectedStudyWarningVideoId === profile.id;
              const applied = studyWarningLibrary.appliedId === profile.id;
              return <button
                key={profile.id}
                type="button"
                role="listitem"
                className={`wake-profile-card study-video-profile-card ${selected ? "selected" : ""} ${downloaded ? "downloaded" : "locked"} ${applied ? "applied" : ""}`}
                aria-pressed={selected}
                onClick={() => onSelectStudyWarningVideo(profile.id)}
              >
                <span className="wake-profile-thumb">
                  <video src={`${profile.path}#t=0.12`} muted playsInline preload="metadata" aria-hidden="true" />
                  {applied && <i className="wake-profile-applied-mark">✓</i>}
                  {!downloaded && <i className="wake-profile-lock" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10M6 10h12v10H6z" /></svg>
                  </i>}
                </span>
                <strong>{profile.name}</strong>
                <small>{applied ? "적용됨" : downloaded ? "다운로드됨" : selected ? "선택됨 · 광고로 받기" : "광고로 받기"}</small>
              </button>;
            })}
          </div>
          <div className="wake-library-action">
            <button
              type="button"
              disabled={studyWarningDownloadBusy || selectedStudyWarningApplied}
              className={selectedStudyWarningApplied ? "applied" : ""}
              onClick={onDownloadOrApplyStudyWarningVideo}
            >
              {studyWarningDownloadBusy ? "광고 불러오는 중…" : selectedStudyWarningApplied ? "적용됨" : selectedStudyWarningDownloaded ? "적용하기" : "광고 시청 후 다운로드"}
            </button>
          </div>
        </section>

        <section className="study-video-profile-group" aria-label="공부 종료 영상">
          <header className="wake-library-heading">
            <div><span>FINISH VIDEO</span><h1>공부 종료 영상</h1><p>공부를 종료했을 때 재생됩니다.</p></div>
            <em>{studyEndingLibrary.downloadedIds.length}/{STUDY_ENDING_VIDEO_PROFILES.length} 보유</em>
          </header>
          <div className="wake-profile-scroll study-finish-profile-scroll" role="list">
            {STUDY_ENDING_VIDEO_PROFILES.map((profile) => {
              const downloaded = studyEndingLibrary.downloadedIds.includes(profile.id);
              const selected = selectedStudyEndingVideoId === profile.id;
              const applied = studyEndingLibrary.appliedId === profile.id;
              return <button
                key={profile.id}
                type="button"
                role="listitem"
                className={`wake-profile-card study-video-profile-card ${selected ? "selected" : ""} ${downloaded ? "downloaded" : "locked"} ${applied ? "applied" : ""}`}
                aria-pressed={selected}
                onClick={() => onSelectStudyEndingVideo(profile.id)}
              >
                <span className="wake-profile-thumb">
                  <video src={`${profile.path}#t=0.12`} muted playsInline preload="metadata" aria-hidden="true" />
                  {applied && <i className="wake-profile-applied-mark">✓</i>}
                  {!downloaded && <i className="wake-profile-lock" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10M6 10h12v10H6z" /></svg>
                  </i>}
                </span>
                <strong>{profile.name}</strong>
                <small>{applied ? "적용됨" : downloaded ? "다운로드됨" : selected ? "선택됨 · 광고로 받기" : "광고로 받기"}</small>
              </button>;
            })}
          </div>
          <div className="wake-library-action">
            <button
              type="button"
              disabled={studyEndingDownloadBusy || selectedStudyEndingApplied}
              className={selectedStudyEndingApplied ? "applied" : ""}
              onClick={onDownloadOrApplyStudyEndingVideo}
            >
              {studyEndingDownloadBusy ? "광고 불러오는 중…" : selectedStudyEndingApplied ? "적용됨" : selectedStudyEndingDownloaded ? "적용하기" : "광고 시청 후 다운로드"}
            </button>
          </div>
        </section>
      </section>}
      <header hidden={homeMediaMode !== "DROWSINESS"} className="wake-library-heading">
        <div><span>WAKE-UP VIDEO</span><h1>졸음운전 영상</h1><p>졸음운전 모드 중 졸음 현상이 있으면 재생됩니다.</p></div>
        <em>{wakeUpLibrary.downloadedIds.length}/{orderedProfiles.length} 보유</em>
      </header>
      <div
        hidden={homeMediaMode !== "DROWSINESS"}
        ref={wakeProfileScrollRef}
        className="wake-profile-scroll"
        role="list"
        aria-label="깨우기 영상 목록"
        onPointerDown={beginWakeProfileDrag}
        onPointerMove={moveWakeProfileDrag}
        onPointerUp={endWakeProfileDrag}
        onPointerCancel={endWakeProfileDrag}
        onWheel={scrollWakeProfilesWithWheel}
        onClickCapture={(event) => {
          if (!suppressWakeProfileClickRef.current) return;
          suppressWakeProfileClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {orderedProfiles.map((profile) => {
          const downloaded = wakeUpLibrary.downloadedIds.includes(profile.id);
          const applied = wakeUpLibrary.appliedId === profile.id;
          const selected = selectedWakeUpVideoId === profile.id;
          const awaitingApply = selected && pendingWakeUpApplyId === profile.id;
          return <button
            key={profile.id}
            type="button"
            role="listitem"
            className={`wake-profile-card ${selected ? "selected" : ""} ${downloaded ? "downloaded" : "locked"} ${applied ? "applied" : ""}`}
            aria-pressed={selected}
            onClick={() => onSelectWakeUpVideo(profile.id)}
          >
            <span className="wake-profile-thumb">
              <video src={`${profile.path}#t=0.12`} muted playsInline preload="metadata" aria-hidden="true" />
              {applied && <i className="wake-profile-applied-mark">✓</i>}
              {!downloaded && <i className="wake-profile-lock" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10M6 10h12v10H6z" /></svg>
              </i>}
            </span>
            <strong>{profile.name}</strong>
            <small>{applied ? "적용됨" : awaitingApply ? "한 번 더 터치" : downloaded ? "다운로드됨" : selected ? "선택됨 · 광고로 받기" : "광고로 받기"}</small>
          </button>;
        })}
        <article className="wake-profile-card coming-soon" role="listitem" aria-label="새 졸음운전 영상 추후 업데이트 예정">
          <span className="wake-profile-thumb wake-coming-thumb" aria-hidden="true">
            <i>···</i>
          </span>
          <strong>COMING SOON</strong>
          <small>새 영상 업데이트 예정</small>
        </article>
      </div>
      <div hidden={homeMediaMode !== "DROWSINESS"} className="wake-library-action">
        <button
          type="button"
          onClick={onDownloadWakeUpVideo}
          disabled={downloadBusy || selectedApplied}
          className={selectedApplied ? "applied" : ""}
        >
          {downloadBusy ? "광고 불러오는 중…" : selectedApplied ? "적용됨" : selectedDownloaded ? "적용하기" : "광고 시청 후 다운로드"}
        </button>
      </div>
    </section>
    <div className="home-bento home-puzzle removed-home-mode-cards">
      <button className="suha-card drive" onClick={() => onOpen("DROWSINESS")}>
        <video key={`drive-${appliedProfile.id}`} className="home-card-art" src={`${appliedProfile.path}#t=0.12`} poster="/media/sleepy-driver.png" muted playsInline preload="metadata" aria-hidden="true" />
        <span className="home-card-tint" aria-hidden="true" />
        <span className="card-icon"><i /></span><div><small>DRIVE SAFE</small><b>졸음운전 방지</b><p>눈과 고개 움직임을 살펴<br />안전한 운전을 도와요.</p></div><em>시작하기 <span>→</span></em>
      </button>
      <button className="suha-card study" onClick={() => onOpen("STUDY")}>
        <span className="study-card-symbol reward"><img src={studyRewardPath(selectedStudyReward)} alt="" /></span><div><small>STUDY FOCUS</small><b>열공 모드</b><p>눈·고개·자세를 살펴<br />집중과 휴식을 도와요.</p></div><em>열공 시작 <span>→</span></em>
      </button>
    </div>
    <button className="home-utility" onClick={() => onOpen("WIDGET")}><span><i>▣</i><b>통역 위젯</b><small>{widgetSettings.enabled ? `표시 중 · ${widgetPositionLabel(widgetSettings.position)}` : "현재 숨김"}</small></span></button>
    <section className={`home-coming-soon ${comingSoonOpen ? "open" : ""}`}>
      <button
        type="button"
        className="home-coming-soon-toggle"
        aria-expanded={comingSoonOpen}
        aria-controls="home-coming-soon-items"
        onClick={() => setComingSoonOpen((open) => !open)}
      >
        <span><small>COMING SOON</small><b>업데이트 예정</b></span>
        <em>{comingSoonOpen ? "접기" : "펼쳐보기"} <i aria-hidden="true">⌄</i></em>
      </button>
      {comingSoonOpen && <div id="home-coming-soon-items" className="home-coming-soon-items">
        <div className="home-bento">
          <button className="suha-card posture" onClick={() => onOpen("POSTURE")}>
            <small>POSTURE</small><b>자세 교정</b><p>바른 자세를<br />함께 찾아요.</p>
          </button>
          <button className="suha-card sign" onClick={() => onOpen("SIGN")}>
            <small>KSL CARE</small><b>수어 통역</b><p>수어와 음성을<br />서로 이어줘요.</p>
          </button>
        </div>
        <div className="home-meditation-row">
          <button className="suha-card meditation" onClick={() => onOpen("MEDITATION")}><span className="breath-mark">◌</span><div><small>MINDFUL BREATH</small><b>잠시, 호흡할까요?</b><p>5분 호흡 명상으로 마음을 가볍게.</p></div></button>
        </div>
      </div>}
    </section>
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
  return { IDLE: "준비", CALIBRATING: "측정 중", NORMAL: "정상", CAUTION: "주의", WARNING: "경고", DANGER: "위험", NO_FACE: "얼굴 확인" }[status];
}

function updateAlertLatch(
  activeRef: { current: boolean },
  clearedAtRef: { current: number | null },
  active: boolean,
  now: number,
): void {
  const next = advanceAlertLatch({ active: activeRef.current, clearedAtMs: clearedAtRef.current }, active, now);
  activeRef.current = next.active;
  clearedAtRef.current = next.clearedAtMs;
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
    TORSO_MISSING: "허리선 확인",
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

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyMinimumCameraZoom, cameraErrorMessage, requestUserCamera, waitForUsableVideoFrame } from "./cameraAccess";
import { removeBottomBannerAd, showBottomBannerAd } from "./ads";
import { DriverMonitor, type MonitorSnapshot } from "./monitor";
import { speakKorean, stopKoreanSpeech } from "./speech";
import {
  DEFAULT_STUDY_SETTINGS,
  STUDY_RECORDS_STORAGE_KEY,
  STUDY_SETTINGS_STORAGE_KEY,
  StudySessionTracker,
  appendStudyRecord,
  loadStudyRecords,
  loadStudySettings,
  normalizeStudySettings,
  studyStatusLabel,
  type StudyLiveSnapshot,
  type StudySessionRecord,
  type StudySettings,
  type StudyStatus,
} from "./studyMode";
import { MobileVisionEngine, VisionFrameUnavailableError, drawLandmarks, isRecoverableVisionError, isUsableVideoFrame, stabilizeOverlayFrame, visionErrorMessage } from "./vision";
import {
  STUDY_REWARD_IMAGES,
  STUDY_REWARDS_STORAGE_KEY,
  loadStudyRewardState,
  recordStudyCompletion,
  resetStudyProgress,
  studyRewardPath,
  unlockAllStudyRewardsForTest,
  type StudyRewardImage,
  type StudyRewardState,
} from "./studyRewards";

type StudyView = "START" | "SETTINGS" | "CAMERA" | "RUN" | "PAUSED" | "BREAK" | "EXERCISE" | "RETURN" | "END_CONFIRM" | "RESULT" | "HISTORY" | "RECORD_DETAIL";
type HistoryFilter = "7D" | "30D" | "ALL";
type CameraChecks = {
  faceVisible: boolean;
};

const STUDY_CALIBRATION_DURATION_MS = 5_000;
const initialCameraChecks: CameraChecks = {
  faceVisible: false,
};

const initialMonitorSnapshot: MonitorSnapshot = {
  status: "IDLE",
  trigger: "NONE",
  message: "카메라 확인을 시작해 주세요.",
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
  calibrationRemainingMs: STUDY_CALIBRATION_DURATION_MS,
  calibrationStable: false,
};

export function StudyModeScreen({ onExit, alertVideoPath, endingVideoPath, adsRemoved = false }: { onExit(): void; alertVideoPath: string; endingVideoPath: string; adsRemoved?: boolean }) {
  const [settings, setSettings] = useState<StudySettings>(() => loadStudySettings(localStorage.getItem(STUDY_SETTINGS_STORAGE_KEY)));
  const [records, setRecords] = useState<StudySessionRecord[]>(() => loadStudyRecords(localStorage.getItem(STUDY_RECORDS_STORAGE_KEY)));
  const [rewardState, setRewardState] = useState<StudyRewardState>(() => loadStudyRewardState(localStorage.getItem(STUDY_REWARDS_STORAGE_KEY)));
  const [view, setView] = useState<StudyView>("START");
  const viewRef = useRef<StudyView>("START");
  const [launchMenuOpen, setLaunchMenuOpen] = useState(true);
  const [live, setLive] = useState<StudyLiveSnapshot | null>(null);
  const [monitorSnapshot, setMonitorSnapshot] = useState(initialMonitorSnapshot);
  const [cameraError, setCameraError] = useState("");
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraChecks, setCameraChecks] = useState<CameraChecks>(initialCameraChecks);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [focusImmersiveOpen, setFocusImmersiveOpen] = useState(false);
  const focusImmersiveOpenRef = useRef(false);
  const [alertVideoVisible, setAlertVideoVisible] = useState(false);
  const alertVideoVisibleRef = useRef(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [endingVideoVisible, setEndingVideoVisible] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<StudySessionRecord | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("7D");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<MobileVisionEngine | null>(null);
  const monitorRef = useRef(new DriverMonitor());
  const trackerRef = useRef<StudySessionTracker | null>(null);
  const animationRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const lastInferenceRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastRenderedAtRef = useRef(0);
  const overlayFrameRef = useRef<ReturnType<typeof stabilizeOverlayFrame> | null>(null);
  const lastAlertHandledRef = useRef("");
  const activeAlertVideoPath = alertVideoPath;
  const contentEntryRef = useRef("");
  const returnReminderHandledRef = useRef(0);
  const breakCompletedHandledRef = useRef("");
  const breakStartedHandledRef = useRef(0);
  const diagnosticsEnabledRef = useRef(new URLSearchParams(window.location.search).get("studyDebug") === "1");

  useEffect(() => {
    if (!live || view !== "BREAK" || !settings.voiceEnabled || !settings.voiceBreakStartEnabled) return;
    const startedAt = live.events.filter((event) => event.code === "STUDY_BREAK_STARTED").at(-1)?.at ?? 0;
    if (startedAt === 0 || breakStartedHandledRef.current === startedAt) return;
    breakStartedHandledRef.current = startedAt;
    trackerRef.current?.recordTts(Date.now(), "BREAK_STARTED");
    void speakKorean("휴식 시간입니다. 잠시 눈과 몸을 쉬어주세요.").catch(() => undefined);
  }, [live?.events, settings.voiceEnabled, settings.voiceBreakStartEnabled, view]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (view === "BREAK" && !adsRemoved) void showBottomBannerAd();
    else void removeBottomBannerAd();
    return () => {
      void removeBottomBannerAd();
    };
  }, [adsRemoved, view]);

  const stopCamera = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    engineRef.current?.close();
    engineRef.current = null;
    monitorRef.current.stop();
    overlayFrameRef.current = null;
    setCameraActive(false);
    void stopKoreanSpeech();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [stopCamera]);

  const saveSettings = useCallback((patch: Partial<StudySettings>) => {
    setSettings((current) => {
      const next = normalizeStudySettings({ ...current, ...patch });
      localStorage.setItem(STUDY_SETTINGS_STORAGE_KEY, JSON.stringify(next));
      trackerRef.current?.updateSettings(next);
      return next;
    });
  }, []);

  const updateRewardState = useCallback((updater: (current: StudyRewardState) => StudyRewardState) => {
    setRewardState((current) => {
      const next = updater(current);
      localStorage.setItem(STUDY_REWARDS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetStudyCalendar = useCallback(() => {
    if (!window.confirm("연속 열공 일수와 공부 달력 기록을 모두 초기화할까요?\n열공 설정과 보유 이미지는 유지됩니다.")) return;
    localStorage.setItem(STUDY_RECORDS_STORAGE_KEY, JSON.stringify([]));
    setRecords([]);
    setSelectedRecord(null);
    updateRewardState(resetStudyProgress);
  }, [updateRewardState]);

  const syncLive = useCallback((snapshot: StudyLiveSnapshot) => {
    if (!mountedRef.current) return;
    setLive(snapshot);
    if (snapshot.status === "BREAK" && viewRef.current !== "BREAK") {
      stopCamera();
      setQuickSettingsOpen(false);
      setView("BREAK");
    } else if (snapshot.status === "RETURN_WAITING" && viewRef.current !== "RETURN") {
      stopCamera();
      setQuickSettingsOpen(false);
      setView("RETURN");
    }
  }, [stopCamera]);

  const startCamera = useCallback(async (newSession: boolean) => {
    if (cameraBusy) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("설치된 앱 또는 HTTPS 환경에서 카메라를 사용할 수 있습니다.");
      setView("CAMERA");
      return;
    }
    stopCamera();
    setCameraError("");
    setCameraBusy(true);
    setCameraChecks(initialCameraChecks);
    setMonitorSnapshot(initialMonitorSnapshot);
    setView("CAMERA");
    if (newSession) {
      trackerRef.current = null;
      setLive(null);
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const stream = await requestUserCamera({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, min: 20 },
        },
      });
      await applyMinimumCameraZoom(stream);
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("열공 카메라 화면을 준비하지 못했습니다.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await waitForUsableVideoFrame(videoRef.current);
      let engine = new MobileVisionEngine();
      await engine.initialize();
      engineRef.current = engine;
      monitorRef.current.begin("STUDY", STUDY_CALIBRATION_DURATION_MS);
      setCameraActive(true);
      setCameraBusy(false);
      let runningStarted = false;
      let recoveryInProgress = false;
      let cpuRecoveryUsed = false;
      const detect = () => {
        if (!mountedRef.current || !streamRef.current) return;
        if (recoveryInProgress) {
          animationRef.current = requestAnimationFrame(detect);
          return;
        }
        if (engineRef.current !== engine) return;
        if (alertVideoVisibleRef.current) {
          animationRef.current = requestAnimationFrame(detect);
          return;
        }
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const now = performance.now();
        if (video && canvas && isUsableVideoFrame(video) && video.currentTime !== lastVideoTimeRef.current && now - lastInferenceRef.current >= 80) {
          lastInferenceRef.current = now;
          lastVideoTimeRef.current = video.currentTime;
          try {
            const frame = engine.detect(video, now);
            const faceVisible = frame.face !== null;
            const checks = { faceVisible };
            const nextMonitor = monitorRef.current.process(frame);
            const overlayFrame = stabilizeOverlayFrame(frame, overlayFrameRef.current);
            overlayFrameRef.current = overlayFrame;
            drawLandmarks(
              canvas,
              video,
              overlayFrame,
              nextMonitor.status === "WARNING" || nextMonitor.status === "DANGER",
              true,
              nextMonitor.baselineGuide,
              nextMonitor.baselineDeviated,
            );
            if (now - lastRenderedAtRef.current >= 160 || nextMonitor.status === "CALIBRATING") {
              lastRenderedAtRef.current = now;
              setCameraChecks(checks);
              setMonitorSnapshot(nextMonitor);
            }
            if (nextMonitor.status !== "CALIBRATING") {
              if (!runningStarted) {
                runningStarted = true;
                const tracker = trackerRef.current ?? new StudySessionTracker(settings, Date.now());
                trackerRef.current = tracker;
                const snapshot = tracker.getSnapshot().status === "FOCUS"
                  ? tracker.getSnapshot()
                  : tracker.resume(Date.now());
                syncLive(snapshot);
                setView("RUN");
              }
              if (runningStarted) {
                const tracker = trackerRef.current;
                if (tracker) {
                  syncLive(tracker.process(frame, nextMonitor, Date.now(), {
                    skipAbsence: focusImmersiveOpenRef.current,
                  }));
                }
              }
            }
          } catch (cause) {
            if (cause instanceof VisionFrameUnavailableError) {
              // 카메라가 회전·리사이즈되는 짧은 구간은 다음 프레임에서 자동 재개한다.
            } else if (isRecoverableVisionError(cause) && engine.activeDelegate === "GPU" && !cpuRecoveryUsed) {
              const activeStream = streamRef.current;
              recoveryInProgress = true;
              cpuRecoveryUsed = true;
              engineRef.current = null;
              engine.close();
              setCameraBusy(true);
              const replacement = new MobileVisionEngine();
              void replacement.initialize("CPU").then(() => {
                if (!mountedRef.current || streamRef.current !== activeStream) {
                  replacement.close();
                  return;
                }
                engine = replacement;
                engineRef.current = replacement;
                lastInferenceRef.current = 0;
                lastVideoTimeRef.current = -1;
                setCameraError("");
                setCameraBusy(false);
              }).catch((recoveryCause) => {
                replacement.close();
                if (streamRef.current !== activeStream) return;
                setCameraError(visionErrorMessage(recoveryCause));
                stopCamera();
                setCameraBusy(false);
              }).finally(() => {
                recoveryInProgress = false;
              });
            } else {
              setCameraError(visionErrorMessage(cause));
              stopCamera();
            }
          }
        }
        animationRef.current = requestAnimationFrame(detect);
      };
      animationRef.current = requestAnimationFrame(detect);
    } catch (cause) {
      stopCamera();
      setCameraError(cameraErrorMessage(cause));
      setCameraBusy(false);
    }
  }, [cameraBusy, settings, stopCamera, syncLive]);

  const requestStudyStart = useCallback(() => {
    void startCamera(true);
  }, [startCamera]);

  const openFocusImmersive = useCallback(() => {
    focusImmersiveOpenRef.current = true;
    setFocusImmersiveOpen(true);
    const tracker = trackerRef.current;
    if (tracker) syncLive(tracker.resetAbsenceDetection());
  }, [syncLive]);

  const closeFocusImmersive = useCallback(() => {
    focusImmersiveOpenRef.current = false;
    setFocusImmersiveOpen(false);
    const tracker = trackerRef.current;
    if (tracker) syncLive(tracker.resetAbsenceDetection());
  }, [syncLive]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const tracker = trackerRef.current;
      if (!tracker) return;
      syncLive(tracker.tick(Date.now()));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [syncLive]);

  useEffect(() => {
    if (!live?.pendingAlert) return;
    const alert = live.pendingAlert;
    const key = `${alert.eventAt}-${alert.level}`;
    if (lastAlertHandledRef.current === key) return;
    lastAlertHandledRef.current = key;
    const tracker = trackerRef.current;
    if (!tracker) return;
    if (!settings.videoEnabled) {
      syncLive(tracker.acknowledgeAlert());
      return;
    }
    tracker.recordVideo(Date.now(), "STUDY_DROWSY_WARNING");
    alertVideoVisibleRef.current = true;
    setAlertVideoVisible(true);
  }, [live?.pendingAlert, settings.videoEnabled, syncLive]);

  useEffect(() => {
    if (!live) return;
    const key = `${view}-${live.id}`;
    if ((view === "BREAK" || view === "EXERCISE") && contentEntryRef.current !== key) {
      contentEntryRef.current = key;
      const mode = view === "BREAK" ? settings.breakVideo : settings.exerciseVideo;
      if (settings.videoEnabled && mode !== "NONE") trackerRef.current?.recordVideo(Date.now(), view);
    }
  }, [live, settings.breakVideo, settings.exerciseVideo, settings.videoEnabled, view]);

  useEffect(() => {
    if (!live?.returnReminderDue) return;
    const reminderAt = live.events.filter((event) => event.code === "STUDY_RETURN_REMINDER").at(-1)?.at ?? 0;
    if (reminderAt === 0 || returnReminderHandledRef.current === reminderAt) return;
    returnReminderHandledRef.current = reminderAt;
    if (settings.vibrationEnabled && navigator.vibrate) navigator.vibrate([180, 120, 180]);
    if (settings.voiceEnabled && settings.voiceReturnEnabled) {
      trackerRef.current?.recordTts(Date.now(), "RETURN_REMINDER");
      void speakKorean("자리 이탈이 감지됐어요. 돌아오면 열공을 다시 시작할 수 있어요.").catch(() => undefined);
    }
  }, [live?.events, live?.returnReminderDue, settings.vibrationEnabled, settings.voiceEnabled, settings.voiceReturnEnabled]);

  useEffect(() => {
    if (!live?.breakCompleted || view !== "BREAK") return;
    const key = `${live.id}-${live.breakRemainingMs}`;
    if (breakCompletedHandledRef.current === key) return;
    breakCompletedHandledRef.current = key;
    if (settings.voiceEnabled && settings.voiceBreakEnabled) {
      trackerRef.current?.recordTts(Date.now(), "BREAK_COMPLETED");
      void speakKorean("휴식 시간이 끝났습니다. 준비되면 열공을 다시 시작해 주세요.").catch(() => undefined);
    }
  }, [live?.breakCompleted, live?.breakRemainingMs, live?.id, settings.voiceEnabled, settings.voiceBreakEnabled, view]);

  const startBreak = useCallback((minutes = settings.breakMinutes) => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    syncLive(tracker.startBreak(Date.now(), minutes));
  }, [settings.breakMinutes, syncLive]);

  const startExercise = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    stopCamera();
    syncLive(tracker.startExercise(Date.now()));
    setView("EXERCISE");
  }, [stopCamera, syncLive]);

  const requestEnd = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker) {
      onExit();
      return;
    }
    syncLive(tracker.pause(Date.now()));
    setQuickSettingsOpen(false);
    setEndConfirmOpen(true);
    setView("RUN");
  }, [onExit, syncLive]);

  const openQuickSettings = useCallback(() => {
    const tracker = trackerRef.current;
    stopCamera();
    if (tracker) syncLive(tracker.pause(Date.now()));
    setQuickSettingsOpen(true);
  }, [stopCamera, syncLive]);

  const closeQuickSettings = useCallback(() => {
    setQuickSettingsOpen(false);
    setView("PAUSED");
  }, []);

  const finishSession = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    stopCamera();
    const record = tracker.finish(records, Date.now());
    const nextRecords = appendStudyRecord(records, record);
    localStorage.setItem(STUDY_RECORDS_STORAGE_KEY, JSON.stringify(nextRecords));
    setRecords(nextRecords);
    setSelectedRecord(record);
    setLive(tracker.getSnapshot());
    setEndConfirmOpen(false);
    setEndingVideoVisible(false);
    updateRewardState((current) => recordStudyCompletion(current, new Date()));
    setView("RESULT");
  }, [records, stopCamera, updateRewardState]);

  const playEndingVideo = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    tracker.recordVideo(Date.now(), "STUDY_ENDING");
    stopCamera();
    setEndConfirmOpen(false);
    setEndingVideoVisible(true);
  }, [stopCamera]);

  const showResult = selectedRecord ?? records[0] ?? null;
  const cameraPanelVisible = view === "START" || view === "CAMERA" || view === "RUN";
  const filteredRecords = useMemo(() => {
    const cutoff = historyFilter === "ALL" ? 0 : Date.now() - (historyFilter === "7D" ? 7 : 30) * 86_400_000;
    return records.filter((record) => record.startedAt >= cutoff);
  }, [historyFilter, records]);

  return <section className={`study-mode study-view-${view.toLowerCase()}`} aria-label="열공 모드">
    {view === "START" && <header className="study-start-toolbar study-monitor-toolbar">
      <button className="study-start-back" onClick={onExit} aria-label="이전 화면">‹</button>
      <button className="study-start-settings" onClick={() => setView("SETTINGS")} aria-label="열공 설정">⚙</button>
    </header>}
    {view === "RUN" && live && <header className="study-run-toolbar">
      <button className="study-run-exit" onClick={requestEnd} aria-label="열공모드 나가기">‹ <span>나가기</span></button>
      <div>
        <span className={`study-live-dot ${live.status.toLowerCase()}`} /><b>{studyStatusLabel(live.status)} · {formatClock(live.actualStudyMs)}</b>
      </div>
      <button className="study-run-settings" onClick={openQuickSettings} aria-label="빠른 설정">⚙</button>
    </header>}
    {view === "CAMERA" && <header className="study-session-toolbar">
      <button onClick={() => {
        stopCamera();
        trackerRef.current = null;
        setLive(null);
        setView("START");
        setLaunchMenuOpen(true);
      }} aria-label="뒤로 가기">‹</button>
      <strong>집중모드 준비</strong>
      <button onClick={() => {
        stopCamera();
        trackerRef.current = null;
        setLive(null);
        setView("SETTINGS");
      }} aria-label="집중모드 설정">⚙</button>
    </header>}
    {(view === "PAUSED" || view === "BREAK" || view === "EXERCISE" || view === "RETURN") && live && <header className="study-session-toolbar">
      <span className="study-session-toolbar-spacer" />
      <strong>{view === "PAUSED" ? "집중모드 일시정지" : view === "BREAK" ? "휴식 중" : view === "EXERCISE" ? "스트레칭 중" : "집중모드 복귀"}</strong>
      <b>{formatClock(live.actualStudyMs)}</b>
    </header>}
    {view === "RUN" && live && focusImmersiveOpen && <StudyFocusImmersive
      totalStudyMs={live.actualStudyMs}
      imagePath={studyRewardPath(rewardState.selected)}
      onClose={closeFocusImmersive}
    />}
    <section className={`study-camera-shell ${cameraPanelVisible ? "visible" : "hidden"}`} aria-hidden={!cameraPanelVisible} data-screen-id="STUDY-03">
      <video ref={videoRef} playsInline muted />
      <canvas
        ref={canvasRef}
        className={`study-diagnostics-canvas${quickSettingsOpen ? " hidden" : ""}`}
        aria-hidden={quickSettingsOpen}
      />
      {endingVideoVisible && <div className="study-ending-camera-video">
        <video src={endingVideoPath} autoPlay playsInline controls onEnded={finishSession} onError={finishSession} />
        <div><small>STUDY COMPLETE</small><strong>오늘도 수고했어요</strong></div>
        <button onClick={finishSession}>영상 건너뛰고 결과 보기</button>
      </div>}
      {live?.pendingAlert && alertVideoVisible && (view === "RUN" || view === "CAMERA") && <div className="study-warning-camera-video">
        <video
          src={activeAlertVideoPath}
          autoPlay
          playsInline
          onEnded={() => {
            alertVideoVisibleRef.current = false;
            setAlertVideoVisible(false);
            monitorRef.current.resetTransientDetection();
            const tracker = trackerRef.current;
            if (tracker) {
              tracker.resetTransientDetection(Date.now());
              syncLive(tracker.acknowledgeAlert());
            }
          }}
          onError={() => {
            alertVideoVisibleRef.current = false;
            setAlertVideoVisible(false);
            monitorRef.current.resetTransientDetection();
            const tracker = trackerRef.current;
            if (tracker) {
              tracker.resetTransientDetection(Date.now());
              syncLive(tracker.acknowledgeAlert());
            }
          }}
        />
      </div>}
      {view === "START" && <div className="study-ready-camera">
        <div className="study-ready-face" aria-hidden="true"><span /><span /></div>
        <strong>열공 감지 준비</strong>
        <p>휴대폰을 실제 사용할 위치에 두고 얼굴만 보이게 해 주세요.</p>
        <small>정해진 자세 조건은 없습니다. 지금 보이는 얼굴 위치가 앞으로의 기준이 됩니다.</small>
      </div>}
      {view === "CAMERA" && <div className="study-calibration-video-status">
        <i className={monitorSnapshot.calibrationStable ? "active" : ""} />
        <strong>{studyCalibrationTitle(cameraBusy, monitorSnapshot, cameraChecks)}</strong>
      </div>}
    </section>

    {view === "CAMERA" && cameraPanelVisible && <section className="study-camera-check-panel" aria-label="카메라 기준 화면 확인">
      <header>
        <strong>{studyCalibrationTitle(cameraBusy, monitorSnapshot, cameraChecks)}</strong>
        <p>{cameraBusy ? "카메라를 연결하는 중입니다." : cameraError || cameraQualityMessage(cameraChecks)}</p>
      </header>
        <div className="study-check-list" aria-label="카메라 확인 상태">
          <CameraCheckIcon icon="●" label="얼굴" ready={cameraChecks.faceVisible} />
        </div>
        <div className="study-calibration-progress" aria-label={studyCalibrationProgressLabel(monitorSnapshot)}>
          <i style={{ width: `${monitorSnapshot.calibrationProgress * 100}%` }} />
        </div>
        <b className="study-calibration-progress-label">{studyCalibrationProgressLabel(monitorSnapshot)}</b>
        {diagnosticsEnabledRef.current && <aside className="study-diagnostics-panel">
          <span>EAR {monitorSnapshot.eyeAspectRatio?.toFixed(3) ?? "-"}</span>
          <span>시야각 {monitorSnapshot.cameraViewAngleDegrees?.toFixed(1) ?? "-"}°</span>
          <span>어깨 {monitorSnapshot.shoulderTiltDegrees?.toFixed(1) ?? "-"}°</span>
          <span>상체 축 {monitorSnapshot.torsoLeanDegrees?.toFixed(1) ?? "-"}°</span>
        </aside>}
        {cameraError && <button onClick={() => void startCamera(trackerRef.current === null)}>다시 시도</button>}
    </section>}

    {view === "START" && <StudyStartScreen
      settings={settings}
      records={records}
      onStart={requestStudyStart}
      onHistory={() => setView("HISTORY")}
    />}

    {view === "SETTINGS" && <StudySettingsScreen settings={settings} onChange={saveSettings} onResetStudyCalendar={resetStudyCalendar} onBack={() => {
      setView("START");
      setLaunchMenuOpen(true);
    }} onStart={requestStudyStart} />}

    {view === "CAMERA" && !cameraPanelVisible && <div className="study-loading">카메라 화면 준비 중…</div>}

    {view === "RUN" && live && <StudyRunScreen
      live={live}
      settings={settings}
      monitor={monitorSnapshot}
      cameraActive={cameraActive}
      quickSettingsOpen={quickSettingsOpen}
      onToggleQuick={closeQuickSettings}
      onSettings={saveSettings}
      onPause={() => {
        const tracker = trackerRef.current;
        if (!tracker) return;
        stopCamera();
        syncLive(tracker.pause(Date.now()));
        setView("PAUSED");
      }}
      onBreak={() => startBreak()}
      onFocus={openFocusImmersive}
      onExercise={startExercise}
      onSkipExercise={() => {
        const tracker = trackerRef.current;
        if (tracker) syncLive(tracker.skipExercise(Date.now()));
      }}
      onSnoozeExercise={() => {
        const tracker = trackerRef.current;
        if (!tracker) return;
        if (live.exerciseSnoozeCount >= 2) syncLive(tracker.skipExercise(Date.now()));
        else syncLive(tracker.snoozeExercise(Date.now()));
      }}
    />}

    {view === "PAUSED" && live && <StudyPausedScreen live={live} onResume={() => void startCamera(false)} onBreak={() => startBreak()} onEnd={requestEnd} />}

    {view === "BREAK" && live && <StudyBreakScreen
      live={live}
      settings={settings}
      videoPath={activeAlertVideoPath}
      onResume={() => {
        const tracker = trackerRef.current;
        if (!tracker) return;
        syncLive(tracker.endBreak(Date.now()));
        void startCamera(false);
      }}
      onEnd={requestEnd}
    />}

    {view === "EXERCISE" && live && <StudyExerciseScreen
      live={live}
      settings={settings}
      videoPath={alertVideoPath}
      onEnd={() => {
        const tracker = trackerRef.current;
        if (!tracker) return;
        syncLive(tracker.endExercise(Date.now()));
        void startCamera(false);
      }}
    />}

    {view === "RETURN" && live && <StudyReturnScreen
      live={live}
      settings={settings}
      videoPath={alertVideoPath}
      onResume={() => {
        const tracker = trackerRef.current;
        if (!tracker) return;
        syncLive(tracker.resume(Date.now()));
        void startCamera(false);
      }}
      onExtend={() => {
        const tracker = trackerRef.current;
        if (!tracker) return;
        syncLive(tracker.extendAway(Date.now(), 5));
        setView("RETURN");
      }}
      onEnd={requestEnd}
    />}

    {view === "RUN" && live && endConfirmOpen && <StudyEndConfirm live={live} onContinue={() => {
      setEndConfirmOpen(false);
      const tracker = trackerRef.current;
      if (!tracker) return;
      syncLive(tracker.resume(Date.now()));
      if (!cameraActive) void startCamera(false);
    }} onFinish={playEndingVideo} />}

    {(view === "RESULT" || view === "RECORD_DETAIL") && showResult && <StudyResultScreen
      record={showResult}
      records={records}
      screenId={view === "RESULT" ? "STUDY-15" : "STUDY-19"}
      onHome={() => {
        trackerRef.current = null;
        setLive(null);
        setSelectedRecord(null);
        setView("START");
        setLaunchMenuOpen(true);
      }}
      onHistory={() => setView("HISTORY")}
    />}

    {view === "HISTORY" && <StudyHistoryScreen
      records={filteredRecords}
      filter={historyFilter}
      onFilter={setHistoryFilter}
      onBack={() => {
        setView("START");
        setLaunchMenuOpen(true);
      }}
      onSelect={(record) => {
        setSelectedRecord(record);
        setView("RECORD_DETAIL");
      }}
    />}

    {view === "START" && launchMenuOpen && <StudyLaunchMenu
      recordCount={records.length}
      records={records}
      settings={settings}
      rewardState={rewardState}
      onClose={onExit}
      onStart={() => {
        setLaunchMenuOpen(false);
        requestStudyStart();
      }}
      onSettings={() => {
        setLaunchMenuOpen(false);
        setView("SETTINGS");
      }}
      onHistory={() => {
        setLaunchMenuOpen(false);
        setView("HISTORY");
      }}
      onDraw={() => updateRewardState((current) => unlockAllStudyRewardsForTest(current, new Date()))}
      onSelectImage={(image) => updateRewardState((current) => current.owned.includes(image) ? { ...current, selected: image } : current)}
    />}

  </section>;
}

function StudyCalendar({ records, dailyGoalMinutes }: { records: StudySessionRecord[]; dailyGoalMinutes: number }) {
  const today = new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dailyStudyMs = new Map<number, number>();
  const monthValue = `${year}-${String(month + 1).padStart(2, "0")}`;
  const moveMonth = (offset: number) => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));

  records.forEach((record) => {
    const date = new Date(record.startedAt);
    if (date.getFullYear() !== year || date.getMonth() !== month) return;
    dailyStudyMs.set(date.getDate(), (dailyStudyMs.get(date.getDate()) ?? 0) + record.actualStudyMs);
  });

  const studiedDays = [...dailyStudyMs.values()].filter((value) => value > 0).length;
  const achievedDays = [...dailyStudyMs.values()].filter((value) => value >= dailyGoalMinutes * 60_000).length;
  const cells = [
    ...Array.from({ length: firstWeekday }, (_, index) => ({ key: `empty-${index}`, day: 0 })),
    ...Array.from({ length: daysInMonth }, (_, index) => ({ key: `day-${index + 1}`, day: index + 1 })),
  ];

  return <section className="study-calendar" aria-label={`${year}년 ${month + 1}월 공부 달력`}>
    <header>
      <div>
        <small>STUDY CALENDAR</small>
        <div className="study-calendar-navigation">
          <button type="button" onClick={() => moveMonth(-1)} aria-label="이전 달">‹</button>
          <input
            type="month"
            aria-label="조회할 연도와 월"
            value={monthValue}
            max={`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`}
            onChange={(event) => {
              const [nextYear, nextMonth] = event.currentTarget.value.split("-").map(Number);
              if (nextYear && nextMonth) setVisibleMonth(new Date(nextYear, nextMonth - 1, 1));
            }}
          />
          <button type="button" onClick={() => moveMonth(1)} disabled={year === today.getFullYear() && month === today.getMonth()} aria-label="다음 달">›</button>
        </div>
      </div>
      <span>목표 {formatMinutes(dailyGoalMinutes * 60_000)}</span>
    </header>
    <div className="study-calendar-summary">
      <span>공부한 날 <b>{studiedDays}일</b></span>
      <span>목표 달성 <b>{achievedDays}일</b></span>
    </div>
    <div className="study-calendar-weekdays" aria-hidden="true">
      {["일", "월", "화", "수", "목", "금", "토"].map((label) => <b key={label}>{label}</b>)}
    </div>
    <div className="study-calendar-grid">
      {cells.map(({ key, day }) => {
        if (day === 0) return <i key={key} />;
        const studiedMs = dailyStudyMs.get(day) ?? 0;
        const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
        const achieved = studiedMs >= dailyGoalMinutes * 60_000;
        const state = achieved ? "achieved" : studiedMs > 0 ? (isToday ? "progress" : "missed") : "";
        const minutes = Math.max(1, Math.round(studiedMs / 60_000));
        return <span key={key} className={`${state} ${isToday ? "today" : ""}`}>
          <b>{day}</b>
          {studiedMs > 0 && <small>{minutes}분</small>}
          {studiedMs > 0 && <em>{achieved ? "달성" : isToday ? "진행" : "미달"}</em>}
        </span>;
      })}
    </div>
    <footer><span><i className="achieved" />목표 달성</span><span><i className="missed" />목표 미달</span><span><i className="progress" />오늘 진행</span></footer>
  </section>;
}

function StudyLaunchMenu({ recordCount, records, settings, rewardState, onClose, onStart, onSettings, onHistory, onDraw, onSelectImage }: {
  recordCount: number;
  records: StudySessionRecord[];
  settings: StudySettings;
  rewardState: StudyRewardState;
  onClose(): void;
  onStart(): void;
  onSettings(): void;
  onHistory(): void;
  onDraw(): void;
  onSelectImage(image: StudyRewardImage): void;
}) {
  const [changingImage, setChangingImage] = useState(false);
  const drawAvailable = rewardState.owned.length < STUDY_REWARD_IMAGES.length;
  const drawMessage = rewardState.owned.length >= STUDY_REWARD_IMAGES.length
    ? "모든 이미지를 획득했어요"
    : "테스트 중에는 한 번에 모든 이미지를 획득합니다";

  return <div className="study-modal-backdrop study-launch-backdrop" data-screen-id="STUDY-LAUNCH">
    <section className="study-modal study-launch-menu">
      <button className="study-launch-close" onClick={onClose} aria-label="홈으로 돌아가기">×</button>
      <StudyCalendar records={records} dailyGoalMinutes={settings.dailyGoalMinutes} />
      <div><small>STUDY FOCUS</small><h2>열공 모드</h2><p>연속 열공 : <b>{rewardState.streak}일째</b></p></div>
      <button className="study-primary study-launch-start" onClick={onStart}>▶ 열공 시작</button>
      <div className="study-modal-row">
        <button onClick={onSettings}>⚙ 열공 설정</button>
        <button onClick={onHistory}>▤ 공부 내역 보기{recordCount > 0 ? ` · ${recordCount}` : ""}</button>
      </div>
      <section className="study-reward-current">
        <img src={studyRewardPath(rewardState.selected)} alt="현재 설정된 열공 이미지" />
        <div><small>현재 집중 이미지</small><strong>{rewardState.owned.length} / {STUDY_REWARD_IMAGES.length} 보유</strong></div>
        <button onClick={() => setChangingImage((value) => !value)}>{changingImage ? "닫기" : "변경"}</button>
      </section>
      {changingImage && <section className="study-reward-picker">
        <button className="study-reward-draw" disabled={!drawAvailable} onClick={onDraw}>✦ 테스트용 전체 이미지 뽑기</button>
        <p>{drawMessage}</p>
        <div className="study-reward-grid">
          {STUDY_REWARD_IMAGES.map((image) => {
            const owned = rewardState.owned.includes(image);
            return <button
              key={image}
              className={`${owned ? "owned" : "locked"} ${rewardState.selected === image ? "selected" : ""}`}
              disabled={!owned}
              onClick={() => onSelectImage(image)}
              aria-label={owned ? "보유 이미지 선택" : "미획득 이미지"}
            >
              <img src={studyRewardPath(image)} alt="" />
              {!owned && <i aria-hidden="true">?</i>}
            </button>;
          })}
        </div>
      </section>}
    </section>
  </div>;
}

function StudyStartScreen({ settings, records, onStart, onHistory }: {
  settings: StudySettings;
  records: StudySessionRecord[];
  onStart(): void;
  onHistory(): void;
}) {
  return <section className="study-start study-monitor-start" data-screen-id="STUDY-01">
    <section className="study-ready-status">
      <div><span>STUDY STATUS</span><strong>준비</strong><p>시작을 누르면 현재 화면을 5초간 측정한 뒤 감지를 시작합니다.</p></div>
      <div className="study-ready-metrics">
        <article><small>눈·고개</small><b>—</b><em>감지 0회</em></article>
        <article><small>자세</small><b>—</b><em>기준 전</em></article>
      </div>
    </section>
    <section className="study-start-guide">
      <header><span>START GUIDE</span><strong>현재 위치를 기준으로 시작해요</strong></header>
      <p>휴대폰을 실제 사용할 위치에 두고 얼굴이 보이면, 지금 보이는 얼굴 위치를 그대로 5초간 기준으로 저장합니다.</p>
      <div><span><b>1</b>얼굴 인식</span><span><b>2</b>현재 위치 유지</span><span><b>3</b>얼굴 기준 저장</span></div>
    </section>
    <button className="study-detection-start" onClick={onStart}>▶ 기본 위치 설정 후 감지 시작</button>
    <div className="study-start-links"><button onClick={onHistory}>학습 기록 보기{records.length > 0 ? ` · ${records.length}개` : ""}</button><span>운동·휴식 {settings.exerciseIntervalMinutes}분 주기</span></div>
    <p className="study-privacy-note">원본 카메라 영상과 얼굴 이미지는 저장하지 않습니다.</p>
  </section>;
}

function StudySettingsScreen({ settings, onChange, onResetStudyCalendar, onBack, onStart }: { settings: StudySettings; onChange(patch: Partial<StudySettings>): void; onResetStudyCalendar(): void; onBack(): void; onStart(): void }) {
  const silentPreset = !settings.voiceEnabled && !settings.videoEnabled && !settings.soundEnabled;
  const applyPreset = (preset: "HOME" | "SILENT") => onChange(preset === "SILENT"
    ? { voiceEnabled: false, voiceDrowsinessEnabled: false, voiceBreakStartEnabled: false, voiceBreakEnabled: false, voiceReturnEnabled: false, videoEnabled: false, soundEnabled: false }
    : { voiceEnabled: true, voiceDrowsinessEnabled: true, voiceBreakStartEnabled: true, voiceBreakEnabled: true, voiceReturnEnabled: true, videoEnabled: true });
  return <section className="study-settings-screen" data-screen-id="STUDY-02">
    <header><button onClick={onBack}>‹</button><div><span>STUDY SETTINGS</span><h1>열공 설정</h1></div></header>
    <section className="study-preset-switch" aria-label="열공 모드 프리셋">
      <div className="study-preset-buttons">
        <button className={`home ${silentPreset ? "" : "selected"}`} onClick={() => applyPreset("HOME")} aria-pressed={!silentPreset}>
          <i aria-hidden="true">⌂</i><span><b>홈모드</b><small>영상·사운드 사용</small></span>
        </button>
        <button className={`silent ${silentPreset ? "selected" : ""}`} onClick={() => applyPreset("SILENT")} aria-pressed={silentPreset}>
          <i aria-hidden="true">◌</i><span><b>음소거모드</b><small>조용한 공간용</small></span>
        </button>
      </div>
      <div className={`study-preset-guide ${silentPreset ? "silent" : "home"}`} aria-live="polite">
        <b>{silentPreset ? "독서실·스터디카페에서 사용해요" : "혼자 있는 공간에서 사용해요"}</b>
        <p>{silentPreset
          ? "주변에 다른 사람이 있는 공간을 위한 모드입니다. 졸음이나 휴식 알림이 발생해도 영상과 사운드를 재생하지 않습니다."
          : "혼자 있거나 영상과 사운드가 재생되어도 괜찮은 공간에서 사용합니다. 졸음·휴식 상황에 맞춰 음성 안내와 영상을 사용할 수 있습니다."}</p>
      </div>
    </section>
    <StudySettingGroup title="하루 공부 목표" description="하루 동안 완료한 열공 기록을 합산해 목표 달성 여부를 달력에 표시합니다.">
      <NumberSetting label="목표 시간" value={settings.dailyGoalMinutes} min={10} max={1440} suffix="분" showRange={false} active onActivate={() => undefined} onChange={(value) => onChange({ dailyGoalMinutes: value })} />
      <p className="study-daily-goal-help">현재 목표: 하루 {formatMinutes(settings.dailyGoalMinutes * 60_000)} · 목표는 스스로 확인하기 위한 참고 표시입니다.</p>
    </StudySettingGroup>
    <StudySettingGroup title="운동 및 휴식 알림" description="공부를 시작한 뒤 정해진 주기가 되면 운동·휴식 알림이 나타나고 잠시 멈춥니다.">
      <div className="study-setting-inline-label"><span>운동 및 휴식 주기</span></div>
      <div className="study-time-setting-row" data-setting="exercise-interval">
        <ChoiceRow value={settings.exerciseIntervalInputMode === "PRESET" ? String(settings.exerciseIntervalMinutes) : ""} options={[{ value: "30", label: "30분마다" }, { value: "45", label: "45분마다" }, { value: "60", label: "60분마다" }]} onChange={(value) => onChange({ exerciseIntervalMinutes: Number(value), exerciseIntervalInputMode: "PRESET", focusMinutes: Number(value), breakEnabled: true, exerciseEnabled: true })} />
        <NumberSetting label="직접" value={settings.exerciseIntervalMinutes} min={5} max={180} suffix="분" showRange={false} active={settings.exerciseIntervalInputMode === "CUSTOM"} onActivate={() => onChange({ exerciseIntervalInputMode: "CUSTOM" })} onChange={(value) => onChange({ exerciseIntervalMinutes: value, exerciseIntervalInputMode: "CUSTOM", focusMinutes: value, breakEnabled: true, exerciseEnabled: true })} />
      </div>
      <div className="study-setting-inline-label"><span>운동 및 휴식 지속시간</span></div>
      <div className="study-time-setting-row" data-setting="break-duration">
        <ChoiceRow value={settings.breakDurationInputMode === "PRESET" ? String(settings.breakMinutes) : ""} options={[{ value: "5", label: "5분" }, { value: "10", label: "10분" }, { value: "15", label: "15분" }]} onChange={(value) => onChange({ breakMinutes: Number(value), breakDurationInputMode: "PRESET", exerciseMinutes: Number(value), breakEnabled: true, exerciseEnabled: true })} />
        <NumberSetting label="직접" value={settings.breakMinutes} min={1} max={60} suffix="분" showRange={false} active={settings.breakDurationInputMode === "CUSTOM"} onActivate={() => onChange({ breakDurationInputMode: "CUSTOM" })} onChange={(value) => onChange({ breakMinutes: value, breakDurationInputMode: "CUSTOM", exerciseMinutes: value, breakEnabled: true, exerciseEnabled: true })} />
      </div>
    </StudySettingGroup>
    <StudySettingGroup title="음성 안내" description="어떤 상황에서 음성 안내를 들을지 선택합니다.">
      <ChoiceRow value={settings.voiceEnabled ? "ON" : "OFF"} options={[{ value: "OFF", label: "전체 사용 안 함" }, { value: "ON", label: "전체 사용" }]} onChange={(value) => onChange({ voiceEnabled: value === "ON", voiceDrowsinessEnabled: value === "ON", voiceBreakStartEnabled: value === "ON", voiceBreakEnabled: value === "ON", voiceReturnEnabled: value === "ON" })} />
      <VoiceAlertSettings settings={settings} onChange={onChange} />
      <div className="study-video-setting">
        <div className="study-setting-inline-label"><span>동영상 노출</span></div>
        <ChoiceRow value={settings.videoEnabled ? "ON" : "OFF"} options={[{ value: "OFF", label: "동영상 OFF" }, { value: "ON", label: "동영상 ON" }]} onChange={(value) => onChange({ videoEnabled: value === "ON" })} />
        <p>OFF로 설정하면 졸음 경고·휴식·운동·자리 복귀 동영상이 모두 표시되지 않습니다.</p>
      </div>
    </StudySettingGroup>
    <section className="study-reset-progress">
      <div><strong>공부 기록 초기화</strong><p>연속 열공 일수와 공부 달력만 삭제합니다. 설정과 보유 이미지는 유지됩니다.</p></div>
      <button type="button" onClick={onResetStudyCalendar}>초기화</button>
    </section>
    <button className="study-primary sticky" onClick={onStart}>이 설정으로 열공 시작</button>
  </section>;
}

function StudyFocusImmersive({ totalStudyMs, imagePath, onClose }: { totalStudyMs: number; imagePath: string; onClose(): void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const currentTime = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  return <section className="study-focus-immersive" role="dialog" aria-modal="true" aria-label="열공 집중 전체 화면">
    <div className="study-focus-stars" aria-hidden="true" />
    <header><i aria-hidden="true" /><strong>열공 모드 중...</strong></header>
    <div className="study-focus-scene" aria-hidden="true">
      <span className="study-focus-candle-glow" />
      <img src={imagePath} alt="" />
    </div>
    <footer>
      <div className="study-focus-time">
        <span>현재 시간<strong>{currentTime}</strong></span>
        <i />
        <span>총 공부한 시간<strong>{formatClock(totalStudyMs)}</strong></span>
      </div>
      <button onClick={onClose}>해제하기</button>
    </footer>
  </section>;
}

function StudyRunScreen({ live, settings, monitor, cameraActive, quickSettingsOpen, onToggleQuick, onSettings, onPause, onBreak, onFocus, onExercise, onSkipExercise, onSnoozeExercise }: {
  live: StudyLiveSnapshot;
  settings: StudySettings;
  monitor: MonitorSnapshot;
  cameraActive: boolean;
  quickSettingsOpen: boolean;
  onToggleQuick(): void;
  onSettings(patch: Partial<StudySettings>): void;
  onPause(): void;
  onBreak(): void;
  onFocus(): void;
  onExercise(): void;
  onSkipExercise(): void;
  onSnoozeExercise(): void;
}) {
  return <section className="study-running" data-screen-id="STUDY-04">
    <StudyAlertLights live={live} monitor={monitor} />
    <div className={`study-timer-orb state-${live.status.toLowerCase()}`}>
      <small>열공 시간</small><strong>{formatClock(live.actualStudyMs)}</strong><span>{studyStatusLabel(live.status)}</span>
      <div className="study-orb-next">
        <small>다음 운동 <b>{live.nextExerciseInMs === null ? "없음" : formatClock(live.nextExerciseInMs)}</b></small>
        <small>다음 휴식 <b>{live.nextBreakInMs === null ? "없음" : formatClock(live.nextBreakInMs)}</b></small>
      </div>
    </div>
    <div className="study-run-actions"><button className="focus" onClick={onFocus}>화면 가리기</button><button onClick={onPause}>일시 정지</button><button onClick={onBreak}>휴식</button></div>
    <div className="study-camera-health"><i className={cameraActive && monitor.faceVisible ? "ok" : ""} />{cameraActive ? monitor.faceVisible ? "카메라 인식 양호" : "얼굴 확인 중" : "카메라 정지"}<span>영상·감지선 ON</span></div>
    <div className="study-live-metrics">
      <Metric label="눈 상태" value={monitor.eyesClosed ? "감김" : "정상"} sub={`깜빡임 ${live.counts.blinks}회 · 장시간 ${live.counts.longEyeClosures}회`} />
      <Metric label="장시간 눈 감김" value={`${live.counts.longEyeClosures}회`} />
      <Metric label="하품" value={`${live.counts.yawns}회`} sub="참고" />
      <Metric label="고개 떨어짐" value={`${live.counts.headDrops}회`} />
    </div>
    <StudyMiniFlow live={live} />
    {live.exerciseReminderDue && <div className="study-modal-backdrop" data-screen-id="STUDY-10"><section className="study-modal"><span className="study-modal-icon">↟</span><h2>몸을 한번 움직일 시간입니다</h2><p>가볍게 목과 어깨를 움직여 주세요.</p><button className="study-primary" onClick={onExercise}>운동 시작</button><div className="study-modal-row"><button onClick={onSnoozeExercise}>{live.exerciseSnoozeCount >= 2 ? "다음 주기로 넘기기" : "5분 뒤 알림"}</button><button onClick={onSkipExercise}>이번에는 건너뛰기</button></div></section></div>}
    {live.status === "AWAY" && <div className="study-modal-backdrop" data-screen-id="STUDY-12"><section className="study-modal"><span className="study-modal-icon">⌂</span><h2>자리 이탈이 감지되었습니다</h2><p>자리 이탈 {formatClock(live.awayDurationMs)}<br />30초 이후 열공 타이머와 집중 통계가 자동으로 멈춥니다.</p><small>돌아오면 재시작 여부를 확인합니다.</small></section></div>}
    {quickSettingsOpen && <StudyQuickSettings settings={settings} live={live} onChange={onSettings} onClose={onToggleQuick} onExercise={onExercise} onBreak={onBreak} onSkipExercise={onSkipExercise} />}
  </section>;
}

function StudyQuickSettings({ settings, live, onChange, onClose, onExercise, onBreak, onSkipExercise }: { settings: StudySettings; live: StudyLiveSnapshot; onChange(patch: Partial<StudySettings>): void; onClose(): void; onExercise(): void; onBreak(): void; onSkipExercise(): void }) {
  return <div className="study-sheet-backdrop" onClick={onClose} data-screen-id="STUDY-05"><section className="study-quick-sheet" onClick={(event) => event.stopPropagation()}><header><div><span>QUICK SETTINGS</span><h2>빠른 설정</h2></div><button onClick={onClose}>×</button></header>
    <label>음성 안내</label><ChoiceRow value={settings.voiceEnabled ? "ON" : "OFF"} options={[{ value: "OFF", label: "전체 끄기" }, { value: "ON", label: "전체 켜기" }]} onChange={(value) => onChange({ voiceEnabled: value === "ON", voiceDrowsinessEnabled: value === "ON", voiceBreakStartEnabled: value === "ON", voiceBreakEnabled: value === "ON", voiceReturnEnabled: value === "ON" })} />
    <div className="study-quick-toggles"><Toggle checked={settings.soundEnabled} label="사운드" onChange={(checked) => onChange({ soundEnabled: checked })} /><Toggle checked={settings.vibrationEnabled} label="진동" onChange={(checked) => onChange({ vibrationEnabled: checked })} /></div>
    <div className="study-next-action"><span>다음 운동 <b>{live.nextExerciseInMs === null ? "없음" : formatClock(live.nextExerciseInMs)}</b></span><button onClick={onExercise}>지금 운동</button><button onClick={onSkipExercise}>건너뛰기</button></div>
    <div className="study-next-action"><span>다음 휴식 <b>{live.nextBreakInMs === null ? "없음" : formatClock(live.nextBreakInMs)}</b></span><button onClick={onBreak}>지금 휴식</button></div>
  </section></div>;
}

function StudyPausedScreen({ live, onResume, onBreak, onEnd }: { live: StudyLiveSnapshot; onResume(): void; onBreak(): void; onEnd(): void }) {
  return <section className="study-state-screen study-card" data-screen-id="STUDY-04"><span className="study-state-icon">Ⅱ</span><h1>열공 일시 정지</h1><p>카메라 분석과 집중 통계가 멈췄습니다.</p><strong>{formatClock(live.actualStudyMs)}</strong><button className="study-primary" onClick={onResume}>열공 다시 시작</button><div><button onClick={onBreak}>휴식하기</button><button onClick={onEnd}>오늘 열공 종료</button></div></section>;
}

function StudyBreakScreen({ live, settings, videoPath, onResume, onEnd }: { live: StudyLiveSnapshot; settings: StudySettings; videoPath: string; onResume(): void; onEnd(): void }) {
  return <section className="study-state-screen study-break-screen" data-screen-id="STUDY-09">
    {settings.videoEnabled && settings.breakVideo !== "NONE" && <video className="study-content-video" src={videoPath} playsInline autoPlay muted={settings.warningMode === "QUIET"} onEnded={(event) => { event.currentTarget.style.opacity = "0.25"; }} />}
    <div className="study-state-content study-break-content">
      <div className="study-break-summary">
        <span className="study-state-icon">☕</span>
        <div><small>STUDY BREAK</small><h1>{live.breakCompleted ? "휴식 시간이 끝났습니다" : "잠시 쉬어가요"}</h1></div>
      </div>
      <strong>{formatClock(live.breakRemainingMs)}</strong>
      <p>{live.breakCompleted ? "자동으로 시작하지 않습니다. 준비되면 아래 버튼을 눌러주세요." : "화면에서 눈을 떼고 가볍게 몸을 움직여 주세요."}</p>
      <div className="study-break-actions">
        <button className="study-primary" onClick={onResume}>{live.breakCompleted ? "열공 다시 시작" : "휴식 마치고 열공 시작"}</button>
        <button className="study-break-end" onClick={onEnd}>오늘 열공 종료</button>
      </div>
    </div>
    <div className="study-break-ad-space" aria-hidden="true" />
  </section>;
}

function StudyExerciseScreen({ live, settings, videoPath, onEnd }: { live: StudyLiveSnapshot; settings: StudySettings; videoPath: string; onEnd(): void }) {
  return <section className="study-state-screen study-exercise-screen" data-screen-id="STUDY-11">
    {settings.videoEnabled && settings.exerciseVideo !== "NONE" && <video className="study-content-video" src={videoPath} playsInline autoPlay muted={settings.warningMode === "QUIET"} />}
    <div className="study-state-content"><span className="study-state-icon">↟</span><h1>가볍게 움직여요</h1><strong>{formatClock(live.exerciseRemainingMs)}</strong><p>목과 어깨를 천천히 움직여 주세요.</p><button className="study-primary" onClick={onEnd}>{live.exerciseCompleted ? "열공 다시 시작" : "운동 종료하고 열공 재개"}</button></div>
  </section>;
}

function StudyReturnScreen({ live, settings, videoPath, onResume, onExtend, onEnd }: { live: StudyLiveSnapshot; settings: StudySettings; videoPath: string; onResume(): void; onExtend(): void; onEnd(): void }) {
  return <section className="study-state-screen study-card" data-screen-id="STUDY-13">{settings.videoEnabled && settings.returnVideo !== "NONE" && <video className="study-content-video" src={videoPath} playsInline autoPlay muted={settings.warningMode === "QUIET"} />}<span className="study-state-icon">↩</span><h1>다시 열공을 시작할까요?</h1><p>자리 이탈 시간</p><strong>{formatClock(live.awayDurationMs)}</strong><button className="study-primary" onClick={onResume}>바로 시작</button><div><button onClick={onExtend}>5분 더 쉬기</button><button onClick={onEnd}>오늘 열공 종료</button></div></section>;
}

function StudyEndConfirm({ live, onContinue, onFinish }: { live: StudyLiveSnapshot; onContinue(): void; onFinish(): void }) {
  return <div className="study-modal-backdrop" data-screen-id="STUDY-14"><section className="study-modal"><span className="study-modal-icon">■</span><h2>열공을 종료할까요?</h2><p>현재 열공 시간 <b>{formatClock(live.actualStudyMs)}</b><br />종료하면 이번 학습 결과를 확인할 수 있습니다.</p><button onClick={onContinue}>계속 공부하기</button><button className="study-primary" onClick={onFinish}>종료하고 결과 보기</button></section></div>;
}

function StudyHistoryScreen({ records, filter, onFilter, onBack, onSelect }: { records: StudySessionRecord[]; filter: HistoryFilter; onFilter(value: HistoryFilter): void; onBack(): void; onSelect(record: StudySessionRecord): void }) {
  return <section className="study-history" data-screen-id="STUDY-18"><header><button onClick={onBack}>‹</button><div><span>STUDY HISTORY</span><h1>학습 기록</h1></div></header><ChoiceRow value={filter} options={[{ value: "7D", label: "최근 7일" }, { value: "30D", label: "최근 30일" }, { value: "ALL", label: "전체" }]} onChange={(value) => onFilter(value as HistoryFilter)} />
    <StudyTrendGraph records={records} />
    <div className="study-record-list">{records.length === 0 ? <p>선택한 기간에 저장된 열공 기록이 없습니다.</p> : records.map((record) => <button key={record.id} onClick={() => onSelect(record)}><span>{formatDate(record.startedAt)}</span><strong>열공 {formatMinutes(record.actualStudyMs)} · 집중 유지율 {Math.round(record.focusRate * 100)}%</strong><small>졸음 경고 {record.counts.warningLevel1 + record.counts.warningLevel2 + record.counts.warningLevel3}회 · {comparisonLabel(record)}</small><em>›</em></button>)}</div>
  </section>;
}

function StudyResultScreen({ record, records, screenId, onHome, onHistory }: { record: StudySessionRecord; records: StudySessionRecord[]; screenId: "STUDY-15" | "STUDY-19"; onHome(): void; onHistory(): void }) {
  return <section className="study-result" data-screen-id={screenId}><header><span>STUDY RESULT</span><h1>{screenId === "STUDY-15" ? "이번 열공 기록" : "열공 기록 상세"}</h1><p>{formatDate(record.startedAt)}</p></header>
    <section className="study-result-hero"><h2>오늘 {formatMinutes(record.actualStudyMs)} 동안 열공했습니다.</h2><div><Summary label="실제 집중 시간" value={formatMinutes(record.focusMs)} /><Summary label="집중 유지율" value={`${Math.round(record.focusRate * 100)}%`} /><Summary label="졸음 경고" value={`${record.counts.warningLevel1 + record.counts.warningLevel2 + record.counts.warningLevel3}회`} /><Summary label="최근 3회 대비" value={comparisonLabel(record)} /></div><small>집중 유지율은 능력 평가가 아닌 이번 세션의 행동 상태 참고 지표입니다.</small></section>
    <section className="study-result-section"><h2>핵심 지표</h2><div className="study-result-grid">
      <Metric label="전체 열공" value={formatMinutes(record.actualStudyMs)} /><Metric label="가장 긴 집중" value={formatMinutes(record.longestContinuousFocusMs)} /><Metric label="눈 깜빡임" value={`${record.counts.blinks}회`} sub={`분당 ${perMinute(record.counts.blinks, record.actualStudyMs)}`} /><Metric label="장시간 눈 감김" value={`${record.counts.longEyeClosures}회`} sub={`시간당 ${record.rates.longEyeClosuresPerHour.toFixed(1)}회`} /><Metric label="가장 오래 눈 감음" value={`${(record.maxEyeClosureMs / 1_000).toFixed(1)}초`} /><Metric label="하품" value={`${record.counts.yawns}회`} sub="참고 지표" /><Metric label="고개 떨어짐" value={`${record.counts.headDrops}회`} /><Metric label="엎드림" value={`${record.counts.deskSleeps}회`} /><Metric label="자세 경고" value={`${record.counts.postureWarnings}회`} /><Metric label="자리 이탈" value={`${record.counts.userLeft}회`} sub={formatMinutes(record.awayMs)} /><Metric label="휴식·운동" value={`${record.counts.breaks}회 · ${record.counts.exercises}회`} /><Metric label="TTS·영상" value={`${record.counts.ttsPlayed}회 · ${record.counts.videoPlayed}회`} />
    </div></section>
    <section className="study-result-section" data-screen-id="STUDY-16"><h2>이전 3회 평균 비교</h2>{record.comparison.sampleSize === 0 ? <p className="study-empty-copy">비교할 이전 기록이 없습니다. 다음 기록부터 시간당 발생률을 함께 비교합니다.</p> : <div className="study-compare-grid"><Compare label="집중 유지율" current={`${Math.round(record.focusRate * 100)}%`} previous={`${Math.round((record.comparison.focusRateAverage ?? 0) * 100)}%`} change={record.comparison.focusRateChangePercent} positiveIsBetter /><Compare label="장시간 눈 감김" current={`${record.rates.longEyeClosuresPerHour.toFixed(1)}회/시간`} previous={`${(record.comparison.longEyeClosuresPerHourAverage ?? 0).toFixed(1)}회/시간`} change={record.comparison.longEyeClosureRateChangePercent} /></div>}</section>
    <section className="study-result-section" data-screen-id="STUDY-17"><h2>이번 집중 흐름</h2><StudyFlowGraph record={record} /></section>
    <section className="study-result-section"><h2>측정 품질: {record.quality.grade === "GOOD" ? "양호" : "참고용"}</h2><div className="study-quality-bars"><Quality label="얼굴 인식" value={record.quality.faceVisibleRate} /><Quality label="눈 인식" value={record.quality.eyeVisibleRate} /><Quality label="상체 인식" value={record.quality.poseVisibleRate} /></div>{record.quality.grade === "REFERENCE" && <p>인식이 불안정한 구간이 있어 일부 감지 횟수에 오차가 있을 수 있습니다.</p>}</section>
    <section className="study-insights"><h2>이번 기록 한눈에 보기</h2>{record.insights.map((item) => <p key={item}>{item}</p>)}</section>
    <StudyTrendGraph records={records.slice(0, 7)} />
    <div className="study-primary-actions"><button className="study-secondary" onClick={onHistory}>전체 기록</button><button className="study-primary" onClick={onHome}>열공 모드 홈</button></div>
  </section>;
}

function StudyMiniFlow({ live }: { live: StudyLiveSnapshot }) {
  const cutoff = live.updatedAt - 5 * 60_000;
  const recent = live.timeline.filter((point) => point.at >= cutoff).slice(-90);
  const points = recent.length > 0
    ? recent
    : [{ at: live.updatedAt, elapsedMs: live.actualStudyMs, state: live.status === "DROWSY" ? "DROWSY" as const : "FOCUS" as const }];
  const startedAt = points[0].at;
  const endedAt = Math.max(live.updatedAt, startedAt + 1_000);
  const pointPosition = (point: StudyLiveSnapshot["timeline"][number]) => ({
    x: ((point.at - startedAt) / (endedAt - startedAt)) * 100,
    y: studyFlowLevel(point.state),
  });
  const positioned = points.map(pointPosition);
  const lastPosition = positioned.at(-1) ?? { x: 0, y: studyFlowLevel("FOCUS") };
  const extended = lastPosition.x < 100 ? [...positioned, { x: 100, y: lastPosition.y }] : positioned;
  const linePath = extended.map((point, index) => index === 0
    ? `M ${point.x.toFixed(2)} ${point.y}`
    : `H ${point.x.toFixed(2)} V ${point.y}`).join(" ");
  const currentState = points.at(-1)?.state ?? "FOCUS";

  return <section className="study-mini-flow">
    <header><div><span>FOCUS TIMELINE</span><b>집중 흐름 분석</b></div><em className={currentState.toLowerCase()}>{timelineLabel(currentState)}</em></header>
    <div className="study-live-flow-chart">
      <div className="study-live-flow-axis" aria-hidden="true"><span>졸음</span><span>주의</span><span>집중</span><span>이탈</span></div>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" role="img" aria-label={`최근 5분 집중 흐름 · 현재 ${timelineLabel(currentState)}`}>
        <g className="study-live-flow-grid"><line x1="0" y1="10" x2="100" y2="10" /><line x1="0" y1="30" x2="100" y2="30" /><line x1="0" y1="50" x2="100" y2="50" /><line x1="0" y1="70" x2="100" y2="70" /></g>
        <path className="study-live-flow-line" d={linePath} />
        {positioned.map((point, index) => <circle key={`${points[index].at}-${index}`} className={studyFlowClass(points[index].state)} cx={point.x} cy={point.y} r="1.8" />)}
      </svg>
    </div>
    <footer><div className="study-live-flow-legend"><span className="focus">집중</span><span className="attention">주의</span><span className="drowsy">졸음</span><span className="away">이탈</span></div><small>최근 5분 · 상태 변화</small></footer>
  </section>;
}

function studyFlowLevel(state: StudyLiveSnapshot["timeline"][number]["state"]): number {
  if (state === "DROWSY") return 10;
  if (state === "ATTENTION") return 30;
  if (state === "FOCUS") return 50;
  return 70;
}

function studyFlowClass(state: StudyLiveSnapshot["timeline"][number]["state"]): string {
  if (state === "DROWSY") return "drowsy";
  if (state === "ATTENTION") return "attention";
  if (state === "FOCUS") return "focus";
  return "away";
}

function StudyFlowGraph({ record }: { record: StudySessionRecord }) {
  const [selected, setSelected] = useState<number | null>(null);
  const points = record.timeline.length > 0 ? record.timeline : [{ at: record.startedAt, elapsedMs: 0, state: "FOCUS" as const }];
  const item = selected === null ? null : points[selected];
  return <div className="study-flow-graph"><div className="study-flow-track">{points.map((point, index) => <button key={`${point.at}-${index}`} className={point.state.toLowerCase()} onClick={() => setSelected(index)} aria-label={`${formatTime(point.at)} ${point.state}`} />)}</div><div className="study-flow-legend"><span className="focus">집중</span><span className="attention">주의</span><span className="drowsy">졸음</span><span className="break">휴식</span><span className="exercise">운동</span><span className="away">자리 이탈</span></div>{item && <p><b>{formatTime(item.at)}</b> · {timelineLabel(item.state)}{item.detail ? ` · ${item.detail}` : ""}</p>}</div>;
}

function StudyTrendGraph({ records }: { records: StudySessionRecord[] }) {
  const ordered = [...records].slice(0, 7).reverse();
  if (ordered.length === 0) return <section className="study-trend"><h2>최근 기록 추세</h2><p>기록이 쌓이면 집중 유지율 추세를 보여드립니다.</p></section>;
  if (ordered.length === 1) {
    const record = ordered[0];
    return <section className="study-trend study-trend-single">
      <div><span>첫 기록</span><strong>{Math.round(record.focusRate * 100)}%</strong><small>집중 유지율</small></div>
      <p>기록이 2개 이상 쌓이면 변화 추세를 그래프로 보여드립니다.</p>
    </section>;
  }
  const points = ordered.map((record, index) => `${ordered.length === 1 ? 50 : index * (100 / (ordered.length - 1))},${100 - record.focusRate * 85}`).join(" ");
  return <section className="study-trend"><h2>최근 기록 추세</h2><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="최근 집중 유지율 추세"><path d="M0 100H100" /><polyline points={points} /></svg><div>{ordered.map((record) => <span key={record.id}>{Math.round(record.focusRate * 100)}%</span>)}</div></section>;
}

function Summary({ label, value }: { label: string; value: string }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) { return <article><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</article>; }
type StudyAlertLightLevel = "normal" | "checking" | "warning";
function StudyAlertLights({ live, monitor }: { live: StudyLiveSnapshot; monitor: MonitorSnapshot }) {
  const eyesObservable = monitor.faceVisible
    && monitor.eyeAspectRatio !== null
    && !monitor.headDown;
  const eyeDuration = eyesObservable && monitor.eyesClosed ? monitor.closedDurationMs : 0;
  const eyeLevel: StudyAlertLightLevel = monitor.headDown
    ? "normal"
    : !monitor.faceVisible
      ? "checking"
      : eyeDuration > 5_000
        ? "warning"
        : eyeDuration >= 3_000
          ? "checking"
          : "normal";
  const eyeValue = monitor.headDown
    ? "독서 자세 · 판정 제외"
    : !monitor.faceVisible
      ? "눈 인식 확인"
      : !monitor.eyesClosed
        ? "정상"
        : eyeDuration >= 3_000
          ? `감김 ${formatSensorSeconds(eyeDuration)}`
          : "깜빡임";

  const headPostureDuration = monitor.headDown ? monitor.headDownDurationMs : 0;
  const postureWarning = !monitor.headDown && monitor.postureStatus === "WARNING";
  const postureChecking = !monitor.headDown && (monitor.postureStatus === "CHECKING"
    || monitor.postureStatus === "NO_POSE"
    || monitor.postureStatus === "WAITING");
  const postureLevel: StudyAlertLightLevel = postureWarning ? "warning" : postureChecking ? "checking" : "normal";
  const postureValue = monitor.headDown
    ? `독서 자세 ${formatSensorSeconds(headPostureDuration)}`
    : studyPostureIssueLabel(monitor.postureIssue);

  const collapseCandidate = monitor.bodyCollapseCountReady
    && monitor.postureIssue === "SLOUCHING";
  const collapseDuration = collapseCandidate
    ? monitor.bodyCollapseDurationMs
    : 0;
  const collapseLevel: StudyAlertLightLevel = collapseDuration > 5_000
    ? "warning"
    : collapseDuration >= 3_000
      ? "checking"
      : "normal";
  const collapseValue = collapseLevel === "warning"
    ? "쓰러짐 감지"
    : collapseLevel === "checking"
      ? `확인 ${formatSensorSeconds(collapseDuration)}`
      : "정상";

  const awayWarning = live.status === "AWAY" || live.status === "RETURN_WAITING";
  const awayChecking = !awayWarning
    && (monitor.trigger === "FACE_MISSING" || (!monitor.faceVisible && !monitor.poseVisible));
  const awayLevel: StudyAlertLightLevel = awayWarning ? "warning" : awayChecking ? "checking" : "normal";
  const awayValue = awayWarning
    ? `이탈 ${formatSensorSeconds(live.awayDurationMs)}`
    : awayChecking
      ? "자리 확인 중"
      : "정상";

  return <section className="study-alert-lights" aria-label="실시간 감지 경고등" aria-live="polite">
    <StudyAlertLight label="눈 감김" value={eyeValue} level={eyeLevel} />
    <StudyAlertLight label="자세 이상" value={postureValue} level={postureLevel} warningLabel="주의" />
    <StudyAlertLight label="쓰러짐" value={collapseValue} level={collapseLevel} />
    <StudyAlertLight label="자리 이탈" value={awayValue} level={awayLevel} />
  </section>;
}
function StudyAlertLight({ label, value, level, warningLabel = "경고" }: { label: string; value: string; level: StudyAlertLightLevel; warningLabel?: string }) {
  return <article className={level}><header><i aria-hidden="true" /><span>{label}</span></header><strong>{value}</strong><small>{level === "normal" ? "정상 감지" : level === "checking" ? "확인 중" : warningLabel}</small></article>;
}
function studyPostureIssueLabel(issue: string): string {
  return {
    NONE: "정상",
    SHOULDER_TILT: "어깨 기울어짐",
    LEANING: "몸 기울어짐",
    SLOUCHING: "상체 숙임",
    FORWARD_HEAD: "거북목",
    CAMERA_ANGLE: "카메라 각도 확인",
    TORSO_MISSING: "허리선 확인",
    POSE_MISSING: "자세 인식 확인",
  }[issue] ?? "자세 확인";
}
function formatSensorSeconds(ms: number): string { return `${(Math.max(0, ms) / 1_000).toFixed(1)}초`; }
function CameraCheckIcon({ icon, label, ready }: { icon: string; label: string; ready: boolean }) { return <span className={ready ? "ok" : ""}><i aria-hidden="true">{ready ? "✓" : icon}</i><b>{label}</b><small>{ready ? "확인" : "대기"}</small></span>; }
function Compare({ label, current, previous, change, positiveIsBetter = false }: { label: string; current: string; previous: string; change: number | null; positiveIsBetter?: boolean }) { const adjusted = change === null ? 0 : positiveIsBetter ? change : -change; return <article><span>{label}</span><strong>{current}</strong><small>이전 3회 {previous}</small><em className={Math.abs(adjusted) < 5 ? "same" : adjusted > 0 ? "better" : "lower"}>{change === null || Math.abs(change) < 5 ? "비슷함" : `${Math.abs(Math.round(change))}% ${adjusted > 0 ? "좋아짐" : "변화"}`}</em></article>; }
function Quality({ label, value }: { label: string; value: number }) { return <label><span>{label} {Math.round(value * 100)}%</span><i><b style={{ width: `${value * 100}%` }} /></i></label>; }
function StudySettingGroup({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="study-setting-group"><header><h2>{title}</h2><p>{description}</p></header>{children}</section>; }
function ChoiceRow({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string }>; onChange(value: string): void }) { return <div className="study-choice-row">{options.map((option) => <button key={option.value} className={value === option.value ? "selected" : ""} onClick={() => onChange(option.value)} aria-pressed={value === option.value}>{option.label}</button>)}</div>; }
function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange(value: boolean): void }) { return <button className="study-toggle" onClick={() => onChange(!checked)} aria-pressed={checked}><span>{label}</span><i className={checked ? "on" : ""}><b /></i></button>; }
function VoiceAlertSettings({ settings, onChange }: { settings: StudySettings; onChange(patch: Partial<StudySettings>): void }) {
  return <div className="study-voice-alert-list">
    <Toggle checked={settings.voiceDrowsinessEnabled} label="졸음 경고 음성" onChange={(checked) => onChange({ voiceEnabled: checked || settings.voiceBreakStartEnabled || settings.voiceBreakEnabled || settings.voiceReturnEnabled, voiceDrowsinessEnabled: checked })} />
    <Toggle checked={settings.voiceBreakStartEnabled} label="휴식 시작 안내 음성" onChange={(checked) => onChange({ voiceEnabled: checked || settings.voiceDrowsinessEnabled || settings.voiceBreakEnabled || settings.voiceReturnEnabled, voiceBreakStartEnabled: checked })} />
    <Toggle checked={settings.voiceBreakEnabled} label="휴식 종료 안내 음성" onChange={(checked) => onChange({ voiceEnabled: checked || settings.voiceDrowsinessEnabled || settings.voiceBreakStartEnabled || settings.voiceReturnEnabled, voiceBreakEnabled: checked })} />
    <Toggle checked={settings.voiceReturnEnabled} label="자리 이탈 안내 음성" onChange={(checked) => onChange({ voiceEnabled: checked || settings.voiceDrowsinessEnabled || settings.voiceBreakStartEnabled || settings.voiceBreakEnabled, voiceReturnEnabled: checked })} />
  </div>;
}
function NumberSetting({ label, value, min, max, suffix, showRange = true, active = false, onActivate, onChange }: { label: string; value: number; min: number; max: number; suffix: string; showRange?: boolean; active?: boolean; onActivate?(): void; onChange(value: number): void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value;
    setDraft(String(next));
    onChange(next);
  };
  return <label className={`study-number-setting ${showRange ? "" : "without-range"} ${active ? "is-active" : ""}`}><span>{label}</span><span><input type="number" inputMode="numeric" aria-label={`${label} ${suffix}`} value={draft} min={min} max={max} onFocus={onActivate} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><b>{suffix}</b></span>{showRange && <small>{min}~{max}{suffix}</small>}</label>;
}

function formatClock(ms: number): string { const total = Math.max(0, Math.ceil(ms / 1_000)); const hours = Math.floor(total / 3_600); const minutes = Math.floor((total % 3_600) / 60); const seconds = total % 60; return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; }
function formatMinutes(ms: number): string { const minutes = Math.max(0, Math.round(ms / 60_000)); return minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`; }
function formatDate(at: number): string { return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at); }
function formatTime(at: number): string { return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(at); }
function perMinute(count: number, ms: number): string { return (count / Math.max(ms / 60_000, 1 / 60)).toFixed(1); }
function timelineLabel(state: StudySessionRecord["timeline"][number]["state"]): string { return { FOCUS: "집중", ATTENTION: "주의", DROWSY: "졸음", BREAK: "휴식", EXERCISE: "운동", AWAY: "자리 이탈", PAUSED: "일시 정지" }[state]; }
function comparisonLabel(record: StudySessionRecord): string { if (record.comparison.label === "NO_DATA") return "첫 기록"; if (record.comparison.label === "SIMILAR") return "이전과 비슷함"; return record.comparison.label === "BETTER" ? "이전 대비 좋아짐" : "휴식 권장"; }

function cameraQualityMessage(checks: CameraChecks): string {
  if (!checks.faceVisible) return "현재 위치에서 얼굴이 인식되도록 잠시 화면을 바라봐 주세요.";
  return "다른 자세 조건은 없습니다. 지금 보이는 얼굴 위치를 기준으로 저장합니다.";
}

function studyCalibrationTitle(cameraBusy: boolean, monitor: MonitorSnapshot, checks: CameraChecks): string {
  if (cameraBusy) return "카메라를 준비하고 있습니다";
  if (monitor.calibrationStable && allStudyCameraChecksReady(checks)) return "기준 자세 측정 중";
  return "카메라 위치 조정 중";
}

function studyCalibrationProgressLabel(monitor: MonitorSnapshot): string {
  if (monitor.calibrationStable) {
    const seconds = Math.max(1, Math.ceil(monitor.calibrationRemainingMs / 1_000));
    return `기준 자세 측정 중 · ${seconds}초 남음`;
  }
  return "조건이 맞으면 5초 감지를 시작합니다";
}

function allStudyCameraChecksReady(checks: CameraChecks): boolean {
  return checks.faceVisible;
}

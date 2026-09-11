import { t, useLanguage } from "./language";
import { WakeIcon, WakeMascot } from "./WakeIcon";
import { chooseDriverWarning, driverVideoProfiles, isDriverVideoAllowed, type EnglishWarningMode } from './driverWarning';
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VideoPoster } from "./VideoPoster";
import { APP } from "./appProfile";
import { AnalyticsSettings } from "./AnalyticsSettings";
import { analyticsEvent, getAnalyticsStatus, subscribeAnalytics } from "./analytics";
import { VideoMetrics } from "./analyticsCore";
import type { WakeUpPlaybackMode } from "./wakeUpPlayback";
import { getWakeUpVideoProfile, type WakeUpLibraryState, type WakeUpVideoId } from "./wakeUpVideos";

interface Props {
  library: WakeUpLibraryState;
  playbackMode: WakeUpPlaybackMode;
  selectedId: WakeUpVideoId;
  busy: boolean;
  feedback: string;
  voiceFeedback: string;
  soundEnabled: boolean;
  englishWarningMode: EnglishWarningMode;
  onSelect(id: WakeUpVideoId): void;
  onApply(): void;
  onUnlock(id: WakeUpVideoId): void;
  onStart(): void;
  onSoundToggle(): void;
  onVoiceTest(): void;
}

export function DriverLibrary({ library, playbackMode, selectedId, busy, feedback, voiceFeedback, soundEnabled, englishWarningMode, onSelect, onApply, onUnlock, onStart, onSoundToggle, onVoiceTest }: Props) {
  const language = useLanguage();
  const catalog = driverVideoProfiles(language);
  const ownedCount = catalog.filter(video => library.downloadedIds.includes(video.id)).length;
  const [filter, setFilter] = useState<"ALL" | "OWNED">("ALL");
  const [previewId, setPreviewId] = useState<WakeUpVideoId | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const previewMetrics = useRef(new VideoMetrics(analyticsEvent,()=>getAnalyticsStatus().enabled));
  const analyticsStatus=useSyncExternalStore(subscribeAnalytics,getAnalyticsStatus);
  const libraryElement=useRef<HTMLElement>(null);
  const impressions=useRef(new Set<string>());
  useEffect(()=>{if(!analyticsStatus.enabled){previewMetrics.current.clear();impressions.current.clear();}},[analyticsStatus.enabled]);
  useEffect(()=>()=>previewMetrics.current.exit(),[]);
  useEffect(()=> {
    if(!analyticsStatus.enabled || previewId || !libraryElement.current || typeof IntersectionObserver==='undefined') return;
    const observer=new IntersectionObserver(entries=> {
      for(const entry of entries) {
        if(!entry.isIntersecting || entry.intersectionRatio<0.5 || document.visibilityState!=="visible" || !getAnalyticsStatus().enabled) continue;
        const id=(entry.target as HTMLElement).dataset.videoId!; const key=`${filter}:${id}`;
        if(impressions.current.has(key)) continue;
        impressions.current.add(key);
        analyticsEvent("video_impression",{video_id:id,filter,ownership:library.downloadedIds.includes(id as WakeUpVideoId) ? "owned" : "locked"});
      }
    },{threshold:0.5});
    const observe=()=> {observer.disconnect();if(document.visibilityState==='visible') libraryElement.current?.querySelectorAll('[data-video-id]').forEach(element=>observer.observe(element));};
    observe();document.addEventListener('visibilitychange',observe);
    return ()=>{observer.disconnect();document.removeEventListener('visibilitychange',observe);};
  },[analyticsStatus.enabled,filter,previewId,library.downloadedIds,selectedId,language]);
  const featured = useRef<HTMLElement>(null);
  const selected = catalog.find(video => video.id === selectedId) ?? catalog[0] ?? getWakeUpVideoProfile(selectedId);
  const owned = true;
  const englishApplied = chooseDriverWarning('en', 'VIDEO', library, 'APPLIED');
  const applied = (language !== 'en' || englishWarningMode === 'VIDEO') && playbackMode === 'APPLIED'
    && (language === 'en' ? englishApplied?.id === selected.id : library.appliedId === selected.id);
  const profiles = catalog.filter(item => filter === "ALL" || library.downloadedIds.includes(item.id));
  useEffect(() => {
    if (catalog.length && !isDriverVideoAllowed(language, selectedId)) onSelect(catalog[0].id);
  }, [language, selectedId, onSelect]);
  const selectVideo = (id: WakeUpVideoId) => { if (busy) return; analyticsEvent("video_select",{video_id:id}); onSelect(id); featured.current?.scrollIntoView({ behavior: "auto", block: "start" }); };
  const openPreview = (id: WakeUpVideoId) => {
    if (!isDriverVideoAllowed(language, id)) return;
    if (busy) return;
    if (!library.downloadedIds.includes(id)) { selectVideo(id); return; }
    setPreviewError(false); setPreviewId(id);
    previewMetrics.current.begin(id,"preview");
    analyticsEvent("ui_click",{action:"video_preview",video_id:id});
  };
  useEffect(() => { if (previewId) dialog.current?.showModal(); }, [previewId]);
  const closePreview = () => { previewMetrics.current.exit(); dialog.current?.close(); setPreviewId(null); };
  const changeFilter=(value:"ALL"|"OWNED")=>{if(value!==filter) analyticsEvent("library_filter",{filter:value});setFilter(value);};
  return <section ref={libraryElement} className={`pop-library ${motionPaused || previewId ? "motion-paused" : ""}`} aria-label={t("{0} 영상 보관함", APP.name)}>
    <AnalyticsSettings notice />
    <section className="wake-comic-hero" aria-label={t("출발 전 잠깨우기 안내")}>
      <div className="wake-comic-top">
        <div className="wake-bolt-sticker" aria-hidden="true">
          <WakeMascot />
        </div>
        <span className="wake-comic-kicker">{t("잠깨우기 준비 완료!")}</span>
        <button className="wake-sound-pill" data-analytics-action="toggle_sound" onClick={onSoundToggle} aria-label={t("경보음과 음성 안내 {0}", soundEnabled ? t("끄기") : t("켜기"))} aria-pressed={soundEnabled}><WakeIcon name={soundEnabled ? "sound" : "mute"} /> {t("알림")}{soundEnabled ? "ON" : "OFF"}</button>
      </div>
      <h1>{t("눈 감지 마!!")}<br /><em>{t("졸음 신호엔")}</em><br />{t("깨우기 영상 출동!")}</h1>
      <div className="wake-sound-bubble">
        <span className="wake-megaphone" aria-hidden="true"><WakeIcon name="sound" /></span>
        <p>{language === "en" ? "Warning style" : playbackMode === "RANDOM_OWNED" ? t("랜덤 재생 준비") : t("현재 준비한 영상")}<strong>{language === "en" ? englishWarningMode === "VIDEO" ? ownedCount ? playbackMode === "RANDOM_OWNED" ? "English videos · random" : t(englishApplied!.name) : "English videos" : "Popup + alert sound" : playbackMode === "RANDOM_OWNED" ? t("보유 영상 {0}편", ownedCount) : getWakeUpVideoProfile(library.appliedId).name}</strong></p>
        <span className={`wake-sound-bars ${soundEnabled ? "" : "is-muted"}`} aria-hidden="true"><i /><i /><i /><i /><i /></span>
      </div>
    </section>
    <div className="wake-motion-tools"><span>{t("출발 전에 영상과 소리를 확인해요.")}</span><button data-analytics-action="toggle_motion" onClick={() => setMotionPaused(value => !value)} aria-pressed={motionPaused}>{motionPaused ? t("▶ 효과 재생") : t("Ⅱ 효과 멈춤")}</button></div>
    <div className="pop-dock"><button disabled={busy} onClick={onStart}><WakeIcon name="camera" /> {t("졸음 감지 시작")}<WakeIcon name="arrow" /></button></div>
    {catalog.length > 0 && <header className="pop-intro">
      <span className="pop-intro-spark" aria-hidden="true"><WakeIcon name="library" /></span>
      <span className="pop-kicker">WAKE-UP COLLECTION <b>{catalog.length}{t("편")}</b></span>
      <h2>{t("나를 깨우는") + " "}<em>{t("한 편을 골라요.")}</em></h2>
      <p>{t("출발 전, 내 스타일의 졸음 경고 영상을 준비해요.")}</p>
    </header>}
    <p className="pop-playback-summary">{language === "en" ? "Rest stop fairy and Rock Star are included. Select a video and apply it for alerts." : playbackMode === "RANDOM_OWNED" ? t("⇄ 보유 영상 {0}편 랜덤 재생 중", ownedCount) : t("✓ 현재 적용 영상만 · {0}", getWakeUpVideoProfile(library.appliedId).name)}</p>
    {catalog.length > 0 && <nav className="pop-filters" aria-label={t("영상 필터")}>
      <button data-analytics-action="filter_all" onClick={() => changeFilter("ALL")} aria-pressed={filter === "ALL"}>{t("전체 영상")}<span>{catalog.length}</span></button>
      <button data-analytics-action="filter_owned" onClick={() => changeFilter("OWNED")} aria-pressed={filter === "OWNED"}>{t("내 보관함")}<span>{ownedCount}</span></button>
    </nav>}
    {catalog.length > 0 && <article ref={featured} data-video-id={selected.id} className="pop-featured" aria-label={t("선택한 경고 영상")}>
      <div key={selected.id} className={`pop-featured-media ${owned ? "" : "is-locked"}`}>
        <VideoPoster id={selected.id} eager />
        <div className="pop-video-shade" />
        <span className="pop-sticker">{applied ? t("✓ 현재 적용 중") : t("지금 선택한 영상")}</span>
        <span className="pop-owned-badge">{owned ? t("사용 가능") : t("🔒 잠김")}</span>
        <button className="pop-play" disabled={busy} onClick={() => openPreview(selected.id)} aria-label={`${t(selected.name)} ${t("미리보기")}`}><WakeIcon name={owned ? "play" : "lock"} /></button>
        <span className="pop-bubble">{t("출발 전에 미리 확인해요.")}</span>
      </div>
      <div className="pop-featured-copy">
        <div><small>MY WAKE-UP PICK</small><h2>{t(selected.name)}</h2><p>{t("졸음 경고 상황에서 재생할 영상")}</p></div>
        <button className="pop-preview" disabled={busy || !owned} onClick={() => openPreview(selected.id)}>{owned ? t("미리보기 ↗") : t("해제 후 미리보기")}</button>
      </div>
      <button className="pop-apply" aria-busy={busy} onClick={onApply} disabled={busy || applied}>
        {busy ? t("영상 준비 중…") : applied ? t("✓ 이 영상으로 설정됐어요") : t("이 영상으로 설정하기")}
      </button>
      <p className="pop-feedback" role="status">{t(feedback) || (language === 'en' ? applied ? `${t(selected.name)} is ready for drowsiness alerts.` : 'Apply this video to use it for alerts.' : playbackMode === "RANDOM_OWNED" ? t("영상을 설정하면 ‘현재 적용 영상만’ 재생하도록 바뀝니다.") : t("현재 경고 영상: {0}", getWakeUpVideoProfile(library.appliedId).name))}</p>
    </article>}
    <section className="pop-controls" aria-label={t("출발 전 알림 설정")}>
      <div className="pop-section-heading"><h2><WakeIcon name="check" /> {t("출발 전, 알림 체크")}</h2><small>{t("기기 내 분석")}</small></div>
      <button className="pop-switch-row" data-analytics-action="toggle_sound" onClick={onSoundToggle} role="switch" aria-checked={soundEnabled}>
        <span className="pop-control-icon"><WakeIcon name={soundEnabled ? "sound" : "mute"} /></span><span><b>{t("경보음과 음성 안내")}</b><small>{t("주의·위험 상태를 소리로 알려요.")}</small></span><span className={`pop-switch ${soundEnabled ? "on" : ""}`} aria-hidden="true"><i /></span>
      </button>
      <button className="pop-voice-test" data-analytics-action="test_voice" onClick={onVoiceTest}>{t("음성 안내 테스트")}<span>↗</span></button>
      {voiceFeedback && <p className="pop-feedback" role="status">{t(voiceFeedback)}</p>}
    </section>
    {catalog.length > 0 && <section className="pop-list" aria-label={filter === "OWNED" ? t("보유 영상 목록") : t("전체 영상 목록")}>
      <div className="pop-section-heading"><h2>{filter === "OWNED" ? t("내 보관함") : t("깨우기 영상 컬렉션")}</h2><small>{profiles.length}{t("편")}</small></div>
      {profiles.map(profile => <article data-video-id={profile.id} className={`pop-video-card ${profile.id === selectedId ? "selected" : ""} ${library.downloadedIds.includes(profile.id) ? "" : "is-locked"}`} key={profile.id}>
        <div className="pop-card-top">
          <button className="pop-thumbnail" disabled={busy} onClick={() => openPreview(profile.id)} aria-label={`${t(profile.name)} ${library.downloadedIds.includes(profile.id) ? t("영상 재생") : t("잠금 안내")}`}>
            <VideoPoster id={profile.id} /><span><WakeIcon name={library.downloadedIds.includes(profile.id) ? "play" : "lock"} /></span>
          </button>
          <div className="pop-card-copy"><small>{(language === 'en' ? englishWarningMode === 'VIDEO' && playbackMode === 'APPLIED' && englishApplied?.id === profile.id : library.appliedId === profile.id && playbackMode === "APPLIED") ? t("✓ 경고 영상으로 적용 중") : t("✓ 사용 가능")}</small><h3>{t(profile.name)}</h3><p>{t("출발 전에 소리와 영상을 확인하세요.")}</p></div>
        </div>
        <div className="pop-card-actions">
          <button disabled={busy} onClick={() => openPreview(profile.id)}>{t("▶ 미리보기")}</button>
          <button disabled={busy} onClick={() => selectVideo(profile.id)} aria-pressed={profile.id === selectedId}>{profile.id === selectedId ? t("✓ 선택됨") : t("이 영상 선택")}</button>
        </div>
      </article>)}
    </section>}
    <aside className="pop-footnote">{t("카메라 영상은 기기 안에서 분석해요.")}<br />{t("영상 선택과 설정은 출발 전에 마쳐 주세요.")}</aside>
    {previewId && <dialog ref={dialog} className="pop-preview-dialog" aria-labelledby="pop-preview-title" onCancel={event => { event.preventDefault(); closePreview(); }} onClose={() => setPreviewId(null)} onClick={event => { if (event.target === dialog.current) closePreview(); }}>
      <header><div><small>PREVIEW</small><h2 id="pop-preview-title">{t(getWakeUpVideoProfile(previewId).name)}</h2></div><button autoFocus onClick={closePreview} aria-label={t("미리보기 닫기")}>×</button></header>
      <video key={previewId} src={getWakeUpVideoProfile(previewId).path} controls autoPlay playsInline onPlaying={() => previewMetrics.current.playing()} onTimeUpdate={event=>{const v=event.currentTarget;previewMetrics.current.tick(v.currentTime,v.duration,performance.now(),v.paused);}} onEnded={event => previewMetrics.current.complete(event.currentTarget.currentTime)} onError={() => { previewMetrics.current.fail(); setPreviewError(true); }} />
      {previewError && <p role="alert">{t("영상을 재생하지 못했습니다. 잠시 후 다시 시도해 주세요.")}</p>}
      <p>{t("미리보기는 적용 중인 경고 영상을 변경하지 않습니다.")}</p>
    </dialog>}
  </section>;
}

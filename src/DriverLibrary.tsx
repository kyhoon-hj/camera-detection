import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VideoPoster } from "./VideoPoster";
import { APP } from "./appProfile";
import { AnalyticsSettings } from "./AnalyticsSettings";
import { analyticsEvent, getAnalyticsStatus, subscribeAnalytics } from "./analytics";
import { VideoMetrics } from "./analyticsCore";
import type { WakeUpPlaybackMode } from "./wakeUpPlayback";
import { getWakeUpVideoProfile, WAKE_UP_VIDEO_PROFILES, type WakeUpLibraryState, type WakeUpVideoId } from "./wakeUpVideos";

interface Props {
  library: WakeUpLibraryState;
  playbackMode: WakeUpPlaybackMode;
  selectedId: WakeUpVideoId;
  busy: boolean;
  feedback: string;
  voiceFeedback: string;
  soundEnabled: boolean;
  onSelect(id: WakeUpVideoId): void;
  onApply(): void;
  onUnlock(id: WakeUpVideoId): void;
  onStart(): void;
  onSoundToggle(): void;
  onVoiceTest(): void;
}

export function DriverLibrary({ library, playbackMode, selectedId, busy, feedback, voiceFeedback, soundEnabled, onSelect, onApply, onUnlock, onStart, onSoundToggle, onVoiceTest }: Props) {
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
  },[analyticsStatus.enabled,filter,previewId,library.downloadedIds,selectedId]);
  const featured = useRef<HTMLElement>(null);
  const selected = getWakeUpVideoProfile(selectedId);
  const owned = library.downloadedIds.includes(selectedId);
  const applied = library.appliedId === selectedId && playbackMode === "APPLIED";
  const profiles = WAKE_UP_VIDEO_PROFILES.filter(item => filter === "ALL" || library.downloadedIds.includes(item.id));
  const selectVideo = (id: WakeUpVideoId) => { if (busy) return; analyticsEvent("video_select",{video_id:id}); onSelect(id); featured.current?.scrollIntoView({ behavior: "auto", block: "start" }); };
  const openPreview = (id: WakeUpVideoId) => {
    if (busy) return;
    if (!library.downloadedIds.includes(id)) { selectVideo(id); return; }
    setPreviewError(false); setPreviewId(id);
    previewMetrics.current.begin(id,"preview");
    analyticsEvent("ui_click",{action:"video_preview",video_id:id});
  };
  useEffect(() => { if (previewId) dialog.current?.showModal(); }, [previewId]);
  const closePreview = () => { previewMetrics.current.exit(); dialog.current?.close(); setPreviewId(null); };
  const changeFilter=(value:"ALL"|"OWNED")=>{if(value!==filter) analyticsEvent("library_filter",{filter:value});setFilter(value);};
  return <section ref={libraryElement} className={`pop-library ${motionPaused || previewId ? "motion-paused" : ""}`} aria-label={`${APP.name} 영상 보관함`}>
    <AnalyticsSettings notice />
    <section className="wake-comic-hero" aria-label="출발 전 잠깨우기 안내">
      <span className="wake-comic-watermark" aria-hidden="true">BAM!!</span>
      <div className="wake-comic-top">
        <div className="wake-bolt-sticker" aria-hidden="true">
          <svg viewBox="0 0 48 48"><path d="M27 4 9 27h13l-2 17 19-25H26l1-15Z" /></svg><b>BAM!</b>
        </div>
        <span className="wake-comic-kicker">💥 잠깨우기 준비 완료!</span>
        <button className="wake-sound-pill" data-analytics-action="toggle_sound" onClick={onSoundToggle} aria-label={`경보음과 음성 안내 ${soundEnabled ? "끄기" : "켜기"}`} aria-pressed={soundEnabled}><span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span> 알림 {soundEnabled ? "ON" : "OFF"}</button>
      </div>
      <h1>눈 감지 마!!<br /><em>졸음 신호엔</em><br />깨우기 영상 출동!</h1>
      <div className="wake-sound-bubble">
        <span className="wake-megaphone" aria-hidden="true">📢</span>
        <p>{playbackMode === "RANDOM_OWNED" ? "랜덤 재생 준비" : "현재 준비한 영상"}<strong>{playbackMode === "RANDOM_OWNED" ? `보유 영상 ${library.downloadedIds.length}편` : getWakeUpVideoProfile(library.appliedId).name}</strong></p>
        <span className={`wake-sound-bars ${soundEnabled ? "" : "is-muted"}`} aria-hidden="true"><i /><i /><i /><i /><i /></span>
      </div>
    </section>
    <div className="wake-motion-tools"><span>출발 전에 영상과 소리를 확인해요.</span><button data-analytics-action="toggle_motion" onClick={() => setMotionPaused(value => !value)} aria-pressed={motionPaused}>{motionPaused ? "▶ 효과 재생" : "Ⅱ 효과 멈춤"}</button></div>
    <div className="pop-dock"><button disabled={busy} onClick={onStart}><span>◎</span> 졸음 감지 시작 <span>→</span></button></div>
    <header className="pop-intro">
      <span className="pop-intro-spark" aria-hidden="true">✦</span>
      <span className="pop-kicker">WAKE-UP COLLECTION <b>{WAKE_UP_VIDEO_PROFILES.length}편</b></span>
      <h2>나를 깨우는 <em>한 편을 골라요.</em></h2>
      <p>출발 전, 내 스타일의 졸음 경고 영상을 준비해요.</p>
    </header>
    <p className="pop-playback-summary">{playbackMode === "RANDOM_OWNED" ? `⇄ 보유 영상 ${library.downloadedIds.length}편 랜덤 재생 중` : `✓ 현재 적용 영상만 · ${getWakeUpVideoProfile(library.appliedId).name}`}</p>
    <nav className="pop-filters" aria-label="영상 필터">
      <button data-analytics-action="filter_all" onClick={() => changeFilter("ALL")} aria-pressed={filter === "ALL"}>전체 영상 <span>{WAKE_UP_VIDEO_PROFILES.length}</span></button>
      <button data-analytics-action="filter_owned" onClick={() => changeFilter("OWNED")} aria-pressed={filter === "OWNED"}>내 보관함 <span>{library.downloadedIds.length}</span></button>
    </nav>
    <article ref={featured} data-video-id={selectedId} className="pop-featured" aria-label="선택한 경고 영상">
      <div key={selectedId} className={`pop-featured-media ${owned ? "" : "is-locked"}`}>
        <VideoPoster id={selectedId} eager />
        <div className="pop-video-shade" />
        <span className="pop-sticker">{applied ? "✓ 현재 적용 중" : "지금 선택한 영상"}</span>
        <span className="pop-owned-badge">{owned ? "잠금 해제됨" : "🔒 잠김"}</span>
        <button className="pop-play" disabled={busy} onClick={() => owned ? openPreview(selected.id) : onUnlock(selected.id)} aria-label={`${selected.name} ${owned ? "미리보기" : "광고 보고 잠금 해제"}`}>{owned ? "▶" : "🔒"}</button>
        <span className="pop-bubble">{owned ? "출발 전에 미리 확인해요." : "광고를 끝까지 보면 열려요."}</span>
      </div>
      <div className="pop-featured-copy">
        <div><small>MY WAKE-UP PICK</small><h2>{selected.name}</h2><p>졸음 경고 상황에서 재생할 영상</p></div>
        <button className="pop-preview" disabled={busy || !owned} onClick={() => openPreview(selected.id)}>{owned ? "미리보기 ↗" : "해제 후 미리보기"}</button>
      </div>
      <button className="pop-apply" aria-busy={busy} onClick={() => owned ? onApply() : onUnlock(selected.id)} disabled={busy || applied}>
        {busy ? "광고 확인·영상 준비 중…" : applied ? "✓ 이 영상으로 설정됐어요" : owned ? "이 영상으로 설정하기" : "🔒 광고 보고 잠금 해제"}
      </button>
      <p className="pop-feedback" role="status">{feedback || (playbackMode === "RANDOM_OWNED" ? "영상을 설정하면 ‘현재 적용 영상만’ 재생하도록 바뀝니다." : `현재 경고 영상: ${getWakeUpVideoProfile(library.appliedId).name}`)}</p>
    </article>
    <section className="pop-controls" aria-label="출발 전 알림 설정">
      <div className="pop-section-heading"><h2><span>✦</span> 출발 전, 알림 체크</h2><small>기기 내 분석</small></div>
      <button className="pop-switch-row" data-analytics-action="toggle_sound" onClick={onSoundToggle} role="switch" aria-checked={soundEnabled}>
        <span className="pop-control-icon">♫</span><span><b>경보음과 음성 안내</b><small>주의·위험 상태를 소리로 알려요.</small></span><span className={`pop-switch ${soundEnabled ? "on" : ""}`} aria-hidden="true"><i /></span>
      </button>
      <button className="pop-voice-test" data-analytics-action="test_voice" onClick={onVoiceTest}>음성 안내 테스트 <span>↗</span></button>
      {voiceFeedback && <p className="pop-feedback" role="status">{voiceFeedback}</p>}
    </section>
    <section className="pop-list" aria-label={filter === "OWNED" ? "보유 영상 목록" : "전체 영상 목록"}>
      <div className="pop-section-heading"><h2>{filter === "OWNED" ? "내 보관함" : "깨우기 영상 컬렉션"}</h2><small>{profiles.length}편</small></div>
      {profiles.map(profile => <article data-video-id={profile.id} className={`pop-video-card ${profile.id === selectedId ? "selected" : ""} ${library.downloadedIds.includes(profile.id) ? "" : "is-locked"}`} key={profile.id}>
        <div className="pop-card-top">
          <button className="pop-thumbnail" disabled={busy} onClick={() => openPreview(profile.id)} aria-label={`${profile.name} ${library.downloadedIds.includes(profile.id) ? "영상 재생" : "잠금 안내"}`}>
            <VideoPoster id={profile.id} /><span>{library.downloadedIds.includes(profile.id) ? "▶" : "🔒"}</span>
          </button>
          <div className="pop-card-copy"><small>{library.appliedId === profile.id && playbackMode === "APPLIED" ? "✓ 경고 영상으로 적용 중" : library.downloadedIds.includes(profile.id) ? "✓ 잠금 해제됨" : "🔒 잠긴 영상"}</small><h3>{profile.name}</h3><p>{library.downloadedIds.includes(profile.id) ? "출발 전에 소리와 영상을 확인하세요." : "광고 시청 완료 후 보관함에 추가돼요."}</p></div>
        </div>
        <div className="pop-card-actions">
          {library.downloadedIds.includes(profile.id) ? <button disabled={busy} onClick={() => openPreview(profile.id)}>▶ 미리보기</button> : <button className="pop-unlock" disabled={busy} onClick={() => { selectVideo(profile.id); onUnlock(profile.id); }}>🔒 광고 보고 잠금 해제</button>}
          <button disabled={busy} onClick={() => selectVideo(profile.id)} aria-pressed={profile.id === selectedId}>{profile.id === selectedId ? "✓ 선택됨" : "이 영상 선택"}</button>
        </div>
      </article>)}
    </section>
    <aside className="pop-footnote">카메라 영상은 기기 안에서 분석해요.<br />영상 선택과 설정은 출발 전에 마쳐 주세요.</aside>
    {previewId && <dialog ref={dialog} className="pop-preview-dialog" aria-labelledby="pop-preview-title" onCancel={event => { event.preventDefault(); closePreview(); }} onClose={() => setPreviewId(null)} onClick={event => { if (event.target === dialog.current) closePreview(); }}>
      <header><div><small>PREVIEW</small><h2 id="pop-preview-title">{getWakeUpVideoProfile(previewId).name}</h2></div><button autoFocus onClick={closePreview} aria-label="미리보기 닫기">×</button></header>
      <video key={previewId} src={getWakeUpVideoProfile(previewId).path} controls autoPlay playsInline onPlaying={() => previewMetrics.current.playing()} onTimeUpdate={event=>{const v=event.currentTarget;previewMetrics.current.tick(v.currentTime,v.duration,performance.now(),v.paused);}} onEnded={event => previewMetrics.current.complete(event.currentTarget.currentTime)} onError={() => { previewMetrics.current.fail(); setPreviewError(true); }} />
      {previewError && <p role="alert">영상을 재생하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}
      <p>미리보기는 적용 중인 경고 영상을 변경하지 않습니다.</p>
    </dialog>}
  </section>;
}

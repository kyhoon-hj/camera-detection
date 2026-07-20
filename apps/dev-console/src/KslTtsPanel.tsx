import { useCallback, useEffect, useRef, useState } from "react";
import { playKoreanTts, type TtsPlayback, type VoicePreference } from "./kslTts";

const API = "http://127.0.0.1:8200";
type Candidate = {candidateId:string; text:string; confidence:number; rank:number};
type Translation = {translationId:string; status:string; confidence:number; glossSequence:string[]; candidates:Candidate[]; domain:string; domainRisk:string; safetyNotice?:string|null; confirmation?:{selectedText?:string|null;feedbackId?:string;improvementDataStored?:boolean}|null};
type Settings = {voicePreference:VoicePreference; rate:number; autoPlay:boolean; confirmBeforePlayback:boolean};
type Domain = {code:string; koreanName:string; risk:string; termCount:number};
type Feedback = {feedbackId:string; correctedText:string; reason:string; status:string; trainingEligible:boolean};
type OfflineMode="OFFLINE_ONLY"|"AUTO"|"ONLINE_ALLOWED";
type OfflineSettings={mode:OfflineMode;allowOnlineEnhancement:boolean;effectiveMode:string;networkRequired:boolean};
type OfflineCapabilities={offlineReady:boolean;packageVersion:string;emergencyExpressionCount:number;basicSentenceCount:number};

const CORRECTION_REASONS = [
  ["HANDSHAPE_MISRECOGNITION","손 모양 오인식"],
  ["WORD_ORDER","문장 순서 오류"],
  ["NON_MANUAL_MISSING","표정 의미 누락"],
  ["WORD_MISSING","단어 누락"],
  ["CONTEXT_ERROR","문맥 오류"],
  ["DIFFERENT_EXPRESSION","다른 표현"],
  ["OTHER","기타"],
] as const;

const DEFAULT_SETTINGS:Settings = {voicePreference:"SYSTEM_KOREAN", rate:1, autoPlay:false, confirmBeforePlayback:true};

export function KslTtsPanel({sessionId}:{sessionId:string}) {
  const [translation, setTranslation] = useState<Translation|null>(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [domain, setDomain] = useState("general");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [offlineSettings,setOfflineSettings]=useState<OfflineSettings>({mode:"OFFLINE_ONLY",allowOnlineEnhancement:false,effectiveMode:"OFFLINE",networkRequired:false});
  const [offlineCapabilities,setOfflineCapabilities]=useState<OfflineCapabilities|null>(null);
  const [editing, setEditing] = useState(false);
  const [correctedText, setCorrectedText] = useState("");
  const [correctionReason, setCorrectionReason] = useState("WORD_ORDER");
  const [consentToImprove, setConsentToImprove] = useState(false);
  const [consentId, setConsentId] = useState("");
  const [message, setMessage] = useState("수어 문장이 생성되면 기기 내 한국어 음성으로 전달할 수 있습니다.");
  const sequenceSignature = useRef("");
  const autoPlayed = useRef("");

  const requestPlayback = useCallback(async (mode:"AUTO"|"MANUAL", replay = false) => {
    const response = await fetch(`${API}/v1/sign/tts/${sessionId}/${replay ? "replay" : "play"}`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:replay ? undefined : JSON.stringify({mode}),
    });
    const payload = await response.json() as TtsPlayback & {error?:{message?:string}};
    if (!response.ok) throw new Error(payload.error?.message || "음성 재생을 준비하지 못했습니다.");
    if (!("speechSynthesis" in window)) throw new Error("이 브라우저는 음성 출력을 지원하지 않습니다.");
    playKoreanTts(
      {
        cancel:()=>window.speechSynthesis.cancel(),
        speak:utterance=>window.speechSynthesis.speak(utterance as SpeechSynthesisUtterance),
        getVoices:()=>window.speechSynthesis.getVoices(),
      },
      payload,
      text=>new SpeechSynthesisUtterance(text),
    );
    setMessage(replay ? `다시 듣기 · ${payload.text}` : `음성으로 전달 · ${payload.text}`);
  }, [sessionId]);

  const refreshFeedback = useCallback(async () => {
    const response = await fetch(`${API}/v1/sign/feedback?sessionId=${encodeURIComponent(sessionId)}`);
    if (response.ok) setFeedback((await response.json() as {items:Feedback[]}).items);
  }, [sessionId]);

  const poll = useCallback(async () => {
    const sequenceResponse = await fetch(`${API}/v1/sign/sequences/${sessionId}`);
    if (!sequenceResponse.ok) return;
    const sequence = await sequenceResponse.json() as {tokenCount:number; tokens:Array<{segmentId?:string}>};
    const signature = sequence.tokens.map(token=>token.segmentId || "").join("|");
    if (sequence.tokenCount && signature !== sequenceSignature.current) {
      sequenceSignature.current = signature;
      const translated = await fetch(`${API}/v1/sign/translations/${sessionId}`, {method:"POST"});
      if (translated.ok) setTranslation(await translated.json() as Translation);
      return;
    }
    const latest = await fetch(`${API}/v1/sign/translations/${sessionId}`);
    if (latest.ok) setTranslation(await latest.json() as Translation);
  }, [sessionId]);

  useEffect(() => {
    sequenceSignature.current = "";
    autoPlayed.current = "";
    setTranslation(null);
    void fetch(`${API}/v1/sign/tts/${sessionId}/settings`).then(async response => {
      if (response.ok) setSettings(await response.json() as Settings);
    });
    void fetch(`${API}/v1/sign/professional-domains`).then(async response => {
      if (response.ok) setDomains((await response.json() as {items:Domain[]}).items);
    });
    void fetch(`${API}/v1/sign/translations/${sessionId}/domain`).then(async response => {
      if (response.ok) setDomain((await response.json() as {domain:string}).domain);
    });
    void fetch(`${API}/v1/sign/offline/capabilities`).then(async response=>{if(response.ok)setOfflineCapabilities(await response.json() as OfflineCapabilities);});
    void fetch(`${API}/v1/sign/offline/${sessionId}/settings`).then(async response=>{if(response.ok)setOfflineSettings(await response.json() as OfflineSettings);});
    void refreshFeedback();
    void poll();
    const timer = window.setInterval(()=>void poll(), 1000);
    return () => window.clearInterval(timer);
  }, [poll, refreshFeedback, sessionId]);

  useEffect(() => {
    const confirmed = translation?.status === "CONFIRMED" || translation?.status === "CORRECTED";
    const playbackAllowed = !settings.confirmBeforePlayback || confirmed;
    if (!settings.autoPlay || !playbackAllowed || !translation || autoPlayed.current === translation.translationId) return;
    autoPlayed.current = translation.translationId;
    void requestPlayback("AUTO").catch(error=>setMessage(error instanceof Error ? error.message : "자동 재생에 실패했습니다."));
  }, [requestPlayback, settings.autoPlay, settings.confirmBeforePlayback, translation]);

  async function updateSettings(next:Settings) {
    setSettings(next);
    const response = await fetch(`${API}/v1/sign/tts/${sessionId}/settings`, {
      method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(next),
    });
    if (!response.ok) setMessage("TTS 설정을 저장하지 못했습니다.");
  }

  async function changeDomain(next:string) {
    const response = await fetch(`${API}/v1/sign/translations/${sessionId}/domain`, {
      method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({domain:next}),
    });
    if (!response.ok) { setMessage("전문 분야를 변경하지 못했습니다."); return; }
    setDomain(next);
    setTranslation(null);
    sequenceSignature.current="";
    autoPlayed.current="";
    setMessage("전문 분야를 변경했습니다. 다음 후보부터 우선순위를 적용합니다.");
  }

  async function changeOfflineMode(mode:OfflineMode) {
    const next={mode,allowOnlineEnhancement:mode==="ONLINE_ALLOWED"};
    const response=await fetch(`${API}/v1/sign/offline/${sessionId}/settings`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)});
    if (!response.ok) {setMessage("오프라인 설정을 저장하지 못했습니다.");return;}
    setOfflineSettings(await response.json() as OfflineSettings);
    setMessage(mode==="OFFLINE_ONLY"?"오프라인 전용 모드입니다. 네트워크를 사용하지 않습니다.":"온라인 확장은 허용했지만 현재 번역은 로컬에서 처리됩니다.");
  }

  async function confirm(candidateId:string) {
    const response = await fetch(`${API}/v1/sign/translations/${sessionId}/confirm`, {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"CONFIRM", candidateId}),
    });
    if (!response.ok) { setMessage("문장 후보를 확정하지 못했습니다."); return; }
    const confirmed = await response.json() as Translation;
    setTranslation(confirmed);
    const selectedText = confirmed.confirmation?.selectedText;
    if (selectedText) {
      await fetch(`${API}/v1/sign/conversations/${sessionId}/messages`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          speaker:"KSL_USER",
          text:selectedText,
          source:"KSL_TRANSLATION",
          confidence:confirmed.confidence,
          clientMessageId:confirmed.translationId,
        }),
      });
    }
    setMessage("문장을 확정했습니다. 음성으로 전달할 수 있습니다.");
  }

  function beginCorrection() {
    setCorrectedText(translation?.confirmation?.selectedText || translation?.candidates[0]?.text || "");
    setEditing(true);
  }

  async function submitCorrection() {
    if (!correctedText.trim()) { setMessage("올바른 문장을 입력해 주세요."); return; }
    if (consentToImprove&&!consentId.trim()) { setMessage("개선 데이터 저장 동의 ID가 필요합니다."); return; }
    const response = await fetch(`${API}/v1/sign/translations/${sessionId}/confirm`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"CORRECT",
        correctedText,
        reason:correctionReason,
        consentToImprove,
        consentId:consentToImprove?consentId:undefined,
      }),
    });
    const payload = await response.json() as Translation & {error?:{message?:string}};
    if (!response.ok) { setMessage(payload.error?.message||"문장을 수정하지 못했습니다."); return; }
    setTranslation(payload);
    setEditing(false);
    const selectedText=payload.confirmation?.selectedText;
    if (selectedText) {
      await fetch(`${API}/v1/sign/conversations/${sessionId}/messages`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          speaker:"KSL_USER",text:selectedText,source:"KSL_TRANSLATION",confidence:payload.confidence,
          clientMessageId:`${payload.translationId}-correction-${payload.confirmation?.feedbackId||Date.now()}`,
        }),
      });
    }
    await refreshFeedback();
    setMessage(payload.confirmation?.improvementDataStored?"문장을 수정하고 동의된 개선 큐에 저장했습니다.":"문장을 수정했습니다. 개선 데이터는 저장하지 않았습니다.");
  }

  async function deleteFeedback(feedbackId?:string) {
    const path=feedbackId?`/v1/sign/feedback/${feedbackId}`:"/v1/sign/feedback";
    const response=await fetch(`${API}${path}?sessionId=${encodeURIComponent(sessionId)}`,{method:"DELETE"});
    if (response.ok) { await refreshFeedback(); setMessage(feedbackId?"개선 데이터 한 건을 삭제했습니다.":"내 개선 데이터를 모두 삭제했습니다."); }
  }

  return <section className="panel ksl-tts-panel">
    <div className="panel-title"><span>KSL → KOREAN → DEVICE TTS</span><small>{translation?.status ?? "WAITING"}</small></div>
    <div className="ksl-tts-body">
      <div className="ksl-translation">
        <small>{translation?.glossSequence.length ? translation.glossSequence.join(" / ") : "인식된 Gloss 대기 중"}</small>
        <strong>{translation?.confirmation?.selectedText || translation?.candidates[0]?.text || "번역 문장이 아직 없습니다."}</strong>
        <span>{translation ? `평균 신뢰도 ${Math.round(translation.confidence*100)}%` : message}</span>
        {translation?.safetyNotice&&<em className="ksl-safety-notice">{translation.safetyNotice}</em>}
        {translation?.candidates.map(candidate=><button key={candidate.candidateId} onClick={()=>void confirm(candidate.candidateId)}>{candidate.rank}. {candidate.text} · {Math.round(candidate.confidence*100)}%</button>)}
        {translation&&<button className="correction-toggle" onClick={beginCorrection}>문장 수정</button>}
        {editing&&<div className="correction-form"><label>올바른 문장<textarea value={correctedText} onChange={event=>setCorrectedText(event.target.value)}/></label><label>수정 사유<select value={correctionReason} onChange={event=>setCorrectionReason(event.target.value)}>{CORRECTION_REASONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="ksl-check"><input type="checkbox" checked={consentToImprove} onChange={event=>setConsentToImprove(event.target.checked)}/> 이 수정문을 개선 데이터로 저장하는 데 동의</label>{consentToImprove&&<label>동의 ID<input value={consentId} onChange={event=>setConsentId(event.target.value)} placeholder="명시적 동의 참조 ID"/></label>}<div><button onClick={()=>void submitCorrection()}>수정 적용</button><button onClick={()=>setEditing(false)}>취소</button></div></div>}
      </div>
      <div className="ksl-tts-settings">
        <label>연결 모드<select value={offlineSettings.mode} onChange={event=>void changeOfflineMode(event.target.value as OfflineMode)}><option value="OFFLINE_ONLY">오프라인 전용</option><option value="AUTO">자동(로컬 우선)</option><option value="ONLINE_ALLOWED">온라인 확장 허용</option></select></label>
        <em className="offline-badge">● {offlineSettings.effectiveMode} · 패키지 v{offlineCapabilities?.packageVersion??"—"} · 긴급 {offlineCapabilities?.emergencyExpressionCount??0} / 기본 {offlineCapabilities?.basicSentenceCount??0}</em>
        <label>전문 분야<select value={domain} onChange={event=>void changeDomain(event.target.value)}>{domains.map(item=><option key={item.code} value={item.code}>{item.koreanName}{item.termCount?` · ${item.termCount}개`:""}</option>)}</select></label>
        <label>한국어 음성<select value={settings.voicePreference} onChange={event=>void updateSettings({...settings,voicePreference:event.target.value as VoicePreference})}><option value="SYSTEM_KOREAN">시스템 기본</option><option value="FEMALE_PREFERRED">여성 음성 우선</option><option value="MALE_PREFERRED">남성 음성 우선</option></select></label>
        <label>속도 {settings.rate.toFixed(1)}×<input type="range" min="0.5" max="2" step="0.1" value={settings.rate} onChange={event=>void updateSettings({...settings,rate:Number(event.target.value)})}/></label>
        <label className="ksl-check"><input type="checkbox" checked={settings.autoPlay} onChange={event=>void updateSettings({...settings,autoPlay:event.target.checked})}/> 확정 후 자동 재생</label>
        <label className="ksl-check"><input type="checkbox" checked={settings.confirmBeforePlayback} onChange={event=>void updateSettings({...settings,confirmBeforePlayback:event.target.checked})}/> 자동 재생 전 사용자 확인</label>
      </div>
      <div className="ksl-tts-actions"><button disabled={!translation?.candidates.length} onClick={()=>void requestPlayback("MANUAL").catch(error=>setMessage(error.message))}>음성으로 전달</button><button disabled={!translation} onClick={()=>void requestPlayback("MANUAL",true).catch(error=>setMessage(error.message))}>다시 듣기</button><small>{message}</small></div>
      {feedback.length>0&&<div className="feedback-queue"><div><strong>내 동의 개선 데이터</strong><button onClick={()=>void deleteFeedback()}>전체 삭제</button></div>{feedback.map(item=><article key={item.feedbackId}><span>{item.correctedText}</span><small>{item.reason} · {item.status} · 학습 사용 {item.trainingEligible?"가능":"차단"}</small><button onClick={()=>void deleteFeedback(item.feedbackId)}>삭제</button></article>)}</div>}
    </div>
  </section>;
}

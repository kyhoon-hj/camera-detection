import { useCallback, useEffect, useRef, useState } from "react";
import { parseSpeechResults, speakerLabel, type SpeechResultsEventLike } from "./conversation";
import { microphonePermissionError, speechRecognitionGuidance } from "./microphone";

const API = "http://127.0.0.1:8200";
type Message = {messageId:string; speaker:"HEARING_USER"|"KSL_USER"; text:string; source:string; timestamp:string; confidence?:number|null};
type Recognition = {
  lang:string;
  interimResults:boolean;
  continuous:boolean;
  start:()=>void;
  stop?:()=>void;
  abort?:()=>void;
  onresult:((event:SpeechResultsEventLike)=>void)|null;
  onerror:((event:{error:string})=>void)|null;
  onend:(()=>void)|null;
};
type RecognitionConstructor = new()=>Recognition;

export function ConversationPanel({sessionId}:{sessionId:string}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState("마이크 버튼을 누르면 상대방의 한국어 음성을 큰 글씨로 표시합니다.");
  const recognition = useRef<Recognition|null>(null);
  const keepListening = useRef(false);
  const endAnchor = useRef<HTMLDivElement|null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`${API}/v1/sign/conversations/${sessionId}`);
    if (response.ok) setMessages((await response.json() as {messages:Message[]}).messages);
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(()=>void refresh(), 1200);
    return () => { window.clearInterval(timer); keepListening.current=false; recognition.current?.abort?.(); };
  }, [refresh]);

  useEffect(() => endAnchor.current?.scrollIntoView({behavior:"smooth"}), [messages, interim]);

  async function saveTranscript(text:string, confidence?:number) {
    const response = await fetch(`${API}/v1/sign/conversations/${sessionId}/messages`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        speaker:"HEARING_USER",
        text,
        source:"STT",
        confidence:Number.isFinite(confidence) ? confidence : undefined,
        clientMessageId:`stt-${Date.now()}-${crypto.randomUUID?.() || Math.random()}`,
      }),
    });
    if (response.ok) {
      setInterim("");
      await refresh();
    }
  }

  async function startListening() {
    const speechWindow = window as typeof window & {SpeechRecognition?:RecognitionConstructor;webkitSpeechRecognition?:RecognitionConstructor};
    const Constructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Constructor) { setNotice("이 브라우저는 한국어 음성 인식을 지원하지 않습니다."); return; }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("마이크 입력을 지원하지 않습니다.");
      const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      stream.getTracks().forEach(track=>track.stop());
    } catch (error) {
      setNotice(microphonePermissionError(error).message);
      return;
    }
    const instance = recognition.current ?? new Constructor();
    recognition.current = instance;
    instance.lang="ko-KR";
    instance.interimResults=true;
    instance.continuous=true;
    instance.onresult=event=>{
      const parsed = parseSpeechResults(event);
      setInterim(parsed.interim);
      for (const item of parsed.finals) void saveTranscript(item.text,item.confidence);
    };
    instance.onerror=event=>{
      const guidance=speechRecognitionGuidance(event.error);
      setNotice(guidance.message);
      if (guidance.permissionProblem) { keepListening.current=false; setListening(false); }
    };
    instance.onend=()=>{
      if (keepListening.current) window.setTimeout(()=>{ try { instance.start(); } catch { setListening(false); } },250);
      else setListening(false);
    };
    keepListening.current=true;
    setListening(true);
    setNotice("상대방 음성을 듣고 있습니다. 오디오는 저장하지 않습니다.");
    instance.start();
  }

  function stopListening() {
    keepListening.current=false;
    recognition.current?.stop?.();
    setListening(false);
    setInterim("");
    setNotice("음성 자막을 중지했습니다.");
  }

  async function clearAll() {
    stopListening();
    const response = await fetch(`${API}/v1/sign/conversations/${sessionId}`,{method:"DELETE"});
    if (response.ok) { setMessages([]); setNotice("전체 대화를 삭제했습니다."); }
  }

  const latestCaption = interim || [...messages].reverse().find(message=>message.speaker==="HEARING_USER")?.text || "상대방 음성 대기 중";
  return <section className="panel conversation-panel">
    <div className="panel-title"><span>BIDIRECTIONAL KSL CONVERSATION</span><small>{listening?"STT LISTENING":"LOCAL TEXT SESSION"}</small></div>
    <div className={`live-caption ${listening?"listening":""}`}><small>상대방 음성 · 실시간 자막</small><strong>{latestCaption}</strong><span>{interim?"인식 중…":notice}</span></div>
    <div className="conversation-actions"><button className={listening?"stop":"listen"} onClick={listening?stopListening:()=>void startListening()}>{listening?"음성 자막 중지":"🎙 상대방 음성 듣기"}</button><button onClick={()=>void clearAll()}>전체 대화 삭제</button></div>
    <div className="conversation-log" aria-live="polite">
      {messages.length===0?<p>아직 대화 내용이 없습니다.</p>:messages.map(message=><article key={message.messageId} className={message.speaker==="KSL_USER"?"ksl-user":"hearing-user"}><div><b>{speakerLabel(message.speaker)}</b><time>{new Date(message.timestamp).toLocaleTimeString()}</time></div><strong>{message.text}</strong><small>{message.source}{message.confidence!=null?` · ${Math.round(message.confidence*100)}%`:""}</small></article>)}
      {interim&&<article className="hearing-user interim"><div><b>음성 사용자</b><time>지금</time></div><strong>{interim}</strong><small>STT · 인식 중</small></article>}
      <div ref={endAnchor}/>
    </div>
    <p className="conversation-privacy">브라우저 STT는 Chrome 음성 인식 서비스를 사용할 수 있습니다. 서버는 오디오를 저장하지 않으며 확정된 텍스트만 세션 메모리에 보관합니다.</p>
  </section>;
}

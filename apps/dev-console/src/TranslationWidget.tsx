import { useCallback, useEffect, useState } from "react";
import { DEFAULT_WIDGET_SETTINGS, normalizeWidgetSettings, type WidgetPosition, type WidgetSettings } from "./widgetSettings";

const API="http://127.0.0.1:8200";
const STORAGE_KEY="suha.translation-widget.v1";
type Translation={status:string;glossSequence:string[];candidates:Array<{text:string}>;confirmation?:{selectedText?:string|null}|null;processingMode?:string;offlinePackageVersion?:string};

function loadSettings():WidgetSettings {
  try { return normalizeWidgetSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}") as Partial<WidgetSettings>); }
  catch { return DEFAULT_WIDGET_SETTINGS; }
}

export function TranslationWidget({sessionId}:{sessionId:string}) {
  const [translation,setTranslation]=useState<Translation|null>(null);
  const [settings,setSettings]=useState(loadSettings);
  const [editing,setEditing]=useState(false);

  const refresh=useCallback(async()=>{
    const response=await fetch(`${API}/v1/sign/translations/${sessionId}`);
    if (response.ok) setTranslation(await response.json() as Translation);
  },[sessionId]);
  useEffect(()=>{ void refresh(); const timer=window.setInterval(()=>void refresh(),1000); return()=>window.clearInterval(timer); },[refresh]);

  function update(next:Partial<WidgetSettings>) {
    const normalized=normalizeWidgetSettings({...settings,...next});
    setSettings(normalized); localStorage.setItem(STORAGE_KEY,JSON.stringify(normalized));
  }

  if (!settings.enabled&&!editing) return <button className="widget-enable" onClick={()=>{update({enabled:true});setEditing(true);}}>번역 위젯 켜기</button>;
  const text=translation?.confirmation?.selectedText||translation?.candidates?.[0]?.text||"수어 번역 대기 중";
  return <aside className={`translation-widget ${settings.position.toLowerCase()}`} style={{opacity:settings.opacity}}>
    <div className="translation-widget-head"><span>{translation?.processingMode==="OFFLINE"?"● OFFLINE":"● LOCAL"}{translation?.offlinePackageVersion&&` · v${translation.offlinePackageVersion}`}</span><button aria-label="번역 위젯 설정" onClick={()=>setEditing(value=>!value)}>⚙</button></div>
    {settings.showGloss&&<small>{translation?.glossSequence?.join(" / ")||"GLOSS 대기"}</small>}
    <strong style={{fontSize:settings.fontSize}}>{text}</strong>
    {editing&&<div className="translation-widget-settings">
      <label>위치<select value={settings.position} onChange={event=>update({position:event.target.value as WidgetPosition})}><option value="TOP_LEFT">왼쪽 위</option><option value="TOP_RIGHT">오른쪽 위</option><option value="BOTTOM_LEFT">왼쪽 아래</option><option value="BOTTOM_RIGHT">오른쪽 아래</option></select></label>
      <label>글자 크기 {settings.fontSize}px<input type="range" min="16" max="44" value={settings.fontSize} onChange={event=>update({fontSize:Number(event.target.value)})}/></label>
      <label>투명도 {Math.round(settings.opacity*100)}%<input type="range" min=".55" max="1" step=".05" value={settings.opacity} onChange={event=>update({opacity:Number(event.target.value)})}/></label>
      <label><input type="checkbox" checked={settings.showGloss} onChange={event=>update({showGloss:event.target.checked})}/> Gloss 표시</label>
      <button onClick={()=>{update({enabled:false});setEditing(false);}}>위젯 숨기기</button>
    </div>}
  </aside>;
}

import { useCallback, useEffect, useMemo, useState } from "react";

const API="http://127.0.0.1:8200";
type Scenario={scenarioId:string;category:string;koreanName:string;requiredTags:string[]};
type QaResult={qaResultId:string;scenarioId:string;category:string;source:string;expectedCode:string;observedCandidates:string[];confidence:number;latencyMs:number;variantTags:Record<string,string>;passed:boolean;recordedAt:string};
type Summary={totalResults:number;passedResults:number;humanReviewedResults:number;coveredCategories:string[];missingCategories:string[];emergencyRecall:number|null;emergencyRecallTarget:number;releaseReady:boolean};

export function ProfessionalQaPanel() {
  const [scenarios,setScenarios]=useState<Scenario[]>([]);
  const [results,setResults]=useState<QaResult[]>([]);
  const [summary,setSummary]=useState<Summary|null>(null);
  const [scenarioId,setScenarioId]=useState("dominant-hand-left");
  const [source,setSource]=useState("SYNTHETIC_REGRESSION");
  const [expected,setExpected]=useState("HELP_NEEDED");
  const [observed,setObserved]=useState("HELP_NEEDED");
  const [confidence,setConfidence]=useState(.9);
  const [latency,setLatency]=useState(500);
  const [tags,setTags]=useState<Record<string,string>>({});
  const [expertAccepted,setExpertAccepted]=useState(true);
  const [notes,setNotes]=useState("");
  const [notice,setNotice]=useState("전문 QA 결과를 불러오는 중입니다.");
  const selected=useMemo(()=>scenarios.find(item=>item.scenarioId===scenarioId),[scenarioId,scenarios]);

  const refresh=useCallback(async()=>{
    const [scenarioResponse,resultResponse,summaryResponse]=await Promise.all([
      fetch(`${API}/v1/admin/sign/qa/scenarios`),fetch(`${API}/v1/admin/sign/qa/results`),fetch(`${API}/v1/admin/sign/qa/summary`),
    ]);
    if (!scenarioResponse.ok||!resultResponse.ok||!summaryResponse.ok) {setNotice("QA API 연결에 실패했습니다.");return;}
    const scenarioData=await scenarioResponse.json() as {items:Scenario[]};
    setScenarios(scenarioData.items);
    setResults((await resultResponse.json() as {items:QaResult[]}).items);
    setSummary(await summaryResponse.json() as Summary);
    setNotice("합성 회귀와 실제 사람 검수 결과를 구분해 기록합니다.");
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{if(selected)setTags(Object.fromEntries(selected.requiredTags.map(tag=>[tag,""])));},[selected]);

  async function record() {
    const response=await fetch(`${API}/v1/admin/sign/qa/results`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      scenarioId,source,expectedCode:expected,observedCandidates:observed.split(",").map(value=>value.trim()).filter(Boolean),confidence,latencyMs:latency,variantTags:tags,expertAccepted,notes,
    })});
    if (!response.ok) {setNotice(await response.text());return;}
    const result=await response.json() as QaResult;
    setNotice(result.passed?"QA 통과 결과를 기록했습니다.":"QA 실패 결과를 기록했습니다. 후보 순위·신뢰도·지연·전문가 판정을 확인하세요.");
    setNotes(""); await refresh();
  }
  async function clear() {if(!window.confirm("기록된 QA 결과를 모두 삭제할까요?"))return;await fetch(`${API}/v1/admin/sign/qa/results`,{method:"DELETE"});await refresh();setNotice("QA 결과를 초기화했습니다.");}

  return <section className="panel professional-qa-panel">
    <div className="panel-title"><span>PROFESSIONAL KSL QA MATRIX</span><small>{summary?.releaseReady?"RELEASE READY":"HUMAN EVIDENCE REQUIRED"}</small></div>
    <div className="qa-summary"><div><b>{summary?.coveredCategories.length??0}/7</b><span>사람 검수 범주</span></div><div><b>{summary?.humanReviewedResults??0}</b><span>사람 검수 표본</span></div><div><b>{summary?.emergencyRecall==null?"—":`${Math.round(summary.emergencyRecall*100)}%`}</b><span>긴급 재현율 ≥95%</span></div><p>{notice}</p><button onClick={clear}>결과 초기화</button></div>
    <div className="qa-form">
      <label>시나리오<select value={scenarioId} onChange={event=>setScenarioId(event.target.value)}>{scenarios.map(item=><option key={item.scenarioId} value={item.scenarioId}>{item.koreanName}</option>)}</select></label>
      <label>근거 종류<select value={source} onChange={event=>setSource(event.target.value)}><option value="SYNTHETIC_REGRESSION">합성 회귀</option><option value="HUMAN_REVIEWED_RECORDING">실제 사람·전문가 검수</option></select></label>
      <label>정답 코드<input value={expected} onChange={event=>setExpected(event.target.value)}/></label>
      <label>관측 후보(쉼표 구분)<input value={observed} onChange={event=>setObserved(event.target.value)}/></label>
      <label>신뢰도<input type="number" min="0" max="1" step=".01" value={confidence} onChange={event=>setConfidence(Number(event.target.value))}/></label>
      <label>지연(ms)<input type="number" min="0" max="60000" value={latency} onChange={event=>setLatency(Number(event.target.value))}/></label>
      {selected?.requiredTags.map(tag=><label key={tag}>{tag}<input value={tags[tag]||""} onChange={event=>setTags(current=>({...current,[tag]:event.target.value}))} placeholder={`${tag} 값`}/></label>)}
      <label className="qa-check"><input type="checkbox" checked={expertAccepted} onChange={event=>setExpertAccepted(event.target.checked)}/> 전문가 의미 보존 승인</label>
      <label className="qa-notes">메모<input value={notes} onChange={event=>setNotes(event.target.value)}/></label>
      <button onClick={record}>QA 결과 기록</button>
    </div>
    <p className="qa-policy">자동·합성 결과는 출시 준비 근거로 계산하지 않습니다. 7개 범주 모두 실제 사람 검수 통과 + 긴급 표현 Top 1 재현율 95% 이상이 필요합니다.</p>
    <div className="qa-results">{results.length===0?<p>기록된 QA 결과가 없습니다.</p>:results.slice().reverse().slice(0,12).map(item=><article key={item.qaResultId}><b className={item.passed?"pass":"fail"}>{item.passed?"PASS":"FAIL"}</b><span>{scenarios.find(value=>value.scenarioId===item.scenarioId)?.koreanName||item.category}</span><strong>{item.expectedCode} → {item.observedCandidates.join(", ")||"미인식"}</strong><small>{item.source==="HUMAN_REVIEWED_RECORDING"?"사람 검수":"합성 회귀"} · {Math.round(item.confidence*100)}% · {item.latencyMs}ms</small></article>)}</div>
  </section>;
}

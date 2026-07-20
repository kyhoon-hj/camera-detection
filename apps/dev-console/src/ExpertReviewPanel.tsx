import { useCallback, useEffect, useState } from "react";

const API = "http://127.0.0.1:8200";
type Role = "DEAF_SIGNER"|"KSL_INTERPRETER"|"KSL_EDUCATOR"|"DOMAIN_EXPERT"|"ACCESSIBILITY_UX_EXPERT";
type Review = {reviewId:string;reviewerRole:Role;decision:"APPROVE"|"REJECT";scores:{meaningPreservation:number;koreanNaturalness:number;misrecognitionRisk:number};notes:string;reviewedAt:string};
type Feedback = {feedbackId:string;originalText:string;correctedText:string;reason:string;domain:string;glossSequence:string[];status:string;trainingEligible:boolean;reviewScope?:string;reviews?:Review[];unavailableCriteria?:string[]};
type Summary = {total:number;byStatus:Record<string,number>;trainingEligible:number};

const ROLES:Record<Role,string>={DEAF_SIGNER:"농인 수어 사용자",KSL_INTERPRETER:"한국수어 통역사",KSL_EDUCATOR:"한국수어 교육자",DOMAIN_EXPERT:"분야 전문가",ACCESSIBILITY_UX_EXPERT:"접근성 UX 전문가"};
const STATUS:Record<string,string>={PENDING_REVIEW:"검수 대기",IN_REVIEW:"추가 검수 필요",APPROVED:"승인",REJECTED:"반려"};

export function ExpertReviewPanel() {
  const [items,setItems]=useState<Feedback[]>([]);
  const [summary,setSummary]=useState<Summary|null>(null);
  const [reviewerId,setReviewerId]=useState("");
  const [role,setRole]=useState<Role>("KSL_INTERPRETER");
  const [meaning,setMeaning]=useState(5);
  const [korean,setKorean]=useState(5);
  const [risk,setRisk]=useState(1);
  const [notes,setNotes]=useState("");
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState("검수 대기 데이터를 불러오는 중입니다.");

  const refresh=useCallback(async()=>{
    try {
      const [reviewsResponse,summaryResponse]=await Promise.all([
        fetch(`${API}/v1/admin/sign/reviews`),fetch(`${API}/v1/admin/sign/reviews/summary`),
      ]);
      if (!reviewsResponse.ok||!summaryResponse.ok) throw new Error("검수 API 연결 실패");
      const reviews=await reviewsResponse.json() as {items:Feedback[]};
      setItems(reviews.items);
      setSummary(await summaryResponse.json() as Summary);
      setNotice(reviews.items.length?"검수자 역할과 점수를 확인한 뒤 결정해 주세요.":"현재 검수 대기 데이터가 없습니다.");
    } catch (error) { setNotice(error instanceof Error?error.message:"검수 데이터를 불러오지 못했습니다."); }
  },[]);

  useEffect(()=>{ void refresh(); },[refresh]);

  async function decide(feedbackId:string,decision:"APPROVE"|"REJECT") {
    if (!reviewerId.trim()) { setNotice("검수자 식별명을 입력해 주세요. 서버에는 해시로만 저장됩니다."); return; }
    if (decision==="REJECT"&&!notes.trim()) { setNotice("반려 사유를 입력해 주세요."); return; }
    setBusy(feedbackId);
    const response=await fetch(`${API}/v1/admin/sign/reviews/${feedbackId}`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({reviewerId,reviewerRole:role,decision,meaningPreservation:meaning,koreanNaturalness:korean,misrecognitionRisk:risk,notes}),
    });
    if (response.ok) {
      const result=await response.json() as Feedback;
      setNotice(result.status==="APPROVED"?"다중 역할 승인이 완료되어 학습 후보가 되었습니다.":result.status==="REJECTED"?"반려 처리했습니다.":"1차 승인을 기록했습니다. 다른 역할의 검수가 필요합니다.");
      setNotes(""); await refresh();
    } else { const detail=await response.text(); setNotice(detail); }
    setBusy("");
  }

  const actionable=items.filter(item=>item.status==="PENDING_REVIEW"||item.status==="IN_REVIEW");
  return <section className="panel expert-review-panel">
    <div className="panel-title"><span>EXPERT REVIEW · TEXT/GLOSS CORRECTIONS</span><small>LOCAL ADMIN ONLY</small></div>
    <div className="review-summary">
      <div><b>{summary?.byStatus?.PENDING_REVIEW??0}</b><span>대기</span></div><div><b>{summary?.byStatus?.IN_REVIEW??0}</b><span>검수 중</span></div><div><b>{summary?.byStatus?.APPROVED??0}</b><span>승인</span></div><div><b>{summary?.trainingEligible??0}</b><span>학습 후보</span></div>
      <p>{notice}</p><button onClick={refresh}>새로고침</button>
    </div>
    <div className="review-identity">
      <label>검수자 식별명<input value={reviewerId} onChange={event=>setReviewerId(event.target.value)} placeholder="예: reviewer-01"/></label>
      <label>검수 역할<select value={role} onChange={event=>setRole(event.target.value as Role)}>{Object.entries(ROLES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>의미 보존<select value={meaning} onChange={event=>setMeaning(Number(event.target.value))}>{[5,4,3,2,1].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>한국어 자연스러움<select value={korean} onChange={event=>setKorean(Number(event.target.value))}>{[5,4,3,2,1].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>오인식 위험<select value={risk} onChange={event=>setRisk(Number(event.target.value))}>{[1,2,3,4,5].map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="review-notes">검수 의견<input value={notes} onChange={event=>setNotes(event.target.value)} placeholder="반려 시 필수"/></label>
    </div>
    <p className="review-policy">일반 데이터는 서로 다른 2개 역할(농인 사용자 또는 수어 통역사 포함), 의료·금융·재난은 수어 검수자와 해당 분야 전문가 승인이 필요합니다. 승인 기준은 의미·한국어 각 4점 이상, 위험 2점 이하입니다.</p>
    <div className="review-list">{actionable.length===0?<p>검수 가능한 교정 데이터가 없습니다.</p>:actionable.map(item=><article key={item.feedbackId}>
      <header><span>{item.domain.toUpperCase()} · {item.reason}</span><b className={item.status.toLowerCase()}>{STATUS[item.status]??item.status}</b></header>
      <div className="review-copy"><small>원문</small><span>{item.originalText||"(빈 원문)"}</span><small>교정문</small><strong>{item.correctedText}</strong><small>글로스</small><span>{item.glossSequence.join(" → ")||"—"}</span></div>
      <div className="review-history">{(item.reviews??[]).map(review=><span key={review.reviewId}>{ROLES[review.reviewerRole]} · {review.decision==="APPROVE"?"승인":"반려"} · 의미 {review.scores.meaningPreservation}/한국어 {review.scores.koreanNaturalness}/위험 {review.scores.misrecognitionRisk}</span>)}</div>
      <small className="review-scope">영상·랜드마크 미포함 — 수어 자연스러움, 비수지 신호, 지역·연령 변이는 이 자료에서 평가 불가</small>
      <div className="review-actions"><button disabled={Boolean(busy)} onClick={()=>decide(item.feedbackId,"APPROVE")}>승인</button><button disabled={Boolean(busy)} className="reject" onClick={()=>decide(item.feedbackId,"REJECT")}>반려</button></div>
    </article>)}</div>
  </section>;
}

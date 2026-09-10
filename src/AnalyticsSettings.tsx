import { useState, useSyncExternalStore } from 'react';
import { getAnalyticsStatus, setAnalyticsEnabled, subscribeAnalytics } from './analytics';
export function AnalyticsSettings({notice = false}: {notice?: boolean}) {
  const status = useSyncExternalStore(subscribeAnalytics,getAnalyticsStatus);
  const [busy,setBusy] = useState(false);
  if (notice && (!status.configured || status.decided)) return null;
  const change = async (enabled: boolean) => { setBusy(true); try { await setAnalyticsEnabled(enabled); } finally { setBusy(false); } };
  return <section className="analytics-settings" aria-label="이용 통계 설정">
    <b>서비스 개선을 위한 이용 통계 {status.enabled ? 'ON' : 'OFF'}</b>
    <p>동의하면 Firebase·Google Analytics로 앱 유입·클릭, 광고 요청·표시·오류·보상 획득, 영상 노출·선택·광고 보상·잠금 해제·시청 시간과 중도 종료, 설정 선호·변경, 감지 시작 결과, 측정 시간과 속도 구간·평균·최고 속도를 집계합니다. 앱·기기 정보도 함께 처리됩니다. 카메라 영상, 얼굴 정보, 위치 좌표와 이동 경로는 보내지 않습니다.</p>
    <small>{status.error ? '분석 연결 상태를 확인하지 못했습니다.' : !status.configured ? 'Android 앱의 Firebase 연결 후 사용할 수 있습니다.' : '선택 사항이며 거절해도 모든 기능을 이용할 수 있습니다. 설정에서 언제든 끌 수 있습니다.'}</small>
    <div><button disabled={busy || !status.configured} aria-pressed={status.enabled} onClick={() => void change(!status.enabled)}>{busy ? '저장 중…' : status.enabled ? '이용 통계 끄기' : '동의하고 통계 켜기'}</button>
    {notice && <button disabled={busy} onClick={() => void change(false)}>동의하지 않음</button>}</div>
  </section>;
}

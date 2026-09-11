import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { appStorage } from './appStorage';
import { saveDriverPlacementChoice } from './driverPlacementPreference';
import { t, useLanguage } from './language';
import './driver-placement-guide.css';

export function DriverPlacementGuide({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  const language = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const continueToCamera = (hide: boolean) => {
    try { saveDriverPlacementChoice(appStorage, hide); }
    catch { setError(t('설정을 저장하지 못했습니다. 확인을 누르면 이번 안내를 닫을 수 있어요.')); return; }
    onConfirm();
  };
  return createPortal(<dialog ref={dialog} className="driver-placement-guide" aria-labelledby="driver-placement-title" aria-describedby="driver-placement-description" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <header><span>READY TO DRIVE</span><h2 id="driver-placement-title">{t('휴대폰, 이렇게 놓아 주세요')}</h2><p id="driver-placement-description">{t('출발 전, 정차한 상태에서 맞춰 주세요.')}</p></header>
    <figure>
      <img src={`/brand/driver-placement-${language}.png`} width="1122" height="1402" alt={t('핸들 앞쪽 대시보드와 오른쪽의 두 거치 위치 중 하나를 고르고, 전면 카메라를 얼굴 쪽으로 맞추는 모습')} />
      <figcaption className="placement-accessible-caption"><ol>
        <li><b>1</b><span>{t('핸들 앞쪽 또는 오른쪽에 고정')}</span></li>
        <li><b>2</b><span>{t('카메라 각도는 얼굴 쪽으로')}</span></li>
        <li><b>3</b><span>{t('두 눈과 얼굴 전체가 보이게')}</span></li>
      </ol><p className="placement-position-note">{t('도로 시야와 계기판을 가리지 않게 설치해요.')}</p></figcaption>
    </figure>
    <p className="placement-caution">{t('주행 중에는 조작하지 말고, 졸리면 안전한 곳에서 쉬세요.')}</p>
    {error && <p className="placement-error" role="alert">{error}</p>}
    <div className="placement-actions"><button onClick={() => continueToCamera(true)}>{t('그만 보기')}</button><button autoFocus onClick={() => continueToCamera(false)}>{t('확인')}</button></div>
    <small className="placement-hint">{t('그만 보기를 누르면 다음부터 안내를 숨겨요.')}</small>
  </dialog>, document.body);
}

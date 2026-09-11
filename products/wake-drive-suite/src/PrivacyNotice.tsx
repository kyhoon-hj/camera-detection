import { useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLanguage } from './language';
import { showAdPrivacyOptions } from './ads';

export function PrivacyNotice({ allowAdOptions = true }: { allowAdOptions?: boolean }) {
  const en=useLanguage()==='en';
  const dialog=useRef<HTMLDialogElement>(null);
  return <>
    <button className="setting-row" onClick={()=>dialog.current?.showModal()}><span><b>{en?'Privacy information':'개인정보 처리 안내'}</b><small>{en?'On-device detection · AdMob advertising':'기기 내 감지 · AdMob 광고'}</small></span><i>↗</i></button>
    {allowAdOptions && Capacitor.isNativePlatform() && <button className="setting-row" onClick={() => void showAdPrivacyOptions()}><span><b>{en?'Ad privacy choices':'광고 개인정보 설정'}</b></span><i>↗</i></button>}
    <dialog ref={dialog} className="offline-privacy" aria-labelledby="offline-privacy-title">
      <h2 id="offline-privacy-title">{en?'Wake Drive privacy policy':'Wake Drive 개인정보처리방침'}</h2>
      <p>{en?'Camera frames and face signals are processed temporarily on your device for drowsiness detection. They are not recorded or sent to a server.':'카메라 영상과 얼굴 감지 신호는 졸음 감지를 위해 기기 안에서 일시적으로 처리하며, 녹화하거나 서버로 전송하지 않습니다.'}</p>
      <p>{en?'The app does not request device location and does not use Firebase Analytics. Detection models and videos are bundled. Google AdMob uses a network connection and may process advertising identifiers, IP-derived approximate location, device information and ad interactions to serve and measure ads and prevent fraud. Camera frames and detection signals are not sent to AdMob.':'기기 위치 권한과 Firebase Analytics를 사용하지 않습니다. 감지 모델과 영상은 앱에 포함됩니다. Google AdMob은 광고 제공·측정 및 부정행위 방지를 위해 인터넷 연결을 사용하며 광고 식별자, IP 기반 대략적 위치, 기기 정보와 광고 상호작용을 처리할 수 있습니다. 카메라 영상과 감지 신호는 AdMob으로 보내지 않습니다.'}</p>
      <p>{en?'Language, selected video and preferences are stored on this device. Clear app storage or uninstall the app to delete them. Camera access can be revoked in device settings.':'언어, 선택 영상과 설정은 이 기기에 저장됩니다. 앱 저장공간을 지우거나 앱을 삭제하면 삭제됩니다. 카메라 권한은 휴대폰 설정에서 철회할 수 있습니다.'}</p>
      <p>{en?'Voice guidance uses an installed offline voice. No account or sign-in is required.':'음성 안내는 설치된 오프라인 음성을 사용합니다. 회원가입이나 로그인이 필요하지 않습니다.'}</p>
      <dl className="offline-privacy-contact">
        <dt>{en?'Developer / Company':'개발자 / 회사명'}</dt>
        <dd>에이치제이솔루션</dd>
        <dt>{en?'Support and privacy inquiries':'사용자 및 개인정보 문의'}</dt>
        <dd><a href="mailto:hjshub@jnmdisplay.com">hjshub@jnmdisplay.com</a></dd>
        <dt>{en?'Privacy policy website':'개인정보처리방침 웹사이트'}</dt>
        <dd><a href="https://www.hjshub.com/privacy" target={Capacitor.isNativePlatform()?'_self':'_blank'} rel="noopener noreferrer">https://www.hjshub.com/privacy</a></dd>
      </dl>
      <p>{en?'The policy website opens in your browser. Email opens your email app; nothing is sent automatically.':'정책 웹사이트는 브라우저에서 열립니다. 이메일을 누르면 메일 앱이 열리며 자동으로 발송되지 않습니다.'}</p>
      <button className="primary" autoFocus onClick={()=>dialog.current?.close()}>{en?'Close':'닫기'}</button>
    </dialog>
  </>;
}

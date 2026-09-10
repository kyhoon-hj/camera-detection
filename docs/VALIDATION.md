# 분리 검증 결과

초기 분리 검증일: 2026-09-09

광고 영역 수정(2026-09-10): Wake Drive 0.1.3을 SM-F711N에 설치. 실제 AdMob 테스트 배너와 감지 버튼이 세로·가로·숨김/복구에서 겹치지 않는 Android 통합 테스트 통과. `AD_LAYOUT.md` 참조.

최신 UI 변경: Wake Drive 0.1.2로 이름·로고 변경, 코믹 홈 배너·반복 모션·효과 멈춤 반영. 122개 테스트와 Android 빌드 통과. `WAKE_DRIVE_REFRESH.md` 참조.

최신 변경(2026-09-10): Android 작은 화면 구현·미검증 범위는 `ANDROID_PIP.md` 참조. 회귀 122개와 졸방 0.1.1 웹·Android 빌드 및 APK PiP 선언 검증 통과. 에뮬레이터 부팅 오류로 실제 PiP 카메라 유지 테스트는 미완료. 재생 방식은 `PLAYBACK_SETTINGS.md`, Stitch 효과는 `STITCH_EFFECTS.md` 참조. 아래 표는 초기 분리 시점 기록이며 현재 실행 자산 비교는 `runtime-evidence.json`을 기준으로 합니다.

| 확인 항목 | 결과 |
|---|---|
| TypeScript | 최종 앱 빌드의 타입 검사 통과 |
| 회귀 및 분리 경계 | 13개 파일, 102개 테스트 통과 |
| 졸방 웹 빌드 | 성공, dist/jolbang |
| 열공 웹 빌드 | 성공, dist/yeolgong |
| 졸방 Android | assembleDebug 성공, 개발용 서명 APK 생성 |
| 열공 Android | assembleDebug 성공, 개발용 서명 APK 생성 |
| 패키지 검사 | aapt로 com.hjsolution.jolbang / com.hjsolution.yeolgong, 표시 이름 졸방 / 열공 확인 |
| 웹·APK 일치 | 각 APK 내부 HTML, 주요 JS/CSS, manifest, 서비스 워커의 SHA-256이 해당 웹 빌드와 일치 |
| 실행 | 127.0.0.1:5210 및 5211 리스너, 페이지 및 주요 자산 HTTP 200 |
| 홈 분리 | 각 이름과 서비스별 영상 보관함 표시, 상대 서비스 전환 메뉴 없음 |
| 졸방 화면 | 감지 준비·안전 안내·취소 후 자기 홈 복귀·운전 전용 설정 확인 |
| 열공 화면 | 시작 메뉴·공부 달력·학습 설정 확인 |
| 주소 우회 | 졸방의 ?mode=study와 열공의 ?mode=drowsiness 모두 자기 앱 홈으로 진입 |
| 모바일 | 열공 390×844 설정 및 홈 시각 확인; 두 앱 390px 폭에서 document scrollWidth = innerWidth 확인 |
| 브라우저 로그 | 확인한 두 앱의 오류 로그 없음 |
| 원본 보존 | 원본 v6의 추적 변경 목록은 기존 네이티브 설정 파일 3개로 유지; 원본 앱 소스 미수정 |
| 설치 재현 정보 | 현재 직접 의존성 버전 고정, 외부 로컬 경로 링크가 없는 package-lock.json 생성 |

HTTP 응답, 실행 PID, APK 크기·해시, 웹 자산과 APK의 비교 해시는 `runtime-evidence.json`을 참조합니다.

## 검증하지 않은 항목

- 실제 Android 단말에 두 APK 설치 후 동시 설치·실행
- 실제 카메라로 사람을 인식하고 졸음·집중 상태를 판단하는 동작과 정확도
- 기기의 경고음·TTS·경고 영상·운동/휴식 알림
- 기기 뒤로가기 및 백그라운드 상태에서의 실기 동작
- 정식 서명, AAB, 스토어 게시, 운영 광고·결제 연동
- 다른 PC에서 npm ci부터 시작하는 전체 새 환경 설치

빌드 경고: 기존 앱의 큰 JS 청크, Android flatDir 및 일부 SDK/플러그인의 사용 중단 예정 API 경고가 남아 있습니다. 빌드 실패는 없었습니다. iOS 설치본은 생성하지 않았습니다.

# Wake Drive 이름·홈 모션 변경

참고: 사용자가 제공한 Stitch 프로젝트의 alert-comic.html, library-comic.html과 2026-09-10 첨부 이미지.

| 단계 | 목표 | 구현 범위 | 파일 | 완료 기준 |
|---|---|---|---|---|
| 1 | 원본 표현 반영 | 원본 로고, 분홍 배너, 번개 스티커, 흔들림·음파 장식 | DriverLibrary, wake-drive.css | 모바일에서 이미지·글자 겹침 없음 |
| 2 | 이름 변경 | 화면, PWA, Android 설치 이름·PiP, 아이콘 | appProfile, branding, native | Wake Drive 표시, 기존 앱 ID·저장 공간 유지 |
| 3 | 검증 | 빌드, 기존 회귀, 반응형·모션 끄기 | 검증 기록 | 실행한 범위 기록 |

배너는 홈의 출발 전 표현이다. 원본의 가상 '볼륨 150%', '위기 감지', '5초 안에' 문구는 실제 동작에 맞춰 알림 설정 상태와 일반 안내로 바꾼다. 반복 모션을 일시정지할 수 있고 기기의 동작 줄이기 설정을 따른다. 측정 중 카메라와 PiP에는 홈 장식을 추가하지 않는다. 열공과 기존 광고 완료→보유→직접 적용, 랜덤 재생 로직은 유지한다.

원본 로고는 참조 HTML의 WakeDrive App Logo 자산을 public/brand/wake-drive-source.png에 보관한다. 원격 요청 없이 앱에 포함한다.

## 검증 결과

- TypeScript, Vite 및 Android assembleDebug 통과. 앱 이름 Wake Drive, 버전 0.1.2 / 3을 APK aapt로 확인.
- 기존 17개 파일 122개 회귀 테스트 통과. 변경 후 HTTP 200 및 웹/APK의 HTML·JS·CSS·manifest·대표 이미지 일치 확인.
- 390×844, 320×740, 844×390 브라우저 시각 검수. 가로 넘침 없음, 좁은 화면에서 한국어 단어 단위 줄바꿈.
- 배너·번개·확성기·음파 5개 애니메이션 running 확인. 효과 멈춤 후 모든 장식 paused 확인. prefers-reduced-motion: reduce에서 애니메이션 0개 확인 후 에뮬레이션 해제.
- 배너 알림 OFF/ON이 기존 경보음·음성 안내 스위치와 함께 변경됨. OFF에서 음파 장식 정지. 확인 후 원래 ON 복구.
- 브라우저 JavaScript 오류 없음. 열공의 실행명·APK 유지. 빌드 스크립트는 선택한 앱의 브랜딩만 생성하도록 수정.
- Android 실기 설치·카메라·PiP는 이번 UI 변경에서 검증하지 않음. 이전 에뮬레이터 문제 및 실제 측정 유지 미검증 범위는 ANDROID_PIP.md 유지.

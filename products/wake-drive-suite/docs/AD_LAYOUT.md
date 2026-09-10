# 광고와 앱 영역 분리

## 후속 변경: 버튼 고정 제거 (0.1.4)

- 사용자가 스크롤 중에도 시작 버튼이 떠 있는 동작을 지적하여 홈 pop-dock의 fixed 배치를 제거하고 분홍 배너 아래로 이동했다.
- 감지 controls는 세로 fixed·가로 sticky를 제거해 안내와 함께 스크롤되는 일반 배치로 변경했다. 기존 광고 전용 네이티브 영역은 유지한다.
- 웹 검증: 390px 화면에서 홈 버튼 position=static, 스크롤 전 top=422.5px, 한 화면 스크롤 후 -421.5px. 영상 위에 버튼이 남지 않음을 확인.
- TypeScript·웹·Android 빌드 통과, HTTP 및 웹/APK 자산 일치. SM-F711N 업데이트 설치 후 0.1.4 / versionCode 5 확인.
- 설치본 캡처에서 화면에 떠 있던 감지 버튼이 제거됨을 확인. 이번 Android 자동 테스트는 감지 화면 탐색 중 WebView JS 응답 시간 초과로 완료하지 못했으므로, 아래 0.1.3 실기 통과 기록과 구분한다.

문제: driver-monitor.css의 bottom:0이 과거 native-app 광고 여백을 덮어써 네이티브 AdMob 배너가 감지 버튼 위에 겹침.

| 단계 | 수정 | 파일 | 완료 기준 |
|---|---|---|---|
| 1 | 광고 실제 위치를 기준으로 WebView 영역 분리 | BannerLayoutController, MainActivity | 앱 하단이 광고 상단보다 위 |
| 2 | 광고 구분 띠, PiP에서 광고 숨김 | BannerLayoutController | 배너 제거 시 앱 크기 복구, PiP 화면 확보 |
| 3 | 빌드·기기 검증 | Android 통합 테스트, APK | 설치 버전·실제 배너 경계 기록 |

광고 SDK의 실제 AdView 위치를 매 프레임 레이아웃 전에 확인한다. WebView 하단 여백은 광고 높이·네이티브 하단 영역·22dp 광고 표기 띠를 포함한다. CSS 숫자만 올리는 방식과 달리 모든 fixed 버튼과 모달의 기준 화면이 광고 위에서 끝난다. 배너가 없으면 전체 공간을 돌려주고, PiP 진입 중·활성 중에는 광고를 숨긴다. 열공 프로젝트와 광고 ID·보상 잠금 정책은 유지한다.

## 검증 (2026-09-10)

- Android 빌드·TypeScript 통과, 기존 17개 파일 122개 회귀 테스트 통과.
- 연결된 SM-F711N에 0.1.3 / versionCode 4 업데이트 설치 및 패키지 버전 확인.
- BannerLayoutIntegrationTest 실기 실행 통과: 실제 AdMob 테스트 배너, 감지 준비 화면 세로·광고 숨김/복구·가로 검증. 배너 높이를 가정하지 않고 실제 네이티브 광고 좌표와 WebView/버튼 좌표를 비교.
- 세로: WebView 하단 2262px, 광고 상단 2328px, 버튼 하단 2079px. 가로: WebView 하단 846px, 광고 상단 912px, 버튼 하단 585px. 앱/광고 사이 66px(22dp) 구분 띠.
- 초기 검증은 광고 로딩 도중의 임시 뷰를 잡거나 JS 페이지 이동 응답을 기다리다 실패. 테스트를 안정적인 광고 경계 대기 및 WebView 공식 loadUrl 탐색으로 보완한 후 통과. 앱 코드를 테스트 결과에 맞춰 우회하지 않음.
- 실기 캡처 banner-layout-portrait.png, banner-layout-final.png를 확인. 실제 카메라 측정·PiP 동작은 이 광고 레이아웃 테스트의 검증 범위가 아님.

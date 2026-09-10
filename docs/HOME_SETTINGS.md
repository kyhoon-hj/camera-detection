# 홈 옵션 진입 수정

2026-09-10 · Android 0.1.12 / versionCode 13

홈에서 설정을 누르면 전면 광고를 기다린 뒤 activeModule을 DROWSINESS로 바꾸던 동작을 제거했다. 설정 화면을 측정 화면의 렌더링 조건 밖으로 분리하고, 기존 홈/측정 모드를 유지한 채 설정 탭만 연다.

- 홈 → 설정: 전면 광고 요청·졸음 모드 전환·카메라 생성 없이 설정 표시.
- 홈에서 설정 닫기: 상단 뒤로가기와 하단 버튼 모두 홈으로 복귀.
- 측정에서 설정 닫기: 측정 화면으로 복귀. 설정을 열기 위해 stop 또는 모드 전환을 호출하지 않는다.
- 홈 이동 시 설정 탭을 초기화해 다음 진입에 설정이 남지 않도록 처리.
- 홈 설정에도 기존 설정 스타일 적용. 일반 배너와 영상 잠금 해제용 보상 광고 흐름은 유지.
- Analytics는 open_settings / close_settings 클릭, settings 화면 방문을 기록한다. 옵션 진입만으로 전면 광고 ad_request가 발생하지 않는다.

변경 파일: [main.tsx](../src/main.tsx), [driver-monitor.css](../src/driver-monitor.css), [Android 버전](../native/jolbang/android/app/build.gradle).

검증:

- TypeScript 및 Android 빌드 성공. 기존 22개 파일 156개 테스트 통과.
- 최신 웹에서 홈 → 설정 → 홈 복귀, 측정 준비 화면 → 설정 → 측정 준비 화면 복귀를 실제 버튼 조작으로 확인.
- 홈 설정 DOM: module-home + is-settings, 설정 1개, camera-stage 0개 확인. 설정 화면 배치 육안 확인.
- 연결 휴대폰 업데이트 설치·Activity 실행 성공, 설치본 0.1.12 / versionCode 13 확인. HTTP 응답과 APK/웹 배포 파일 일치 확인.
- 휴대폰 실제 설정 버튼 조작 및 측정 중 카메라 지속 동작은 별도 실기 확인 범위이며, 웹 검증을 네이티브 동작 검증으로 대체하지 않는다.

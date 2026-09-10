# Wake Drive · 열공 개발자 인수인계

작성일: 2026-09-10. Wake Drive Android **0.1.12 / versionCode 13**.

## 소스 기준과 저장소 구조

- 저장소: https://github.com/kyhoon-hj/camera-detection
- 후속 앱 개발 위치: [`products/wake-drive-suite`](../products/wake-drive-suite).
- 기존 `apps/driver-mobile`은 졸음·열공 통합 앱이다. 기존 카메라 코어, Python 서버, 통합 앱의 파일과 커밋 이력은 유지했다.
- 분리 앱은 기존 SUHA v6 `f924035`를 기반으로 개발했다. 로컬 최종 소스 `d3fe182`, Firebase 공유 문서 `402ec97`을 subtree로 가져와 두 커밋의 이력도 보존했다.
- 제품 폴더는 자체 `package-lock.json`을 사용하는 독립 npm 프로젝트다. 저장소 루트의 pnpm 명령은 기존 앱/코어용이며 이 제품을 빌드하지 않는다.
- 앞으로 변경은 이 저장소의 제품 폴더에서 진행한다. 예전 PC의 별도 `jolbang-apps` 작업 폴더는 자동 동기화되지 않는다.

## 새 PC에서 시작

Node.js 24 LTS 및 npm을 준비한다. 인수인계 검증 환경은 Node.js 24.16.0 / npm 11.13.0이다.

```powershell
git clone https://github.com/kyhoon-hj/camera-detection.git
cd camera-detection/products/wake-drive-suite
npm ci
npm run typecheck
npm test
npm run build
npm run preview:jolbang
# 별도 터미널에서 같은 제품 폴더로 이동한 후 실행
npm run preview:yeolgong
```

- Wake Drive: http://127.0.0.1:5210/
- 열공: http://127.0.0.1:5211/
- 새 개발 환경의 `node_modules`는 `npm ci`로 설치한다. 이전 PC의 junction, 상위 폴더 바로가기, 절대 경로는 복사하지 않는다.
- 제품 README의 상위 폴더 `.cmd` 바로가기는 이전 PC 전용이다. 새 checkout에서는 위 npm 명령을 사용한다.

## Android 빌드 및 설치

JDK 21, Android SDK를 준비하고 `JAVA_HOME`, SDK 경로를 설정한다. 각 `native/<앱>/android/local.properties`에 해당 PC의 `sdk.dir`을 지정할 수 있다. SDK 경로 파일은 Git에 넣지 않는다.

```powershell
# products/wake-drive-suite에서 실행
npm run android:jolbang
npm run android:yeolgong
adb devices
adb install -r releases/wake-drive-debug.apk
# 열공 설치가 필요한 경우
adb install -r releases/yeolgong-debug.apk
```

| 앱 | applicationId | Android 소스 |
|---|---|---|
| Wake Drive | `com.hjsolution.jolbang` | `native/jolbang/android` |
| 열공 | `com.hjsolution.yeolgong` | `native/yeolgong/android` |

앱 식별자와 저장 접두사는 설치 데이터 및 보유 영상 유지에 관여하므로 임의로 바꾸지 않는다. Java namespace와 Wake Drive applicationId는 서로 다르다.

APK, 빌드 결과, 서명 키, `node_modules`는 저장소에 포함하지 않는다. 새 PC의 debug 서명이 기존 설치본과 다르면 업데이트 설치가 거절될 수 있다. 데이터를 보존해야 할 때는 기존 개발자의 서명 환경을 확인하고, 설치 문제 해결을 위해 앱을 임의 삭제하지 않는다. 운영 서명·Play Store 배포는 이번 인수인계에 포함되지 않았다.

## Firebase와 광고

- [Firebase 프로젝트·앱 ID 및 설정 절차](../products/wake-drive-suite/docs/FIREBASE_CONNECTION.md)
- [27개 이벤트·5개 사용자 속성·수집 정책·DebugView](../products/wake-drive-suite/docs/FIREBASE_HANDOFF.md)
- [DAU/MAU·광고 표시·보상 카운트와 검증 범위](../products/wake-drive-suite/docs/ACTIVE_USERS_AND_ADS.md)

Firebase 프로젝트는 `wake-drive`, GA4 속성은 `553479695`이다. Wake Drive Android 네이티브에서 이용 통계 동의가 켜져야 수집한다. 웹 미리보기와 열공 앱은 수집 대상이 아니다.

`native/jolbang/android/app/google-services.json`은 Android 클라이언트 설정으로 Git에 포함한다. 관리용 서비스 계정이나 로그인 자격 증명이 아니다. Firebase/GA4 콘솔 접근 권한은 소유자가 다음 개발자의 Google 계정에 별도로 부여해야 한다. 비밀번호·토큰·서명 키는 이 저장소로 공유하지 않는다.

실제 배너 `ad_request` 1건과 `ad_shown` 3건의 Firebase DebugView 수신을 확인했다. 전면/보상 광고와 GPS 관련 서버 수신은 아래 남은 검증과 구분한다. 광고 수익·클릭·eCPM을 커스텀 이벤트로 구현한 상태는 아니다.

## 최신 변경과 코드 위치

| 범위 | 주요 위치/문서 |
|---|---|
| 앱 분리와 식별자 | `src/appProfile.ts`, `src/appStorage.ts`, `scripts/app.mjs` |
| 홈·영상 잠금 해제·설정·측정 UI | `src/main.tsx`, `src/driver-monitor.css`, [홈 옵션 수정](../products/wake-drive-suite/docs/HOME_SETTINGS.md) |
| 고개 숙임 오탐 조정 | `src/monitor.ts`, [감도 기준](../products/wake-drive-suite/docs/HEAD_DOWN_TUNING.md) |
| 권한과 시작 동작 | [권한 처리](../products/wake-drive-suite/docs/PERMISSIONS_START.md) |
| 백그라운드/PiP | [Android PiP 검증 범위](../products/wake-drive-suite/docs/ANDROID_PIP.md) |
| 광고 처리와 계측 | `src/ads.ts`, `src/adAnalytics.ts` |
| Analytics 동의와 허용 목록 | `src/analytics.ts`, `src/analyticsCore.ts`, `native/jolbang/android/app/src/main/java/com/hjsolution/suha/driver/DriverAnalyticsPlugin.java` |
| 열공 UI | `src/StudyModeScreen.tsx` |

표의 코드 경로는 제품 폴더 기준이다. Analytics 이벤트/파라미터를 바꿀 때 TypeScript와 Java 허용 목록, 테스트, Firebase 문서를 함께 갱신한다.

## 검증 상태와 다음 확인 항목

이번 GitHub 인수인계용 새 checkout에서 `npm ci`로 324개 패키지를 독립 설치한 뒤, `npm run typecheck`, `npm test`(22개 파일/156개 테스트), `npm run build`(Wake Drive·열공 모두)를 다시 통과했다. 가져온 제품 소스 트리는 원본 `402ec97`과 일치한다. 기존 의존성의 deprecated 경고 및 약 574 kB JS 청크 크기 경고는 남아 있으며 빌드 실패는 아니다. 이번 확인에서 Android 빌드나 실기 검증을 반복하지는 않았다.

이전 작업에서 전체 22개 테스트 파일/156개 테스트, TypeScript, Wake Drive Android 빌드가 통과했다. 0.1.12/code 13의 휴대폰 업데이트 설치 및 Activity 실행을 확인했다. 웹에서는 홈 → 설정 → 홈, 측정 준비 → 설정 → 측정 준비 복귀를 확인했다.

다음 항목은 완료로 간주하지 않고 실제 기기에서 확인한다.

1. 홈 설정 버튼을 눌렀을 때 전면 광고 없이 설정이 열리는지, 측정 중 설정 왕복 시 카메라가 계속 동작하는지.
2. 작은 숙임·짧은 끄덕임과 깊은 숙임을 구분하는지. 정차 상태에서 감도 및 경고 영상 재생을 확인한다.
3. 실제 보상 광고 시청 → 보상 → 영상 잠금 해제 → 재생의 전체 흐름과 Firebase 서버 이벤트 수신.
4. 위치 권한 및 유효한 GPS에서 속도·운전 시간 이벤트 수신. 측정 공백과 중복 집계가 없는지.
5. 지원 단말의 홈 전환/PiP, 권한 거부·설정 복귀, 통계 동의 철회 동작.
6. 운영 광고 단위, 운영 서명, 개인정보 안내 및 스토어 배포 준비.

`.github/workflows/wake-drive.yml`은 제품의 의존성 설치·타입 검사·테스트·두 웹 앱 빌드를 수행한다. Android 실기, Firebase 서버 수신, 스토어 배포는 이 CI로 검증되지 않는다. 기존 코어 CI와 별도이며 이번 GitHub 반영 자체가 앱 운영 배포를 의미하지 않는다.

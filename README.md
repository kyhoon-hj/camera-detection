# Wake Drive · 열공 독립 앱

**개발자 공유용:** [Firebase 연동 정보 및 연결 절차](docs/FIREBASE_CONNECTION.md).

2026-09-10: 졸방의 서비스 이름을 **Wake Drive**로 변경했습니다. 최신 Android 개발용 APK는 `releases/wake-drive-debug.apk` (0.1.12, versionCode 13)입니다. 기존 설치와 보유 영상을 유지하도록 앱 ID·저장 접두사·내부 빌드 이름 `jolbang`은 유지합니다. [시작 버튼·권한 설정 복구](docs/PERMISSIONS_START.md), [광고 영역 실기 검증](docs/AD_LAYOUT.md), [홈 디자인·모션 검증](docs/WAKE_DRIVE_REFRESH.md), [PiP 실기 미검증 범위](docs/ANDROID_PIP.md).

**Firebase 개발 인수인계:** [수집 항목·이벤트 사전·연결 및 테스트 방법](docs/FIREBASE_HANDOFF.md). 현재 앱 이벤트 27개, 이용 선호 속성 5개와 실제 서버 수신 확인 범위, 남은 실기 검증을 정리했습니다. GitHub로 소스를 전달할 때 이 문서와 관련 테스트를 함께 포함합니다. [DAU·MAU 및 광고 표시·보상 카운트](docs/ACTIVE_USERS_AND_ADS.md)도 참고하세요.

[고개 숙임 감도 조정 및 실기 확인 기준](docs/HEAD_DOWN_TUNING.md): 작은 숙임·짧은 끄덕임의 오탐을 줄이는 운전 모드 기준을 적용했습니다.

[홈 옵션 진입 수정](docs/HOME_SETTINGS.md): 옵션을 누르면 전면 광고 없이 설정을 열고, 진입했던 홈 또는 측정 화면으로 돌아갑니다.

기존 SUHA v6 (`f924035`, 2026-07-27) 작업 소스를 보존하고 별도 폴더에 분리한 앱입니다.

| 항목 | Wake Drive | 열공 |
|---|---|---|
| 웹 실행 | http://127.0.0.1:5210/ | http://127.0.0.1:5211/ |
| 앱 식별자 | com.hjsolution.jolbang | com.hjsolution.yeolgong |
| 설치 이름 | Wake Drive | 열공 |
| 핵심 화면 | 운전 경고 영상, 운전자 감지, 설정 | 학습 영상, 타이머, 공부 달력, 기록, 설정 |
| 저장 접두사 | jolbang: | yeolgong: |
| 웹 빌드 결과 | dist/jolbang | dist/yeolgong |
| Android 프로젝트 | native/jolbang/android | native/yeolgong/android |
| Android 테스트 설치본 | releases/wake-drive-debug.apk | releases/yeolgong-debug.apk |

앱 내부에는 두 서비스를 전환하는 메뉴가 없습니다. 주소의 모드 지정과 이전 세션 값도 자기 앱의 화면만 허용합니다. 공통 카메라/감지/음성 코드는 `src`에서 유지하고 앱 프로필을 빌드 때 고정합니다. 화면 이름·아이콘·PWA manifest·캐시·설정·기록·결제 상품 식별자는 앱별로 분리했습니다. 기존 통합 앱의 데이터를 자동 복사하지 않습니다.

## 실행

상위 폴더의 `Jolbang-separated.cmd`, `Yeolgong.cmd`를 각각 더블클릭합니다. 기존 통합 앱의 5206 서버와 함께 실행할 수 있습니다.

```powershell
.\Start-App.ps1 -App jolbang
.\Start-App.ps1 -App yeolgong
```

현재 PC에서는 검증된 v6의 설치 의존성을 `node_modules` 연결로 재사용합니다. 앱 소스는 원본과 별도입니다. 소스를 다른 PC에 가져갈 때는 `node_modules`, `dist`, Android `build`, `.gradle`, `local.properties`를 제외하고 복사한 뒤 Node.js와 JDK 21, Android SDK를 설치합니다.

```powershell
npm ci
npm test
npm run build
npm run preview:jolbang
# 별도 터미널
npm run preview:yeolgong
```

## Android 빌드

JDK 21의 `JAVA_HOME`과 Android SDK 위치가 필요합니다. 각 Android 폴더에 `local.properties`의 `sdk.dir`을 해당 PC 경로로 지정합니다.

```powershell
npm run android:jolbang
npm run android:yeolgong
```

각 명령은 타입 검사 → 앱별 웹 빌드 → Capacitor 동기화 → 해당 Android 프로젝트의 Debug APK 생성 순서로 실행합니다. 같은 Android 프로젝트를 덮어쓰며 앱을 바꾸는 구조가 아닙니다. 두 앱의 패키지 ID는 다르므로 서로 및 기존 통합 앱과 설치 식별자가 충돌하지 않습니다.

## 유지보수 구조

- `src/appProfile.ts`: 서비스 이름, 앱 ID, 허용 화면 및 진입 제한
- `src/appStorage.ts`: 앱별 localStorage/sessionStorage와 캐시 이름
- `src/main.tsx`: 앱별 홈·영상 보관함·운전 감지 화면
- `src/StudyModeScreen.tsx`: 열공 화면·기록·기기 뒤로가기 처리
- `vite.config.ts`: 프로필별 웹 출력과 메타데이터
- `capacitor.config.ts`: 프로필별 네이티브 프로젝트 및 웹 출력 연결
- `scripts/branding.mjs`: 앱별 문자 아이콘, manifest, 서비스 워커
- `scripts/app.mjs`: 분리 빌드 명령
- `tests/appSeparation.test.ts`: 다른 앱 진입 차단·같은 출처의 저장값 분리 검증

## 서비스 준비 상태

이번 결과는 각각 실행하고 검토할 수 있는 개발본입니다. 스토어에 게시하지 않았습니다. 광고는 기존 테스트 설정이고 구매/복원은 기존 미연동 상태입니다. 개발 앱 ID는 위 표와 같으며 상용 등록 전에 확정해야 합니다. 정식 서명·AAB·스토어 등록·상용 광고/결제 상품·법적 정책 확정은 후속 작업입니다. iOS 전용 프로젝트 생성·빌드·서명은 이번 범위에 포함하지 않았습니다.

카메라 분석 모델과 WASM은 기존 HTTPS 주소에서 불러오므로 최초 로딩에는 인터넷이 필요합니다. 실제 사람 대상 감지 정확도, 음성/경고 영상 동작, Android 단말 설치 후 동작은 각각 별도 검증이 필요합니다. 웹 화면 확인과 APK 빌드가 이 검증을 대신하지 않습니다.

자세한 실행 증거는 `docs/VALIDATION.md`에 기록합니다.



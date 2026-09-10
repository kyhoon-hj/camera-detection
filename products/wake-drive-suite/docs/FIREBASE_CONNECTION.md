# Wake Drive Firebase 연동 정보 — 개발자 공유용

작성일: 2026-09-10 · 앱 기준: **0.1.12 / versionCode 13**

다음 개발자가 기존 Firebase 프로젝트를 이어서 사용할 때 필요한 연결 정보다. 프로젝트·Android 앱 식별자는 실제 저장소의 `google-services.json`과 대조했다. 콘솔 설정 및 서버 수신 결과는 2026-09-10 작업 당시 확인 범위이며, 아래 남은 검증 항목과 구분한다.

## 연결 식별자

| 항목 | 값 |
|---|---|
| 서비스 이름 | Wake Drive |
| Firebase 프로젝트 ID | `wake-drive` |
| Firebase 프로젝트 번호 | `331472726742` |
| Firebase Android 앱 ID | `1:331472726742:android:24e40bc115535e5fb83777` |
| Android applicationId | `com.hjsolution.jolbang` |
| Java namespace | `com.hjsolution.suha.driver` |
| Google Analytics 계정 ID | `407518922` |
| GA4 속성 ID | `553479695` |
| Firebase 요금제 | 설정 당시 Spark |
| Firebase BoM | `34.18.0` |
| Analytics 의존성 | `com.google.firebase:firebase-analytics` |
| Google Services Gradle 플러그인 | `com.google.gms.google-services` / `4.4.4` |

## 콘솔 바로가기

- [Firebase 프로젝트 개요](https://console.firebase.google.com/project/wake-drive/overview)
- [Firebase 프로젝트 일반 설정](https://console.firebase.google.com/project/wake-drive/settings/general)
- [Firebase DebugView — 이벤트 수신 확인](https://console.firebase.google.com/project/wake-drive/analytics/app/android:com.hjsolution.jolbang/debugview/realtime~2Fdebugview)
- [Firebase 맞춤 정의 — 측정기준 설정](https://console.firebase.google.com/project/wake-drive/analytics/app/android:com.hjsolution.jolbang/userproperty/customdefinitions~2Fhub)
- [GA4 맞춤 정의](https://analytics.google.com/analytics/web/?authuser=0&hl=ko#/p553479695/customdefinitions/hub)

콘솔은 프로젝트 접근 권한이 있는 Google 계정으로 로그인한다. 계정 비밀번호나 로그인 토큰을 전달하는 대신 프로젝트 소유자가 다음 개발자의 계정에 필요한 권한을 부여한다. 소스를 복제하는 것만으로 Firebase·GA4 콘솔 접근 권한이 생기지는 않는다. 이 작업에서 다른 사람에게 계정 권한을 부여한 것은 아니다.

## 설정 파일과 키 관리

실제 Android 클라이언트 설정 파일은 다음 위치에 있고 **Git 커밋에 포함되어 있다**.

```text
native/jolbang/android/app/google-services.json
```

[저장소의 설정 파일](../native/jolbang/android/app/google-services.json)

이 파일에는 프로젝트·앱 ID 및 Firebase 클라이언트 API 키가 들어 있다. API 키 값을 Markdown에 중복 복사하지 않았으므로 실제 빌드 설정은 위 파일을 기준으로 한다. 클라이언트 구성 파일은 관리자 서비스 계정 비밀키와 다르며, 콘솔 로그인이나 서버 관리자 인증을 대신하지 않는다.

파일이 누락되거나 갱신이 필요하면 프로젝트 일반 설정 → 내 앱 → Android `com.hjsolution.jolbang`에서 `google-services.json`을 다시 받아 같은 위치에 둔다. 새 Firebase 프로젝트를 임의로 만들거나 열공 앱에 이 파일을 복사하지 않는다. 애플리케이션 ID를 변경하려면 Firebase Android 앱 등록도 별도로 검토한다.

서비스 계정 JSON, 비밀번호, 개인 로그인 토큰은 필요하지 않으며 이 문서에 포함하지 않는다. 저장소 공개 범위를 변경할 때는 기존 클라이언트 설정 파일의 공유 정책도 함께 확인한다.

## 다음 개발자의 연결 절차

1. 저장소를 복제하고 위 구성 파일의 프로젝트 ID와 Android 패키지를 확인한다.
2. 의존성이 요구하는 Node.js, JDK 21, Android SDK를 준비한다. `JAVA_HOME`과 PC별 Android SDK 경로(`local.properties`)를 설정한다.
3. **새 독립 체크아웃**에서 아래 명령을 실행한다. 기존 작업 PC의 `node_modules`는 원본 프로젝트와 junction으로 연결되어 있으므로 그 상태에서 `npm ci`를 실행하지 않는다.

```powershell
npm ci
npm run typecheck
npm test
npm run android:jolbang
adb devices
adb install -r releases/wake-drive-debug.apk
```

4. 설치한 Wake Drive 앱의 홈 또는 설정에서 **이용 통계 ON**에 동의한다. 기본값은 OFF다.
5. 테스트 기기에서 디버그 수집을 켜고 앱을 다시 실행한다. 여러 기기가 연결된 경우 ADB 대상 serial을 지정한다.

```powershell
adb shell setprop debug.firebase.analytics.app com.hjsolution.jolbang
```

6. DebugView에서 실제 앱 조작의 이벤트와 매개변수를 확인한다. 끝나면 디버그 수집을 해제하고 앱을 다시 실행한다.

```powershell
adb shell setprop debug.firebase.analytics.app .none.
```

Firebase CLI는 앱 Analytics 연결에 필수 조건이 아니다. 현재 Firebase CLI 로그인·배포 자동화가 구성됐다고 가정하지 않는다. 브라우저 미리보기(5210/5211)에서는 Android Analytics 브리지가 실행되지 않는다.

## 수집 범위와 현재 상태

| 항목 | 상태 |
|---|---|
| 앱 실행·활성 사용자 | Analytics SDK 연결. 앱 실행·사용자 참여 이벤트 수신 확인. DAU/WAU/MAU는 GA4 기간별 활성 사용자 집계 |
| 앱 이벤트 | 총 27개. 화면·클릭·설정·영상·측정·광고 이벤트 |
| 사용자 속성 | 5개: 적용 영상, 재생 방식, 소리, PiP 설정, 보유량 구간 |
| GA4 맞춤 정의 | 측정기준 19개(이벤트 14·사용자 5), 측정항목 12개, 계산 지표 1개 등록 확인 |
| 실제 배너 광고 | ad_request 1건, ad_shown 3건 서버 수신 확인. banner / bottom_banner / test 값 확인 |
| 보상 광고 | 표시·보상 획득 카운트 구현 및 단위 테스트 완료. 실제 보상 시청→잠금 해제의 서버 수신 확인은 남음 |
| 운전 참고 속도 | 집계 구현. 실제 GPS 속도 매개변수 서버 수신은 추가 검증 필요 |
| 개인정보 | 선택 동의한 Android Wake Drive 설치본만 수집. 얼굴 영상·GPS 좌표·이동 경로는 앱 분석 코드에서 전송하지 않음 |
| 미구현 연동 | Firebase Auth 로그인, Firestore 사용자 DB, Crashlytics, BigQuery 내보내기, Remote Config, 별도 관리자 화면 |

개발 광고의 `ad_test=test`와 운영 설정 광고의 `ad_test=live`를 구분한다. 광고 표시 횟수를 매출이나 완전 시청 횟수로 해석하지 않는다. 앱 통계 철회는 기기 내 분석 데이터를 초기화하지만 이미 전송된 서버 기록의 삭제 기능은 아니다.

## 함께 전달할 문서

- [Firebase 개발 인수인계 — 전체 이벤트·코드 위치·운영 절차](FIREBASE_HANDOFF.md)
- [DAU·MAU 및 광고 카운트 — 보고서 집계 기준](ACTIVE_USERS_AND_ADS.md)
- [사용자 이용 선호 — 속성과 해석 한계](USER_PREFERENCE_ANALYTICS.md)
- [프로젝트 README — 전체 빌드·실행 방법](../README.md)

이 Markdown 파일은 공유용 연결 요약이다. 다른 개발 환경에서 앱까지 실행하려면 이 문서와 함께 저장소 소스 및 `google-services.json`을 전달해야 한다.

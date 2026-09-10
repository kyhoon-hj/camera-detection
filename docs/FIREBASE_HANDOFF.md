# Wake Drive Firebase Analytics 개발 인수인계

기준일: **2026-09-10 · Android 0.1.11 / versionCode 12**

이 문서는 현재 수집 항목과 집계 기준, 연결 방법, 확인된 테스트 범위를 한곳에 정리한 인수인계 기준 문서다. 이후 이벤트를 변경하면 코드와 함께 갱신한다. [최초 연결 기록](FIREBASE_ANALYTICS.md)은 0.1.8, [이용 선호 확장 기록](USER_PREFERENCE_ANALYTICS.md)은 0.1.9 당시의 상세 이력이다.

## 1. 현재 연결 범위

| 항목 | 현재 값 |
|---|---|
| Firebase 프로젝트 | `wake-drive` / 프로젝트 번호 `331472726742` |
| Firebase Android 앱 | `1:331472726742:android:24e40bc115535e5fb83777` |
| Android applicationId | `com.hjsolution.jolbang` — 표시 이름을 바꿔도 유지 |
| Java namespace | `com.hjsolution.suha.driver` — applicationId와 다름 |
| GA 계정 / GA4 속성 | `407518922` / `553479695` |
| Firebase 요금제 | 확인 당시 Spark |
| 구성 파일 | `native/jolbang/android/app/google-services.json` |
| SDK | Firebase BoM `34.18.0`, `firebase-analytics` |
| 수집 대상 | **Wake Drive Android 네이티브 앱에서 이용 통계에 동의한 설치본** |
| 미수집 실행 환경 | 열공 앱, 브라우저 미리보기(5210/5211), 현재 iOS 경로 |

[Firebase 프로젝트](https://console.firebase.google.com/project/wake-drive/overview) · [GA4 맞춤 정의](https://analytics.google.com/analytics/web/?authuser=0&hl=ko#/p553479695/customdefinitions/hub) · [DebugView](https://analytics.google.com/analytics/web/?authuser=0&hl=ko#/p553479695/realtime/debugview)

저장소를 전달받아도 Firebase/GA4 계정 접근 권한은 생기지 않는다. 프로젝트 소유자가 다음 개발자에게 필요한 콘솔 권한을 별도로 부여해야 한다. 현재 연결은 브라우저 콘솔에서 구성했으며 Firebase CLI 로그인·배포 자동화는 완료 범위가 아니다.

Analytics만 연결했다. Firestore 사용자 DB, Firebase Auth 로그인, Crashlytics, BigQuery 내보내기, Remote Config, 별도 관리자 화면 및 자동 추천은 구현하지 않았다. 앱 인스턴스 기반 이용 통계이며 이름별 고객 조회나 여러 기기의 동일 계정 연결 기능은 없다.

## 2. 무엇을 확인할 수 있는가

| 질문 | 확인할 데이터 | 해석 주의 |
|---|---|---|
| 신규·재방문 이용자가 있는가 | SDK 신규 설치·세션 통계, `app_open` | 통계 동의한 설치본 기준. 캠페인 유입 경로는 실제 배포·유입 검증 필요 |
| 어느 화면·버튼을 사용하는가 | `screen_view`, `ui_click` | 코드에 지정된 주요 버튼만 수집. 모든 터치가 아님 |
| 어느 영상을 선호하는가 | 노출 → 선택 → 보상 → 잠금 해제 → 적용, 현재 적용 영상 | 반복 클릭 횟수와 고유 사용자 수를 구분 |
| 영상을 얼마나 보는가 | 재생 시작·25/50/75%·완료·중도 종료·오류 | 미리보기와 경고 영상을 `context`로 분리 |
| 측정을 얼마나 사용하는가 | `drive_progress` 또는 `drive_end`의 측정 시간 | 실제 차량 주행 시간 판별 기능은 아님 |
| 속도별 사용 패턴은 어떤가 | GPS 유효 시간, 가중 평균 시속, 최고 시속, 속도 구간 시간 | GPS 참고 표시가 켜져 유효한 속도가 있어야 집계 |
| 어떤 설정을 선호하는가 | 적용 영상, 고정/랜덤, 소리, PiP 설정, 보유량 구간 | 현재 설정과 변경 이력. 성격·건강·위험도 추정은 하지 않음 |
| 시작에 어려움이 있는가 | 감지 준비 성공/실패, 실패 단계, 준비 시간 | 얼굴 인식 정확도나 졸음 판정 정확도 지표는 아님 |

SDK 자동 이벤트(예: `first_open`, `session_start`, `user_engagement`, `app_update`)와 아래 앱 직접 이벤트를 구분한다. 자동 이벤트 각각의 실기 서버 수신을 모두 검증한 것은 아니다. `app_open`은 통계 활성화 후 JavaScript 실행 인스턴스당 최초 1회이며 OS 포그라운드 전환 횟수가 아니다.

## 3. 앱 이벤트 사전 — 기존 23개 + 광고 4개 = 27개

0.1.11에 `ad_request`, `ad_shown`, `ad_failed`, `ad_reward_earned`를 추가했다. 매개변수 `ad_format`, `ad_placement`, `ad_test`와 DAU·WAU·MAU 보고 방법은 [활성 사용자와 광고 카운트](ACTIVE_USERS_AND_ADS.md)를 함께 따른다. 아래 기존 23개 이벤트는 유지한다.

매개변수는 이벤트에 따라 일부만 존재한다. 없는 값은 0 또는 실패로 임의 치환하지 않는다.

### 진입·선택·설정 (9개)

| 이벤트 | 발생 시점 | 매개변수 |
|---|---|---|
| `app_open` | 통계 활성화 후 앱 실행 인스턴스 최초 기록 | 없음 |
| `screen_view` | 화면 변경 및 통계 활성화 시 현재 화면 | `screen_name`: home/drowsiness/settings, `screen_class`: WakeDrive |
| `ui_click` | 명시적으로 연결한 주요 버튼 조작 | `action`, 일부 조작은 `video_id` |
| `video_select` | 홈 영상 선택 | `video_id` |
| `video_apply` | 영상 적용 상태 저장 성공 | `video_id` |
| `preferences_snapshot` | 통계 활성화 후 현재 설정 최초 기록 | 아래 사용자 속성 5개와 동일한 매개변수 |
| `setting_change` | 이전 설정 스냅샷과 실제 값이 달라짐 | `setting_name`, `setting_value` |
| `video_impression` | 홈 영상 요소가 50% 이상 보임 | `video_id`, `filter`: ALL/OWNED, `ownership`: owned/locked |
| `library_filter` | 전체/보유 필터 값 변경 | `filter`: ALL/OWNED |

`action` 예: open_drowsiness, open_settings, start_detection, stop_detection, video_preview, filter_all, filter_owned, toggle_sound, test_voice, toggle_motion, toggle_pip, toggle_gps, open_permissions, recalibrate. 최신 연결 위치는 `main.tsx`의 `data-analytics-action` 및 `analyticsEvent` 호출과 `DriverLibrary.tsx`를 확인한다.

노출은 홈 진입·필터·영상 ID별 1회로 중복 제거한다. 미리보기 창 뒤나 문서가 숨겨진 상태는 제외한다. 50% 노출은 일정 시간 시청이나 광고 노출을 의미하지 않는다. 설정 변경에는 영상 적용 후 재생 방식 변경 등 정상 앱 처리로 바뀐 값도 포함된다.

### 광고 보상·잠금 해제 (4개)

| 이벤트 | 발생 시점 | 매개변수 |
|---|---|---|
| `reward_unlock_start` | 중복 실행 방지 검사 후 보상 해제 작업 시작 | `video_id` |
| `reward_ad_result` | AdMob 보상 요청 결과 | `video_id`, `outcome`: rewarded/cancelled/error |
| `video_unlocked` | 보상 획득 → 영상 다운로드/캐시 → 보유 상태 저장까지 성공 | `video_id` |
| `video_unlock_error` | 광고·다운로드·저장 등 해제 처리 오류 | `video_id` |

보상 성공과 실제 잠금 해제는 별도다. `video_unlocked`는 현재 경고 영상으로 적용되었다는 뜻도 아니다. 광고 매출·서버 보상 검증(SSV)·캠페인 성과 연동까지 완료한 상태가 아니다. 현재 개발 환경은 테스트 광고를 기본 사용한다.

### 영상 재생 (5개)

공통 매개변수: `video_id`, `context`(preview/warning), 경고의 경우 `reason`.

| 이벤트 | 발생 시점 | 추가 매개변수 |
|---|---|---|
| `video_play_start` | 실제 HTML video `playing` 발생 | 없음. 버퍼링 이후 중복 시작 제거 |
| `video_watch_progress` | 추정 시청 비율 25/50/75% 통과, 단계별 1회 | `milestone`: 25/50/75 |
| `video_play_complete` | 재생 시작 후 `ended` 도달 | `playback_seconds`, `watched_seconds`, `watch_percent` |
| `video_play_exit` | 재생 시작 후 완료 전에 닫기·중단 | `watched_seconds`, `watch_percent` |
| `video_play_error` | 활성 재생 시도에서 오류 | `watched_seconds`, `watch_percent` |

`playback_seconds`는 완료 시 미디어 위치다. `watched_seconds`는 진행하는 미디어 시간과 실제 시간 간격 중 작은 값을 누적한 근사 시청 시간이다. 탐색 점프·정지·버퍼링·2초 넘는 갱신 공백을 제외한다. `watch_percent`는 영상 길이 대비 이 누적 시간의 비율(최대 100)이다. 재생 속도·반복 구간의 영향을 받으며 주의 집중이나 고유 프레임 시청률을 측정하지 않는다.

끝으로 탐색해도 완료 이벤트가 발생할 수 있으므로 완료 횟수만으로 완전 시청을 판단하지 않는다. 시청 시간 합계는 완료/오류/중도 종료 이벤트에서 집계한다. 앱 강제 종료 시 종료 콜백과 전송은 보장되지 않는다.

### 측정·경고 (5개)

| 이벤트 | 발생 시점 | 매개변수 |
|---|---|---|
| `drive_start` | 동의 상태에서 졸음 모드 측정 집계 시작 | 없음 |
| `drive_progress` | 집계 시간 약 60초마다, 정상 종료 시 잔여 구간 | 아래 시간·속도 집계 |
| `drive_end` | 정상 측정 종료 | 전체 세션 시간·속도 집계 |
| `drive_warning` | 경고 영상 재생 시도 직전 | `video_id`, `reason` |
| `detection_start_result` | 실제 카메라·분석 준비 시도 성공 또는 오류 | `outcome`: success/error, `startup_seconds`, 오류 시 `failure_stage`: permission/camera_setup/analysis_setup |

경고 발생은 영상 재생 성공과 다르다. 시작 전 안전 안내 취소나 준비 도중 취소는 감지 준비 실패로 집계하지 않는다.

## 4. 측정 시간·속도 계산

| 매개변수 | 의미 / 단위 |
|---|---|
| `measured_seconds` | 측정 상태에서 유효하게 샘플링한 시간 / 초 |
| `speed_valid_seconds` | 유효한 GPS 속도가 있었던 시간 / 초 |
| `speed_sum` | 시속 × 유효 시간의 누적 합 / km/h·초 |
| `max_kmh` | 해당 구간 또는 세션 최고 시속 / km/h |
| `speed_0_10_seconds` | [0, 10) km/h 시간 / 초 |
| `speed_10_40_seconds` | [10, 40) km/h 시간 / 초 |
| `speed_40_80_seconds` | [40, 80) km/h 시간 / 초 |
| `speed_80_plus_seconds` | [80, 300] km/h 시간 / 초 |

1초 간격으로 집계하며 샘플 간격이 5초를 넘으면 그 공백은 제외한다. 속도는 0~300의 유한한 값만 유효하다. GPS 없음·오류·만료는 0km/h로 처리하지 않는다. 보정·정차·얼굴 미인식·경고 재생도 측정 상태가 유지되면 시간에 포함될 수 있다.

- **`drive_progress`와 `drive_end`를 합산하지 않는다.** 전자는 구간, 후자는 세션 전체 요약이므로 중복된다. 보고서에서 한 종류로 필터링한다.
- 평균 시속 = `SUM(speed_sum) / SUM(speed_valid_seconds)`. 분모가 0이면 ‘측정 없음’이다. 세션별 평균의 단순 평균을 사용하지 않는다.
- 전체 최고 시속은 `max_kmh`의 최댓값이다. GA4 기본 합계 표시를 최고 시속으로 해석하지 않는다.
- 강제 종료 시 마지막 약 1분 미만 구간과 종료 요약은 유실될 수 있다. 통계 철회 시 미전송 집계는 버린다.

## 5. 이용 선호 사용자 속성 — 5개

| 속성 | 허용 값 | 의미 |
|---|---|---|
| `applied_video` | video-0 ~ video-10 | 현재 적용 영상 |
| `playback_mode` | APPLIED / RANDOM_OWNED | 적용 영상 고정 / 보유 영상 랜덤 |
| `sound_mode` | on / off | 소리 설정 |
| `pip_mode` | on / off / unsupported | PiP 설정·지원 여부. 실제 PiP 체류 시간이 아님 |
| `library_size_band` | one / two_to_five / six_plus | 보유량 구간: 1개 이하 / 2~5개 / 6개 이상 |

속성은 현재 값이며 미동의 기간 이력은 소급 전송하지 않는다. 영상 ID와 표시 이름의 기준은 [wakeUpVideos.ts](../src/wakeUpVideos.ts)다. 영상 ID를 다른 콘텐츠에 재사용하면 과거 통계와 섞이므로 유지·변경 시 주의한다.

등록 완료된 GA4 맞춤 정의(0.1.9 당시, 0.1.11 광고 확장은 위 링크 참고):

- 이벤트 범위 측정기준 11개: video_id, context, reason, outcome, action, setting_name, setting_value, filter, ownership, milestone, failure_stage.
- 사용자 범위 측정기준 5개: 위 사용자 속성 전부.
- 맞춤 측정항목 12개: 위 시간·속도 8개 + playback_seconds, watched_seconds, watch_percent, startup_seconds.
- 계산 지표 1개: `calcMetric:average_speed_kmh`, `{속도 시간 가중 합} / {GPS 유효 시간}`.

모든 이벤트 매개변수가 맞춤 정의로 등록된 것은 아니다. DebugView의 원본 매개변수 확인과 일반 탐색 보고서 사용 가능 여부를 구분한다. 맞춤 정의와 일반 보고서 반영에는 시간이 걸릴 수 있다. 시청 비율·준비 시간의 평균은 해당 값을 갖는 이벤트 집계 기준으로 계산한다.

## 6. 동의·수집 제외 항목

통계는 **기본 OFF**이며 홈 또는 설정에서 선택 동의한다. Android SharedPreferences `wake_drive_analytics`의 `enabled`로 유지한다. 철회하면 SDK 수집 중단, 대기 중 앱 이벤트 차단, 진행 집계 폐기, 사용자 속성 제거, 기기 내 Analytics 데이터 초기화를 수행한다. 이미 전송된 서버 기록을 삭제하는 기능은 아니다.

앱 분석 코드가 보내지 않는 항목: 카메라 영상·사진·얼굴 정보, GPS 좌표·이동 경로, 사용자 이름·이메일·로그인 ID, 원본 미디어 URL, 자유 입력 문구·원문 오류. Firebase SDK 자체 앱·기기 정보와 앱 인스턴스 식별은 사용하므로 완전 익명 또는 계정 단위 식별이라고 설명하지 않는다.

Analytics 광고 ID 수집은 비활성화하고 AD_STORAGE / AD_USER_DATA / AD_PERSONALIZATION 동의는 거절 상태로 유지한다. 기존 AdMob 처리는 별도다. 분석 실패·미동의 때문에 카메라 감지나 광고 보상 → 다운로드 → 보유 저장 → 영상 적용의 기본 흐름이 막혀서는 안 된다.

## 7. 담당 코드와 테스트

| 파일 | 역할 |
|---|---|
| [analytics.ts](../src/analytics.ts) | 네이티브·앱 종류 제한, 동의 상태, 전송 큐, 철회 후 재전송 차단 |
| [analyticsCore.ts](../src/analyticsCore.ts) | 이벤트 27개·매개변수 33개 허용 목록, 시간·속도·시청 집계 |
| [preferenceAnalytics.ts](../src/preferenceAnalytics.ts) | 속성 허용 값, 최초 스냅샷·변경 비교 |
| [AnalyticsSettings.tsx](../src/AnalyticsSettings.tsx) | 통계 동의 UI |
| [main.tsx](../src/main.tsx) | 화면·감지·경고·보상·적용·설정 이벤트 연결 |
| [DriverLibrary.tsx](../src/DriverLibrary.tsx) | 노출·필터·선택·미리보기 시청 이벤트 |
| [ads.ts](../src/ads.ts), [unlockWakeUpVideo.ts](../src/unlockWakeUpVideo.ts) | 광고 결과와 실제 잠금 해제 흐름 |
| [DriverAnalyticsPlugin.java](../native/jolbang/android/app/src/main/java/com/hjsolution/suha/driver/DriverAnalyticsPlugin.java) | Firebase 네이티브 브리지, 동의, 이벤트·매개변수·속성 허용 목록 |
| [MainActivity.java](../native/jolbang/android/app/src/main/java/com/hjsolution/suha/driver/MainActivity.java) | 브리지 등록 |
| [AndroidManifest.xml](../native/jolbang/android/app/src/main/AndroidManifest.xml), [app/build.gradle](../native/jolbang/android/app/build.gradle) | 기본 수집·광고 ID 설정, SDK·Google Services 구성·앱 버전 |
| [analytics.test.ts](../tests/analytics.test.ts), [analyticsCore.test.ts](../tests/analyticsCore.test.ts), [preferenceAnalytics.test.ts](../tests/preferenceAnalytics.test.ts) | 동의·허용 목록·집계·시청·속성 회귀 테스트 |
| [FirebaseConnectionTest.java](../native/jolbang/android/app/src/androidTest/java/com/hjsolution/suha/driver/FirebaseConnectionTest.java) | 실제 Firebase 구성, 기본 수집 설정, 선택적 합성 연결 테스트 |
| [PreferenceAnalyticsIntegrationTest.java](../native/jolbang/android/app/src/androidTest/java/com/hjsolution/suha/driver/PreferenceAnalyticsIntegrationTest.java) | 네이티브 속성 검증 및 실제 설정·미리보기 조작 테스트 |

TypeScript와 Java의 허용 목록은 양쪽에 있다. 이벤트를 추가할 때 한쪽만 변경하면 누락될 수 있다. 일반 매개변수는 허용 키와 0 이상의 유한 숫자 또는 영문·숫자·밑줄·하이픈 1~80자만 통과하며, 사용자 속성은 위 고정 값도 추가 검증한다.

## 8. 새 개발 환경에서 실행·확인

1. Node.js(설치 의존성 요구 버전 충족), JDK 21, Android SDK를 준비한다. `package-lock.json` 기준으로 설치한다.
2. 같은 Firebase Android 앱의 `google-services.json`을 위 구성 파일 위치에 둔다. 패키지가 `com.hjsolution.jolbang`, 프로젝트가 `wake-drive`인지 확인한다. 열공 프로젝트에 복사하지 않는다.
3. `JAVA_HOME`과 Android SDK 경로를 설정한다. SDK 로컬 경로는 각 PC의 `local.properties`로 관리한다.
4. **새로 복제한 독립 작업 폴더**에서 다음을 실행한다. 기존 작업 PC는 원본 v6의 `node_modules`를 junction으로 공유하므로 그 연결 상태에서 `npm ci`를 실행하지 않는다.

```powershell
npm ci
npm run typecheck
npm test
npm run android:jolbang
adb devices
adb install -r releases/wake-drive-debug.apk
```

ADB 명령은 기기가 한 대 연결된 경우를 가정한다. 여러 대면 대상 serial을 지정한다. 실기 테스트는 정차 상태에서 진행하고, 휴대폰 잠금 해제 및 앱의 이용 통계 ON을 확인한다.

```powershell
adb shell setprop debug.firebase.analytics.app com.hjsolution.jolbang
```

앱을 다시 열고 DebugView에서 대상 기기를 선택한다. 아래 시나리오의 이벤트 이름과 매개변수를 확인한다. 작업 후 디버그 설정을 반드시 해제한다.

```powershell
adb shell setprop debug.firebase.analytics.app .none.
```

| 실기 시나리오 | 기대 확인 |
|---|---|
| 동의 ON 후 홈·설정 이동 | app_open, screen_view, preferences_snapshot, 사용자 속성 5개 |
| 소리·고정/랜덤 변경 후 원래대로 복구 | setting_change의 이름·값, 사용자 속성 갱신 |
| 보유 필터 → 보유 영상 선택 → 미리보기 → 중간 닫기 | library_filter, video_impression, video_select, video_play_start, video_play_exit 및 시청 시간 |
| 미리보기를 끝까지 재생 | 진행 단계 및 video_play_complete; 시청 비율 함께 확인 |
| 테스트 보상 광고로 잠긴 영상 해제 | reward_unlock_start → rewarded 결과 → video_unlocked. 다운로드 실패와 구분 |
| 측정 시작 → 60초 이상 유지 → 정상 종료 | detection_start_result, drive_start, drive_progress, drive_end |
| GPS 참고 표시 ON 및 위치 권한 허용 | 실제 유효 속도 있을 때 speed_* 집계. GPS 없음과 정차 0 구분 |
| 통계 OFF 후 같은 조작 | 이후 앱 이벤트·속성 전송 차단, 핵심 기능 정상 유지 |

경고 영상은 실제 경고 동작에서 `drive_warning` 이후 `context=warning`의 실제 재생 이벤트까지 확인한다. 정차 중 GPS 확인만으로 이동 속도 정확도를 검증했다고 기록하지 않는다. 계측 테스트의 `integration_check`는 합성 연결 진단이며 운영 앱 허용 목록에 없는 테스트 전용 이벤트다.

비어 있는 DebugView 점검 순서: Android Wake Drive 실행 여부 → 앱 통계 ON → 네이티브 구성 상태 `configured` → 설치본 패키지/프로젝트 → 디버그 기기 선택 → 네트워크와 업로드 대기. 브라우저에서 버튼을 눌러서는 이 네이티브 경로로 수집되지 않는다.

## 9. 확인된 결과와 남은 검증

0.1.11 광고 확장의 검증은 [활성 사용자와 광고 카운트](ACTIVE_USERS_AND_ADS.md)를 참고한다. 아래는 **2026-09-10 0.1.9까지의 기존 실행 기록**이다. 이 문서 작성 시 테스트를 재실행한 결과가 아니다. 상세 근거는 상단의 연결·선호 확장 기록과 저장소의 테스트 소스를 함께 본다.

| 검증 수준 | 결과 |
|---|---|
| 자동 테스트 | 21개 파일 140개 통과, TypeScript 검사 통과 |
| 빌드·설치 | Android 0.1.9 / versionCode 10 빌드 및 실기 업데이트 설치 확인, 웹·APK 파일 일치 검사 통과 |
| 네이티브 테스트 | FirebaseConnectionTest 연결 구성 검증 통과. nativePreferenceAllowlist 1개 통과 |
| 실제 서버 수신: 기존 측정 | ui_click 2건, drive_start 1건, drive_progress 3건, screen_view 1건. measured_seconds=60.1 확인 |
| 실제 서버 수신: 이용 선호 | preferences_snapshot 및 속성 5개 확인: video-0 / APPLIED / sound on / PiP on / two_to_five |
| 합성 서버 진단 | integration_check 수신 확인. 실제 기능 성공 증거와 구분 |
| 추가 실기 검증 필요 | 실제 설정 변경·미리보기 중도 종료 UI 테스트는 휴대폰 잠금으로 미실행 |
| 추가 서버 검증 필요 | 광고 시청→잠금 해제, 실제 경고 영상 재생, GPS 속도 매개변수의 서버 도착 |

측정 서버 확인 당시에는 속도 매개변수가 없어 GPS 검증 성공으로 볼 수 없다. 선호 값은 테스트 기기 1대의 당시 상태이며 전체 이용자 통계가 아니다. 이전 테스트 종료 후 테스트 APK 제거와 디버그 모드 해제를 완료했다.

## 10. GitHub 인계 및 변경 원칙

- 소스, native 프로젝트, package-lock, 테스트, 이 문서와 관련 문서를 함께 전달한다. 빌드 캐시·node_modules junction·APK·개인 SDK 경로는 `.gitignore`에 따라 제외한다.
- `google-services.json`은 클라이언트 앱 설정이며 서비스 계정 키와 다르다. 저장소 공개 범위에 맞춰 포함하거나 콘솔에서 다시 받도록 전달한다. 서비스 계정 비밀키·개인 인증 토큰을 대신 넣지 않는다. 이 문서에는 API 키 값을 복사하지 않았다.
- 이벤트 추가·이름 변경 시 TS/Java 허용 목록, 호출부, 단위 테스트, GA4 맞춤 정의 필요 여부와 이 문서를 함께 갱신한다. 기존 영상 ID·이벤트 의미를 바꾸면 분석 연속성에 미치는 영향을 기록한다.
- 수집 항목을 확대하면 동의 안내도 검토한다. 미동의·철회·구성 누락 상황에서 전송 차단과 핵심 기능 정상 동작을 회귀 확인한다.
- 빌드 성공, 기기 설치 성공, 실제 UI 성공, Firebase 서버 수신 성공을 각각 기록한다. 미검증 항목은 완료로 바꾸지 않는다.

GitHub 업로드 후 다음 개발자는 이 문서의 연결 범위 → 이벤트 사전 → 실행·확인 → 남은 검증 순으로 시작하면 된다.

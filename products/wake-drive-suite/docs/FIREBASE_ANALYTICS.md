> 과거 버전 기록: Wake Drive 1.0.0부터 Firebase Analytics와 광고 SDK를 제거했습니다. 아래 설정·수집 내용은 현재 버전에 적용되지 않으며 재도입하지 않습니다. 최신 기준은 프로젝트 README.md입니다.

# Wake Drive 이용 통계

현재 통합 기준은 [Firebase 개발 인수인계](FIREBASE_HANDOFF.md)를 참고한다. 이 문서는 최초 연결 및 당시 검증 기록이다.

2026-09-10 / Android 0.1.8 (versionCode 9)

## 연결 상태

- **CONNECTED**: Firebase 프로젝트 `wake-drive` / 프로젝트 번호 `331472726742`, Spark 무료 요금제.
- Android 앱 `com.hjsolution.jolbang`, Firebase 앱 ID `1:331472726742:android:24e40bc115535e5fb83777` 등록. 실제 구성 파일을 앱에 적용하고 Google Services 리소스 생성·APK 빌드 성공.
- Google Analytics 계정 `407518922`, GA4 속성 `553479695` 연결. 한국 위치, Gemini 및 선택적 Google 데이터 공유 비활성화.
- 맞춤 측정기준 5개, 맞춤 측정항목 9개, 평균 시속 계산 지표 1개를 실제 Console에 등록하고 목록에서 확인.
- Android 0.1.8 / versionCode 9 업데이트 설치 성공, 기기 패키지 버전 재확인.
- 실제 서버 수신 검증은 아래 검증 결과 참고. 일반 사용자 데이터는 앱에서 이용 통계를 켠 이후에만 수집한다.
- [Firebase 대시보드](https://console.firebase.google.com/project/wake-drive/overview), [GA4 맞춤 정의](https://analytics.google.com/analytics/web/?authuser=0&hl=ko#/p553479695/customdefinitions/hub), [DebugView](https://analytics.google.com/analytics/web/?authuser=0&hl=ko#/p553479695/realtime/debugview).

## 수집 원칙

홈의 선택 동의 또는 설정에서 켠 Android 이용자만 수집한다. 기본 OFF이며 거절해도 감지, 영상, 광고 보상은 그대로 작동한다. OFF로 바꾸면 전송 대기 이벤트를 차단하고 진행 중 집계를 버린다. SDK 수집을 끄고 기기 내 Analytics 데이터를 초기화한다. 이미 서버로 전송된 기록을 삭제하는 기능은 아니다.

전송 항목은 앱·기기 기본 통계, 화면 이름, 정해진 버튼 ID, 영상 ID, 경고 이유, 성공/취소/오류, 재생 시간, 측정 시간 및 속도 집계다. 앱 코드는 카메라 프레임, 얼굴 정보, 위치 좌표, 이동 경로, 사용자 이름·이메일, 원본 URL 또는 버튼 문구를 전송하지 않는다. Firebase 광고 ID 수집과 광고 타겟팅 동의는 비활성화한다. 기존 AdMob 보상 처리는 별개로 유지한다.

## 이벤트

| 분석 목적 | 이벤트 | 주요 매개변수 / 의미 |
|---|---|---|
| 신규·재방문 유입 | SDK `first_open`, `session_start`; 앱 `app_open` | 동의한 사용자 기준. 신규 SDK 도입 전 설치 이력은 소급 복원하지 못함 |
| 화면 방문 | `screen_view` | `screen_name`: home, drowsiness, settings |
| 주요 클릭 | `ui_click` | `action`: open_drowsiness, open_settings, start_detection, stop_detection, video_preview, filter_all, filter_owned, toggle_sound, test_voice, toggle_motion, toggle_pip, toggle_gps, open_permissions, recalibrate 등 |
| 영상 선택·적용 | `video_select`, `video_apply` | `video_id` |
| 광고 잠금 해제 요청 | `reward_unlock_start` | `video_id` |
| 광고 보상 결과 | `reward_ad_result` | `video_id`, `outcome`: rewarded / cancelled / error |
| 실제 소유권 획득 | `video_unlocked` | 광고 보상과 다운로드 및 저장 모두 성공한 후에만 기록 |
| 해제 실패 | `video_unlock_error` | `video_id`; 원문 오류나 URL 미전송 |
| 실제 재생·완료·오류 | `video_play_start`, `video_play_complete`, `video_play_error` | `video_id`, `context`: preview / warning; `reason`; 완료 시 `playback_seconds`. 버퍼링으로 중복 playing이 발생해도 시작 1회 |
| 졸음 경고 발생 | `drive_warning` | `video_id`, `reason`. 재생 성공 횟수와 구분 |
| 측정 시작·진행·종료 | `drive_start`, `drive_progress`, `drive_end` | 아래 시간·속도 집계 |

`video-0` 일어나요~, `video-1` 로봇 확성기, `video-2` 골로~갑니당, `video-3` 천국과지옥, `video-4` 저승사자, `video-5` 너구리 안전요원, `video-6` 휴게소 안내요정, `video-7` 졸림공사, `video-8` 처녀귀신1편, `video-9` 동무들~, `video-10` 슈퍼걸.

## 운전 시간과 속도의 해석

`drive_*`는 **졸음 모드 측정 세션**이다. 실제 차량 운전 여부를 판별한 시간이 아니다. 얼굴 미인식, 정차, 영상 경고 중에도 세션이 유지되면 포함한다. 일반 종료 시 세션을 1회 마감한다. 강제 프로세스 종료 시 마지막 1분 미만의 데이터와 drive_end는 손실될 수 있다.

1초 샘플을 기기에서 집계하여 60초마다 `drive_progress`로 보내고, 종료 시 남은 구간도 보낸다. `drive_end`에는 전체 요약이 있으므로 **progress와 end를 합산하면 중복**된다. 집계는 둘 중 하나의 이벤트로 필터링한다.

- `measured_seconds`: 유효한 측정 샘플 간 시간. 5초 초과 실행 중단은 제외.
- `speed_valid_seconds`: GPS가 켜져 있고 유효한 속도가 있는 시간. GPS OFF·오류·만료는 분모에서 제외.
- `speed_sum`: 시속 × 유효 시간의 합. 전체 평균 시속은 `SUM(speed_sum) / SUM(speed_valid_seconds)`. 분모 0이면 ‘측정 없음’.
- `max_kmh`: 구간 또는 세션 최고 시속. 전체 최고는 MAX 사용.
- `speed_0_10_seconds`, `speed_10_40_seconds`, `speed_40_80_seconds`, `speed_80_plus_seconds`: 각각 [0,10), [10,40), [40,80), [80,300] km/h 체류 시간.

속도 집계를 위해 사용자가 GPS 참고 속도 표시를 켜야 한다. GPS를 자동으로 켜거나 권한을 추가 요구하지 않는다.

## 운영 및 재빌드 참고

1. Firebase Android 앱 패키지는 **com.hjsolution.jolbang**이며 등록을 완료했다.
2. 다운로드한 `google-services.json`을 `native/jolbang/android/app/google-services.json`에 배치. Firebase Android 설정은 공개 앱 식별자이며 서비스 계정 비밀키를 넣지 않는다.
3. Android 재빌드, 연결 기기 업데이트 설치. 열공 앱 프로젝트에는 설정을 복사하지 않는다.
4. 등록 완료한 GA4 관리 → 맞춤 정의의 이벤트 범위 차원 `video_id`, `context`, `reason`, `outcome`, `action` 및 맞춤 측정항목 `measured_seconds`, `speed_valid_seconds`, `speed_sum`, `max_kmh`, 4개 속도 구간, `playback_seconds`를 사용한다. 계산 지표 `calcMetric:average_speed_kmh`는 `{속도 시간 가중 합} / {GPS 유효 시간}`으로 등록했다.
5. Firebase Analytics 대시보드 / GA4 사용자 획득·트래픽 획득으로 유입 확인. 영상 비교는 이벤트 이름·video_id·context로 탐색 표를 구성. 보상 성공 수와 실제 잠금 해제 수를 따로 비교.
6. 테스트 기기만 `adb shell setprop debug.firebase.analytics.app com.hjsolution.jolbang` 적용, 앱 통계 동의 후 미리보기·클릭·감지 실행. Firebase DebugView에서 실제 이벤트 및 매개변수 수신 확인. 종료 후 `.none.`으로 디버그 해제.

ADB 직접 설치만으로 광고 캠페인 유입 분석을 검증할 수는 없다. Play 스토어 배포·캠페인 링크 및 실제 유입이 있어야 채널 분석을 평가할 수 있다. GA4 일반 보고서는 DebugView처럼 즉시 반영되지 않으며 맞춤 정의 이전 자료의 소급 표시도 보장되지 않는다.

## 검증

- TypeScript 검사 통과.
- 20개 파일, 133개 테스트 통과: 미동의 차단, 철회, 미설정 차단, 매개변수 허용 목록, GPS 없음과 0의 구분, 중단 시간 제외, 분별 합계, 재생 중복 방지 포함.
- Android 연결 빌드 성공, 업데이트 설치 성공, 실제 기기 버전 0.1.8 / 9 확인.
- 390px 웹 설정 화면에서 통계 OFF 안내 및 연결 전 비활성 상태 표시 확인. Android 수집은 웹 미리보기와 별도다.
- **SERVER_RECEIVED**: Firebase DebugView에서 실제 앱 `ui_click` 2건, `drive_start` 1건, `drive_progress` 3건, `screen_view` 1건 확인. `drive_progress`의 `measured_seconds=60.1` 값 직접 확인. 해당 진행 이벤트에는 속도 값이 없으므로 실제 GPS 속도 수신을 검증한 것은 아니다.
- SM-F711N 실제 기기 `FirebaseConnectionTest` 통과: 설치 APK의 프로젝트 및 앱 ID, 기본 수집 OFF, 광고 ID 수집 OFF를 검증. 합성 `integration_check` 이벤트의 서버 수신도 DebugView에서 확인했다. 합성 이벤트는 카메라·광고·실제 재생 성공을 의미하지 않는다.
- 테스트 종료 후 저장된 이용 통계 동의 설정 복구, debug.firebase.analytics.app을 `.none.`으로 복구, 테스트 APK 삭제, Wake Drive 앱 재실행.
- 광고 시청→잠금 해제, 경고 영상 실제 재생 및 GPS 속도 항목의 서버 도착은 해당 실기 동작을 추가로 수행해야 확인할 수 있다. 코드·단위 검증 결과와 서버 수신 검증 범위를 구분한다.

공식 자료: [Android 설정](https://firebase.google.com/docs/android/setup), [수집 제어](https://firebase.google.com/docs/analytics/android/configure-data-collection), [DebugView](https://firebase.google.com/docs/analytics/debugview), [이벤트 매개변수](https://developers.google.com/analytics/devguides/collection/ga4/event-parameters).

## 0.1.9 사용자 이용 선호 확장

설정 선호 5개, 영상 노출·실제 시청·중도 종료, 감지 시작 결과를 추가했다. 추가 정의 14개 등록, 140개 자동 테스트 및 실기 속성 검증 1개 통과, 실제 preferences_snapshot 서버 수신 확인. 상세 기준과 미검증 UI 항목은 [사용자 이용 선호 분석](USER_PREFERENCE_ANALYTICS.md)을 따른다.

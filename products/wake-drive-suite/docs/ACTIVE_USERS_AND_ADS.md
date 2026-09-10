# 활성 사용자와 광고 카운트 확인 방법

2026-09-10 · Android 0.1.11 / versionCode 12

## 활성 사용자, 앱 실행, 세션

Firebase Analytics SDK를 연결했고 앱 실행·사용자 참여 이벤트 수신을 확인했다. 활성 사용자 통계는 앱이 별도의 DAU 카운터를 올리는 방식이 아니라 GA4가 SDK 이벤트와 사용자 식별을 바탕으로 계산한다.

| 보고 싶은 값 | 확인 기준 | 주의 |
|---|---|---|
| DAU | 최근 24시간 활성 사용자 | 하루 동안 반복 실행해도 같은 식별자는 중복 제거 |
| WAU | 최근 7일 활성 사용자 | DAU 7일치를 더한 값이 아님 |
| MAU | 최근 30일 활성 사용자 | DAU 합계가 아니며, 달력 월별 사용자 보고서와 기간 기준이 다름 |
| DAU/MAU | 기간별 활성 사용자 비율 | GA4 사용자 재방문 빈도 지표 |
| 앱 실행 횟수 | 앱 `app_open` 이벤트 수 | JavaScript 실행 인스턴스의 첫 활성화 기준. 홈 복귀 횟수가 아님 |
| 세션 | SDK `session_start`, 세션 측정항목 | 앱 실행 횟수와 다를 수 있음 |
| 신규 사용자 | SDK `first_open` 기반 신규 사용자 | 재설치·동의 초기화·기기 변경은 식별에 영향을 줄 수 있음 |

출처: [Google 사용자 재방문 빈도 정의](https://support.google.com/analytics/answer/12993725?hl=ko), [사용자 측정항목](https://support.google.com/analytics/answer/12253918?hl=ko), [세션](https://support.google.com/analytics/answer/12798876?hl=ko).

Firebase/GA4의 보고서 → 참여도/유지율 또는 Firebase 개요에서 활성 사용자와 기간별 사용자 활동을 본다. 메뉴 배치는 보고서 컬렉션 설정에 따라 다를 수 있다. DebugView는 테스트 이벤트 전달 확인 화면이며 DAU·MAU 운영 보고서가 아니다. 연결 초기 테스트 기기 몇 대만으로 운영 MAU가 검증됐다고 판단하지 않는다.

수집은 Android Wake Drive의 **이용 통계 동의 ON**인 설치본 기준이다. 미동의 사용자까지 포함한 전체 설치자 수가 아니다. 현재 로그인 User-ID를 보내지 않으므로 여러 기기의 한 사람을 계정 단위로 합치지 않는다.

## 광고 이벤트 — 0.1.11 추가 4개

| 이벤트 | 카운트 발생 조건 | 의미 |
|---|---|---|
| `ad_request` | 앱의 광고 표시 함수 진입 | SDK 내부 자동 재요청·배너 갱신 요청 전부를 의미하지 않음 |
| `ad_shown` | 배너: SDK AdImpression / 전면·보상형: SDK Showed | 실제 표시 콜백. 단순 로드 성공이나 버튼 클릭을 노출로 세지 않음 |
| `ad_reward_earned` | 유효한 SDK 보상(amount > 0) 획득 | 보상 조건 충족 횟수. 광고 영상 전체 프레임·초 단위 시청 측정은 아님 |
| `ad_failed` | 초기화·로드·표시 실패 또는 보상 대기 시간 초과 | 실패 단계는 failure_stage로 구분. 사용자 닫기는 실패로 추가 기록하지 않음 |

공통 매개변수:

- `ad_format`: banner / interstitial / rewarded.
- `ad_placement`: bottom_banner / menu / video_unlock.
- `ad_test`: test / live. 명시적 테스트 플래그 또는 Google 샘플 광고 ID 사용 시 test. 현재 개발 기본값은 test이다. live는 앱 설정상 운영 단위를 뜻하며 광고 공급자 측 별도 테스트 기기 설정까지 판별하는 값은 아니다.
- `video_id`: Wake Drive 영상 해제용 보상 광고에만 video-0~video-10 연결.
- 오류 시 `failure_stage`: initialize / load / show / timeout. 감지 준비 이벤트도 사용하는 키이므로 이벤트 이름을 함께 필터링한다.

전면·보상형은 같은 시도의 중복 표시/보상 콜백을 1회로 제한한다. 보상 콜백과 Promise가 모두 도착해도 보상은 1회다. 배너는 SDK가 기록한 갱신 노출도 각각 센다. 배너 실패는 앱 표시 시도당 1회로 제한하므로 AdMob 서버 실패 요청 전체와 같지 않다.

기존 `reward_ad_result`(rewarded/cancelled/error), `video_unlocked`, `video_apply`는 유지한다. 보상형 API가 false로 반환하는 실패가 기존 결과에서는 cancelled에 포함될 수 있으므로 기술 오류는 새 `ad_failed`와 함께 확인한다. 보상 획득 → 영상 다운로드·보유 저장 성공 → 적용은 별도 단계다.

## 보고서에 넣을 지표

| 지표 | 이벤트 필터 / 측정항목 |
|---|---|
| 광고를 본 횟수 | ad_shown / 이벤트 수, ad_format별 분리 |
| 광고를 본 사용자 수 | ad_shown / 총 사용자 수. 이벤트 수와 구분 |
| 사용자당 광고 표시 수 | 같은 기간·필터의 ad_shown 이벤트 수 ÷ 해당 이벤트의 총 사용자 수 |
| 보상 조건 충족 수·사용자 수 | ad_reward_earned / 이벤트 수·총 사용자 수 |
| 영상별 광고 보상 획득 | ad_reward_earned / video_id |
| 잠금 해제 성공 | video_unlocked / video_id |
| 광고 처리 실패 | ad_failed / ad_format, failure_stage |

GA4 탐색에서 이벤트 이름, 광고 형식, 광고 표시 위치, 광고 테스트 구분, 영상 ID를 가져오고 이벤트 수·총 사용자 수를 추가한다. 운영 광고 표는 `ad_test=live`로 필터링한다. 테스트 기기 검증은 `ad_test=test`로 확인한다. 분모가 0인 비율은 측정 없음으로 표시한다.

SDK 자동 `ad_impression`과 앱 `ad_shown`을 합산하면 중복될 수 있으므로 한 지표의 기준을 하나로 정한다. AdMob 광고 매출·클릭·eCPM은 이번 커스텀 이벤트로 생성하지 않는다. 실제 광고 수익 보고는 운영 AdMob 앱 연결·광고 단위·수익 수신을 별도로 검증해야 한다. [공식 광고 수익 측정 안내](https://firebase.google.com/docs/analytics/measure-ad-revenue)

## 연결·검증 현황

- 코드: [ads.ts](../src/ads.ts), [adAnalytics.ts](../src/adAnalytics.ts), [analyticsCore.ts](../src/analyticsCore.ts), [DriverAnalyticsPlugin.java](../native/jolbang/android/app/src/main/java/com/hjsolution/suha/driver/DriverAnalyticsPlugin.java).
- GA4 속성 553479695에 이벤트 범위 맞춤 정의 ad_format / ad_placement / ad_test 등록 확인. 전체 맞춤 측정기준 19개(이벤트 14·사용자 5), 기존 측정항목 12개와 계산 지표 1개 유지.
- failure_stage 표시 이름을 ‘처리 실패 단계’로 변경하고 감지·광고 단계 설명을 함께 기록.
- [광고 회귀 테스트](../tests/adAnalytics.test.ts) 8개 포함 전체 22개 파일 156개 테스트 통과. 실제 광고를 공급받는 테스트가 아니라 SDK 콜백을 모사한 단위 테스트이다.
- TypeScript 및 Android 0.1.11 빌드 통과, 연결 휴대폰 업데이트 설치와 versionCode 12 확인.
- 실기 배너의 bannerAdImpression → DriverAnalytics.logEvent(ad_shown, banner / bottom_banner / test) 전달을 기기 로그에서 확인.
- **SERVER_RECEIVED**: 12:37~12:39 실제 배너 `ad_shown` 3건 및 `ad_request` 1건을 Firebase DebugView에서 확인. ad_shown의 ad_format=banner, ad_placement=bottom_banner, ad_test=test 값도 각각 확인. 앱 실행(app_open)과 기존 사용자 참여(user_engagement) 수신도 확인했다. 이 결과는 광고 공급과 SDK 콜백을 거친 실제 배너 확인이며 합성 광고 노출 전송이 아니다.
- 전면·보상형 실제 표시/보상 이벤트의 서버 수신과 운영 광고 매출은 별도 실기 검증 필요. 앱 코드·테스트 성공을 운영 광고 검증 완료로 대신하지 않는다.
- 검증 후 Firebase 디버그 플래그를 `.none.`으로 해제하고 앱 재실행 확인. 기존 이용 통계 동의와 영상 보유 설정은 변경하지 않았다.

기존 연결 및 전체 수집 원칙은 [Firebase 개발 인수인계](FIREBASE_HANDOFF.md)를 따른다. 광고 통계도 같은 동의·철회·허용 목록을 통과하며 카메라 영상·GPS 좌표·원문 오류·광고 단위 ID를 추가 전송하지 않는다.

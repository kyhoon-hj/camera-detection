# Wake Drive Google Play 릴리스 준비

기준 앱은 최신 Wake Drive 1.0.0 / versionCode 27 / com.hjsolution.jolbang이며 로컬 AdMob을 복구했다. Play Console 최대 versionCode는 업로드 전에 확인한다.

## 1. Play Console에서 먼저 확인할 것

1. 기존 앱 목록에 `com.hjsolution.jolbang`이 있는지 확인한다.
2. 없다면 앱 생성 과정에서 Play App Signing을 사용한다.
3. 2026년 Android 개발자 인증의 패키지 이름 등록 화면이 나타나면 새 키를 임의로 만들기 전에 안내를 따른다. 이 패키지는 개발 기기에 디버그 서명 APK로 설치된 적이 있으므로, 콘솔이 기존 서명 인증서 소유권 증명을 요구하는지 먼저 확인해야 한다.
4. 첫 배포는 프로덕션보다 내부 테스트 트랙에서 검증한다.

공식 문서: [앱 생성 및 설정](https://support.google.com/googleplay/android-developer/answer/9859152), [앱 서명](https://developer.android.com/studio/publish/app-signing), [App Bundle 업로드](https://developer.android.com/studio/publish/upload-bundle), [패키지 이름 등록](https://support.google.com/googleplay/android-developer/answer/16761053)

## 2. 업로드 키 연결

Play Console에서 기존 앱/키 상태를 확인한 후 업로드 키를 생성하거나 지정한다. 키 파일과 비밀번호는 저장소에 커밋하지 않는다.

최신 환경변수 서명 방식을 사용한다. WAKE_UPLOAD_STORE_FILE(기존 키 절대 경로), WAKE_UPLOAD_STORE_PASSWORD, WAKE_UPLOAD_KEY_ALIAS, WAKE_UPLOAD_KEY_PASSWORD를 실행 프로세스에 설정한다. 비밀번호를 명령 이력에 직접 쓰지 않는다. 로컬 keystore.properties는 보존하지만 현재 Gradle에서 읽지 않는다. 새 키를 생성하거나 기존 키를 교체하지 않았다.

`keystore.properties`, `*.jks`, `*.keystore`는 Git 제외 대상이다. 업로드 키와 비밀번호는 별도의 안전한 보관소에 백업한다.

## 3. 서명된 AAB 생성

```powershell
npm run android:bundle:jolbang
```

성공 결과는 `releases/wake-drive-release.aab`이다. 릴리스 서명이 없으면 빌드는 명시적으로 실패한다. 업로드 전 `versionCode`가 Play Console의 기존 최대값보다 큰지 확인한다.

## 4. 초기 업로드 순서

1. Play Console에서 앱의 내부 테스트 트랙을 연다.
2. 새 릴리스를 만들고 `wake-drive-release.aab`를 업로드한다.
3. Play App Signing 및 업로드 인증서가 예상한 키인지 확인한다.
4. 필수 앱 콘텐츠, 데이터 보안, 개인정보처리방침, 광고 포함 여부, 스토어 등록정보를 완료한다.
5. 내부 테스터 설치와 핵심 기능을 검증한 뒤 다음 트랙으로 승격한다.

AAB 업로드는 파일을 Google에 전송하고 릴리스 초안을 변경하는 작업이므로 실행 직전에 확인한다. 프로덕션 출시도 별도 확인 후 진행한다.

## AdMob 복구와 제출 전 확인

- 앱 ID: ca-app-pub-3432387659713259~3617939047
- 배너: ca-app-pub-3432387659713259/3119597241
- 전면: ca-app-pub-3432387659713259/5829521064
- 보상형: ca-app-pub-3432387659713259/4049535537
- 광고 단위 ID는 로컬 .env.jolbang에서 읽는다. VITE_ADMOB_TESTING=false는 출시 광고 설정이며 개발 서버는 테스트 광고를 강제한다. 기기 디버그 검증 빌드는 VITE_ADMOB_TESTING=true로 실행한다.
- 배너는 홈에만 표시하고 전면 광고는 홈에서 감지 화면으로 이동하기 전에 3분 간격으로 표시한다. 기본 영상 12편은 무료로 유지한다. 보상형 API는 복구했지만 기본 영상을 다시 잠그지 않았다.
- UMP 동의 확인 후 광고를 요청하며 홈 설정에서 광고 개인정보 설정을 제공한다. AdMob 콘솔의 동의 메시지와 광고 단위 상태를 확인한다.
- public/app-ads.txt 게시자 ID를 수정했다. 개발자 웹사이트 루트 게시는 별도다.
- 광고 포함 여부와 데이터 보안 신고는 [Google SDK 데이터 공개 안내](https://developers.google.com/admob/android/privacy/play-data-disclosure)에 맞춘다. 공개 개인정보처리방침 게시도 별도다.
- 기존 스토어 이미지의 GPS 및 영상 잠금 UI는 최신 앱으로 다시 캡처해야 한다.
- Verify-OfflineRelease.ps1 및 무광고 검증 기록은 광고 복구 빌드의 근거로 사용하지 않는다.

## 이번 작업 검증

- 타입 검사와 기존 테스트 169개, 광고 테스트 9개 통과. 광고 테스트는 동의 미허용·오프라인·홈 이탈 시 배너 취소·전면 광고 종료 대기·로딩 시간 제한·보상 검증을 포함한다.
- 웹 빌드와 Capacitor Android 동기화, `gradlew.bat :app:assembleDebug --console=plain --max-workers=2 --no-daemon` 통과. 최종 Android 빌드 로그는 `.runtime/admob-android-build.log`에 보관한다. APK는 `native/jolbang/android/app/build/outputs/apk/debug/app-debug.apk`이며 출시 광고 설정으로 컴파일한 debug 서명 검증본이다.
- 기본 Java 11 대신 설치된 Android Studio JBR 21을 빌드 프로세스에 지정했다. 시스템 전역 설정은 변경하지 않았다.
- 서명 환경변수가 없는 경우 AAB 명령이 즉시 실패하는 것을 확인했다. 이후 업로드 키로 서명한 versionCode 27 AAB를 생성하여 Google Play 내부·비공개 테스트에 게시하고 프로덕션 검토에 제출했다.
- 실제 기기의 테스트 광고 노출·동의 화면·감지 전환을 확인했다. 프로덕션은 2026-09-11 현재 Google 검토 중이며 승인 후 AdMob에서 공개 스토어 앱 연결과 앱 준비 상태 검토를 완료해야 한다.

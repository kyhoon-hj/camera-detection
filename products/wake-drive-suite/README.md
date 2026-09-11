# Wake Drive 1.0.0 · AdMob 복구 작업본

2026-09-11 · Android versionCode 27 · com.hjsolution.jolbang

최신 버전에 로컬 AdMob SDK와 앱·광고 단위 ID를 복구했습니다. 위치 권한·GPS·Firebase Analytics는 제거 상태를 유지합니다. 기본 영상 12편은 무료이며 감지는 기기에서 처리합니다. 광고에 인터넷·네트워크 상태·광고 ID 권한을 사용합니다. [스토어 업로드 준비](docs/PLAY_STORE_RELEASE.md)를 참조하세요.

`npm run android:bundle:jolbang`은 WAKE_UPLOAD_* 서명 환경변수를 확인하고 releases/wake-drive-release.aab를 생성합니다. versionCode 27의 서명 AAB를 Google Play 내부·비공개 테스트에 게시했고 프로덕션 검토에 제출했습니다. 아래 기기·무광고 검증과 산출물 기록은 이전 1.0.0의 이력이며 이번 광고 복구 빌드의 결과가 아닙니다.

현재 debug APK를 연결된 SM-F711N에 업데이트했습니다. 운영자 에이치제이솔루션, 문의 hjshub@jnmdisplay.com, 정책 https://www.hjshub.com/privacy 를 앱과 Play Console에 반영했습니다. 프로덕션은 Google 검토 중이며 승인되면 관리형 게시 없이 자동 출시됩니다. AdMob 앱 확인과 스토어 연결은 프로덕션 공개 후 진행합니다.

## 최신 화면

- 최신 로고와 언어별 카메라 배치 가이드 유지.
- 영어 Rest stop fairy / Rock Star, 한국어 10편 경고 영상. Rock Star는 제공된 원본 MP4 그대로입니다.
- 경고 영상 전체화면과 흰색 음영 유지. 실시간 촬영 영역은 6:5, 일반 화면 높이의 최대 48%입니다.
- 카메라 선택·복구 및 장치 이름 표시. 언어는 홈 설정에서만 변경합니다.
- 개인정보 처리 안내 추가. 감지 모드에서 GPS·언어·통계 설정 제거.

## 실행과 빌드

[웹 미리보기](http://127.0.0.1:5220/) · Start-WakeDrive.cmd로 올바른 기존 서버를 재사용합니다.

```powershell
.\Build.ps1 -Android
.\Build-Release.ps1 -AllowUnsigned
```

의존성이 없으면 첫 명령에 -Install을 추가합니다. 각 스크립트는 PC 공용 빌드 게이트를 사용합니다. JDK 21, Android SDK 36 환경에서 확인했습니다. 업로드 키를 직접 만든 후 Invoke-SignedRelease.ps1을 실행하면 숨김 비밀번호 입력으로 출시 빌드를 만들 수 있습니다. 자동 키 생성이나 암호 저장은 하지 않습니다.

## 이전 무광고 버전 검증 이력

- 24개 파일 / 169개 테스트, 타입 검사, 웹 빌드, debug/release APK 및 release AAB 빌드 통과.
- APK 2개와 AAB에서 위치·인터넷·광고 ID 권한 및 Firebase/AdMob SDK 클래스가 없는 것을 확인했습니다. release APK는 디버그 불가 상태입니다.
- 최신 1.0.0 / 27 휴대폰 업데이트·실행 및 연락처 표시 확인. 앞선 26 빌드에서 전면 카메라 연결, 정상 감지 상태와 타이머 진행, 감지 종료·홈 복귀 확인. Rest stop fairy 미리보기에서 재생 중 컨트롤 확인.
- 원본 326개 파일 및 Git 변경 상태 보존. APK 웹 자산 111개 일치, Rock Star 원본 해시 일치, 5220 서버와 주요 자산 HTTP 200.
- 실제 운전 감지 정확도, 장시간 동작, 전체 PiP 수명주기, 실제 음성 출력 및 Play에서 설치한 최종 서명본은 아직 검증하지 않았습니다.

근거: docs/store-release-build.log, docs/OFFLINE_RELEASE_EVIDENCE.json, docs/PHONE_INSTALL_EVIDENCE.json, docs/RESTORE_EVIDENCE.json. Verify-Latest.ps1과 Verify-OfflineRelease.ps1은 공용 게이트 안에서 실행합니다. OfflineRelease 검증 스크립트의 현재 대상은 미서명 산출물입니다.

## 출시 파일

- releases/wake-drive-debug.apk: 휴대폰 시험용 debug 서명.
- releases/wake-drive-1.0.0-release-unsigned.aab: 미서명 검토용 AAB, 업로드 불가.
- releases/wake-drive-1.0.0-release-unsigned.apk: 미서명 출시 APK, 직접 설치 불가.
- store/google-play 폴더: 아이콘 PNG, 개인정보처리방침 HTML 초안, 출시-인계.md.

## 원본과 이력

최신 0.1.19 작업본을 C:\Users\김영화\Documents\Codex\2026-09-09\new-chat\outputs\camera-detection-handoff\products\wake-drive-suite에서 미커밋 변경까지 포함해 독립 복구한 프로젝트입니다. 원본은 수정하지 않았습니다. 이전 WakeDrive-Final은 0.1.12 사본 기반이므로 이후 개발에는 WakeDrive-Latest를 사용합니다.

0.1.20~0.1.24 변경 및 당시 검증 결과는 docs/README-before-1.0.0.md, 최초 원본 문서는 docs/SOURCE_README.md에 보존했습니다. 이전 문서의 GPS·통계 설명은 현재 동작이 아닙니다. 광고 복구 상태는 PLAY_STORE_RELEASE.md를 참조합니다.


# Wake Drive · 최신 작업본 복구

2026-09-11 · **0.1.20 / Android versionCode 21**

실제 최신 0.1.19 작업 폴더 `C:\Users\김영화\Documents\Codex\2026-09-09\new-chat\outputs\camera-detection-handoff\products\wake-drive-suite`에서 미커밋 변경과 새 파일까지 포함해 독립 복구했습니다. 이전 `WakeDrive-Final`은 0.1.12 사본을 기반으로 했으므로 이후 개발은 이 `WakeDrive-Latest`를 사용합니다.

- 라임색 안경·분홍색 미소 로고, Android 아이콘·스플래시를 포함합니다.
- 졸음 감지 시작 시 한국어/영어 이미지 가이드를 표시합니다. 원본에 생성돼 있던 언어별 PNG를 실제 팝업에 연결했습니다. 기존 ‘그만 보기’ 설정은 유지합니다.
- 기존 앱 언어 설정을 사용합니다. 한국어 10편, 영어는 Rest stop fairy와 **Rock Star(락스타)** 2편입니다. 별도 영상 언어 설정은 없습니다.
- 락스타는 제공된 MP4 원본 그대로이며 영어 목록·선택·적용·랜덤 경고에 연결했습니다. 기존 광고 잠금 해제와 보유 기록을 유지합니다.
- 최신 카메라 재생 복구, 촬영 중 언어 변경, Android 권한·PiP 번역 등 원본 작업을 함께 가져왔습니다.

## 실행

[웹 미리보기](http://127.0.0.1:5220/)

프로젝트 루트의 `Start-WakeDrive.cmd`를 실행하면 미리보기가 열립니다. 같은 프로젝트 서버가 있으면 재사용하고 다른 프로그램이 포트를 점유하면 중단합니다. APK는 `releases/wake-drive-debug.apk`입니다.

```powershell
.\Build.ps1 -Install -Android
.\Start-App.ps1
```

의존성이 설치돼 있으면 `-Install`을 생략합니다. Build.ps1은 PC 공용 리소스 게이트를 거쳐 테스트, 타입 검사, 브랜드 생성, 웹 빌드, Android 동기화·단위 테스트·APK 빌드를 순서대로 실행합니다. Android SDK와 JDK 21이 필요합니다.

## 확인 결과

- 웹 테스트 26개 파일 / 181개 통과, TypeScript 검사 및 웹 빌드 통과.
- Android 단위 테스트 1개와 디버그 APK 빌드 통과. 패키지 `com.hjsolution.jolbang`, 버전 0.1.20 / 21 확인.
- 브라우저에서 새 로고, 한국어 10편·영어 2편, 양쪽 언어 가이드 이미지 표시를 확인했습니다. 390px 화면에서 가로 넘침이 없습니다.
- 원본 326개 파일 해시와 Git 변경 상태 보존, APK의 웹 자산 112개 일치, 5220 서버 경로와 주요 파일 HTTP 200 확인.
- 실제 Android 설치·카메라 감지·PiP·광고 보상·실제 음성 출력은 이번 복구에서 기기 검증하지 않았습니다.

근거는 `docs/SOURCE_SNAPSHOT.json`, `docs/RESTORE_EVIDENCE.json`, `docs/latest-build.log`에 있습니다. 원본 README 이력은 `docs/SOURCE_README.md`입니다.

`Verify-Latest.ps1`은 공용 게이트 안에서 실행해 원본 보존, APK 자산 일치와 실행 서버를 다시 확인할 수 있습니다.

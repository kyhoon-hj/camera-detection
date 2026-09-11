# Wake Drive current working copy

- 최종 기준은 `C:\Users\김영화\Documents\Codex\2026-09-09\new-chat\outputs\camera-detection-handoff\products\wake-drive-suite`의 0.1.19 작업 트리다. 커밋되지 않은 변경도 포함하며 docs/SOURCE_SNAPSHOT.json을 참조한다.
- 이전 jolbang-apps 및 WakeDrive-Final은 최종 소스가 아니다. 이전 자료로 현재 파일을 덮어쓰지 않는다.
- 원본 작업 트리와 이전 재구축본을 보존한다. 언어는 기존 src/language.ts를 사용한다. 별도 영상 언어 모드를 만들지 않는다.
- 한국어는 10편, 영어는 휴게소 안내요정과 락스타 2편이다. 1.0.0부터 모든 기본 영상을 광고 없이 제공하며 이전 적용 영상과 사용자 언어/숨김 설정을 보존한다.
- 위치 권한/GPS, 광고 SDK, Firebase Analytics를 다시 도입하지 않는다. 모델/WASM/영상은 앱 내 파일만 사용하며 Android INTERNET 권한도 제거한다. 출시 서명키는 외부 환경변수로 설정한다.
- 언어 선택은 홈 설정에서만 표시한다. 감지 모드 설정에서는 준비/측정/종료 상태 모두 언어 선택을 표시하지 않는다.
- 사용자 지정 공유 게이트를 Build.ps1에서 단계별 적용한다. 테스트/Gradle workers 최대 2. 다른 프로젝트의 서버나 DB를 중단하지 않는다.
- 앱 ID com.hjsolution.jolbang과 저장 접두사를 유지한다. 현재 앱의 포트는 5220이며 소유 경로를 확인한다.
- 빌드와 실제 기기 감지/경고/PiP 검증을 구분한다.

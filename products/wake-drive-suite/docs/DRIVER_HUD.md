# 촬영 화면 계기판·그래프·글꼴 개선

2026-09-10 요청: 샘플 촬영 이미지의 속도, 부드러운 그래프와 글꼴을 고려해 실제 감지 화면 개선.

- 카메라 위에 현재 GPS 참고 속도(km/h), 측정 시간, 얼굴 인식 상태를 배치. 경고 영상 중에는 계기판을 숨겨 영상 경고를 우선함.
- 기본 GPS는 꺼짐. 출발 전 `GPS 속도 표시 켜기` 또는 설정에서 켤 때만 운영체제 위치 권한을 요청. 위치 권한 거부나 미지원은 감지를 막지 않음.
- 기기가 제공한 `coords.speed`만 km/h로 변환. 수치 없음·오류·15초 이상 갱신 중단은 `—`와 이유 표시. 실제 0 m/s만 0 km/h로 표시하며 위경도 차이로 속도를 만들어 내지 않음.
- 좌표를 저장/전송하지 않음. 숨김 상태에서는 위치 구독 중지, 화면 복귀 시 활성 옵션에 한해 재개. 감지 종료/오류 또는 홈 이동 시 GPS 끔. 설정은 영구 저장하지 않음.
- 졸방 Android 앱에 전경 coarse/fine 위치 권한 선언. 기존 Capacitor BridgeWebChromeClient가 런타임 위치 권한을 처리함. 백그라운드 위치 권한은 추가하지 않음.
- 졸음 신호 그래프는 측정 지점 사이를 곡선으로 연결하고 그라데이션 면 채움 적용. 양끝 값 범위 내 제어점을 사용하며 실제 위험/이벤트 마커와 판정 임계값은 유지. 데이터 없는 화면에 가짜 파형은 만들지 않음.
- 한글 Noto Sans KR, 숫자 Space Grotesk를 앱에 포함. 글꼴 외부 호출 없이 표시하며 각 OFL 라이선스를 `public/fonts/`에 함께 보관. 열공 UI에는 적용하지 않음.
- 기존 광고 시청 잠금 해제 → 다운로드 → 직접 적용 및 감지 시작 절차 유지.

## 검증과 한계

- 기존 회귀와 GPS 테스트 총 111개 통과. 속도 변환, 실제 정지 0, null/음수/오래된 값, 권한 거부, 갱신 중단, 종료 후 늦은 콜백 무시 검증.
- 브라우저 390×844 및 844×390에서 미측정 속도/측정 시간/시작 버튼 표시와 가로 넘침 없음 확인. 글꼴 파일 HTTP 제공 및 계기판 폰트 지정 확인.
- TypeScript·웹·Android 빌드, APK 자산 일치는 `runtime-evidence.json` 참조.
- 실제 사용자 위치 권한을 허용하거나 주행하지 않음. 실기기 속도 정확도, 촬영 중 계기판/실시간 곡선 및 Android 위치 권한 흐름은 별도 실기기 확인 필요.

참고: [MDN GeolocationCoordinates.speed](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/speed), [Google Fonts Noto Sans KR](https://github.com/google/fonts/tree/main/ofl/notosanskr), [Google Fonts Space Grotesk](https://github.com/google/fonts/tree/main/ofl/spacegrotesk).

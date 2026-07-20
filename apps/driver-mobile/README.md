# 졸음운전

휴대폰 전면 카메라와 MediaPipe 얼굴·자세 랜드마크를 기기 안에서 처리하는 하이브리드 앱입니다. 하나의 React 코드로 웹/PWA, Android, iOS를 지원하며 카메라 영상은 서버로 전송하지 않습니다.

## 동작 순서

1. 사용자가 `5초 측정 후 감지 시작`을 누릅니다.
2. 브라우저의 카메라 권한을 허용합니다.
3. 얼굴, 눈, 코, 양쪽 어깨가 안정적으로 보이는 유효 프레임을 5초간 수집합니다.
4. 개인별 눈 크기, 평상시 고개 각도, 머리·어깨 위치를 기준값으로 확정합니다.
5. 기준 측정이 끝난 뒤에만 졸음, 고개 숙임, 얼굴 이탈, 앉은 자세 감지를 시작합니다.

측정 중 얼굴이나 어깨를 0.45초보다 오래 잃거나 몸을 크게 움직이면 5초 측정을 다시 시작합니다.

## 모바일 화면 구성

- `감지`: 카메라와 현재 운전자 상태를 크게 표시합니다.
- `상세`: 눈, 고개, 3D 자세 측정값을 확인합니다.
- `설정`: 경보음, 한국어 음성 테스트, 기준 재측정과 앱 설치를 관리합니다.

하단 탭과 시작·종료 버튼은 엄지손가락으로 접근하기 쉬운 화면 아래에 고정됩니다.

## 로컬 실행

```powershell
pnpm --filter @suha-ai/driver-mobile dev
```

PC Chrome 테스트 주소: `http://127.0.0.1:5175/`

## 휴대폰 Chrome에서 사용

카메라와 PWA 설치는 보안 컨텍스트에서만 허용됩니다.

- `localhost`와 `127.0.0.1`은 해당 기기 자체에서만 예외적으로 허용됩니다.
- 휴대폰에서 `http://192.168.x.x:5175` 형태로 PC에 접속하면 카메라가 차단됩니다.
- 실제 휴대폰 테스트와 배포에는 유효한 인증서가 적용된 `https://...` 주소가 필요합니다.
- Android Chrome은 메뉴의 `앱 설치`, iPhone Safari는 `공유 → 홈 화면에 추가`로 설치합니다.

## 확인 명령

```powershell
pnpm --filter @suha-ai/driver-mobile test
pnpm --filter @suha-ai/driver-mobile build
```

## Android 설치형 앱

Android Studio와 Android SDK가 설치된 PC에서 다음 명령으로 디버그 APK를 생성합니다.

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
pnpm --filter @suha-ai/driver-mobile android:apk
```

생성 파일: `android/app/build/outputs/apk/debug/app-debug.apk`

Android Studio에서 실제 기기나 에뮬레이터로 실행하려면:

```powershell
pnpm --filter @suha-ai/driver-mobile android:open
```

Android 설치형 앱의 한국어 안내 음성은 WebView의 브라우저 음성이 아니라 Android 시스템 `TextToSpeech`를 사용합니다. 앱 하단의 `한국어 음성 테스트`에서 발화 여부를 바로 확인할 수 있습니다. 테스트가 실패하면 Android 설정의 `글자 읽어주기`에서 한국어 음성 데이터를 설치하거나 기본 TTS 엔진을 선택하세요.

Android 앱은 카메라 프레임 크기 변경으로 인한 MediaPipe 오류를 방지하기 위해 세로 화면으로 고정됩니다. 앱이 백그라운드로 전환되거나 예외적으로 화면 방향이 변경되면 카메라를 즉시 종료하며, GPU 분석 중 복구 가능한 오류가 발생하면 CPU 호환 모드로 한 번 자동 전환하고 기준 측정을 다시 시작합니다.

## iOS 설치형 앱

iOS 프로젝트는 함께 생성되지만 빌드와 서명에는 macOS, Xcode 26 이상, Apple 개발자 설정이 필요합니다.

```bash
pnpm --filter @suha-ai/driver-mobile ios:open
```

이 앱은 실험용 운전 보조 프로토타입이며 인증된 운전자 모니터링 장치가 아닙니다.

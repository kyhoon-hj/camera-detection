# Wake Drive Google Play 업로드 이미지

> 이전 버전 보존 자료입니다. GPS와 영상 잠금 화면은 현재 앱으로 다시 캡처해야 합니다. 최신 아이콘은 ../store/google-play/wake-drive-icon-512.png를 기준으로 합니다.

## 권장 업로드 파일

### 앱 아이콘

- `icon/wake-drive-icon-512-rgba.png`
- 512 × 512, 32-bit RGBA PNG, 1 MB 이하

### 기능 그래픽

- `feature-graphic/wake-drive-feature-1024x500.png`
- 1024 × 500, 24-bit RGB PNG

### 휴대전화 스크린샷

다음 순서로 `screenshots-promotional`의 4개 파일을 업로드한다.

1. `01-drowsiness-detection.png`
   - 대체 텍스트: 졸음 신호 감지 시작과 깨우기 영상 선택 기능이 표시된 Wake Drive 메인 화면
2. `02-video-collection.png`
   - 대체 텍스트: 운전자가 취향에 맞는 깨우기 영상을 고르는 영상 컬렉션 화면
3. `03-on-device-privacy.png`
   - 대체 텍스트: 카메라 영상을 저장하거나 서버로 보내지 않고 기기에서 분석한다는 개인정보 안내
4. `04-alert-settings.png`
   - 대체 텍스트: 경보음과 음성 안내, GPS 속도 표시 등을 조정하는 앱 설정 화면

각 파일은 1080 × 1920, 9:16, 24-bit RGB PNG다. 추가 홍보 문구는 이미지 높이의 20% 이내에 배치되어 있다.

## 보관 파일

- `screenshots/`: 앱에서 직접 캡처한 원본 화면
- `feature-graphic/wake-drive-feature-source.png`: 기능 그래픽 원본
- `icon/wake-drive-icon-512.png`: 변환 전 RGB 아이콘
- `build-promotional-screenshots.ps1`: 홍보형 스크린샷 재생성 스크립트

## 재생성

프로젝트 루트의 PowerShell에서 실행한다.

```powershell
& '.\products\wake-drive-suite\play-store-assets\build-promotional-screenshots.ps1'
```

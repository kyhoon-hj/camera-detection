# Wake Drive 브랜드 이미지 · 2026-09-11

대상 버전: 0.1.16 / Android versionCode 17. 사용자 제공 이미지의 단순한 라임색 안경, 점선 얼굴 윤곽, 분홍색 미소를 기준으로 만든 브랜드입니다.

## 디자인 기준과 원본

- [Stitch 프로젝트](https://stitch.withgoogle.com/projects/7247812042957852926)
- 새 AI 시안: `e9d42cc2f3f54cbc96d5f62fd70d088c`, “Wake Drive 브랜드 에셋 레퍼런스 시트”. 기존 화면은 덮어쓰지 않았습니다.
- 보관한 시안: [PNG](design/stitch-brand-reference.png), [HTML](design/stitch-brand-reference.html).
- 실제 앱의 단일 캐릭터 원본: `public/brand/wake-drive-mascot.svg`. 시안을 참고해 작은 크기에서도 읽히도록 선과 비율을 정리한 벡터입니다.
- 배경 `#292333`, 안경·눈 `#d2f000`, 미소 `#ff9cc5`.

## 적용 범위

- PWA 192/512px 아이콘과 Apple touch icon.
- Android ldpi~xxxhdpi 일반·원형·adaptive foreground/background 런처 아이콘.
- 기존 Android 스플래시의 세로·가로·주간·야간 이미지 전부. 각 리소스의 크기를 유지합니다.
- Android 12 이상 시스템 시작 화면은 같은 배경색과 foreground 캐릭터를 사용합니다. OS가 관리하는 시작 화면은 전체 세로 스플래시 PNG와 구성이 다를 수 있습니다.
- 홈 헤더, 홈 안내 카드, 촬영 대기 캐릭터와 설정·카메라·재생·잠금·소리·종료·눈·고개·시간·GPS 아이콘.
- 작은 화면(PiP)의 측정 종료 아이콘도 둥근 사각형으로 통일했습니다.
- 홈 캐릭터는 작은 각도로 천천히 움직입니다. 기존 효과 멈춤 설정과 OS의 동작 줄이기 설정을 따릅니다.

## 개발·재생성

`src/WakeIcon.tsx`가 공통 기능 아이콘과 캐릭터 컴포넌트를 제공합니다. 기능 아이콘은 24px viewBox, 둥근 선 끝·모서리, currentColor를 사용합니다. 아이콘은 장식 요소로 숨기고 버튼의 기존 텍스트·접근성 이름으로 기능을 설명합니다.

`src/wake-brand.css`는 Wake Drive 화면에 한정해 스타일을 적용합니다. 촬영 화면의 속도·시간 아이콘은 12px로 유지합니다.

```powershell
node scripts/branding.mjs jolbang
npm run android:jolbang
```

첫 명령은 SVG 원본에서 `branding/jolbang` 및 Android 리소스를 생성합니다. 두 번째 명령은 타입 검사, 이미지 재생성, 웹 빌드, Capacitor 동기화, APK 생성을 순서대로 실행합니다. 공유 PC에서는 위 명령을 각각 `Invoke-DevHeavy.ps1` 자원 게이트 안에서 실행하세요.

실제 재생성 원본은 SVG입니다. 생성 PNG를 직접 수정하면 다음 빌드에서 덮어써집니다. 기존 `public/brand/wake-drive-source.png`는 참고용으로 보존하며 새 아이콘 생성에 사용하지 않습니다.

기존 앱 ID와 저장 키, 영상 보유·광고 잠금 해제 절차를 유지합니다. 이전 0.1.15의 영어 영상 정책과 촬영 중 언어 변경도 유지합니다. 열공 브랜드 생성 분기는 기존 방식 그대로입니다.

## 검증 기록

- 생성된 512px 런처 아이콘과 1080×1920 스플래시 PNG를 직접 열어 캐릭터·색상·배치를 확인했습니다.
- `npm run android:jolbang` 통과: TypeScript 검사, Vite 빌드, Capacitor 동기화, Gradle `assembleDebug` 성공. APK 메타데이터는 0.1.16 / versionCode 17입니다.
- 언어·앱 분리 회귀 테스트 2개 파일 / 14개 테스트 통과(최대 2 workers).
- Android 아이콘·스플래시 PNG 50개 디코딩 성공. APK 내부의 새 캐릭터 SVG 및 스플래시 포함 확인. 개발 서버의 캐릭터 SVG HTTP 200 확인.
- `releases/wake-drive-debug.apk` SHA-256: `A9872818D0817F03998F18FF3162E2923F14706573D159CEA4115FA7C2AB701E`.
- 현재 ADB 기기 목록은 비어 있어 이번 버전의 휴대폰 설치와 실제 시작 화면 확인은 미완료입니다.
- 브라우저 자동화 도구가 `failed to write kernel assets` 오류로 초기화되지 않아 이번 변경의 브라우저 화면·클릭 검증은 미완료입니다.

후속 실기 확인: 홈/촬영 대기의 캐릭터, 한국어·영어 설정 버튼, 작은 화면 아이콘, 시스템 원형 아이콘 잘림, 앱 완전 종료 후 재시작 스플래시, OS 다크 모드를 확인하세요. 이번 이미지 변경 검증을 카메라 프레임·졸음 감지 정확도 검증으로 간주하지 않습니다.

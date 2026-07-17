# SuhaAI Core v0.1.0

노트북 RGB 카메라에서 손·상체 특징과 제스처를 인식하고 안정화된 표준 이벤트와 의도를 REST/WebSocket으로 제공하는 로컬 우선 비전 코어입니다. 결제, 키오스크 화면 전환 같은 업무 로직은 코어 밖의 응용 서비스가 담당합니다.

## 현재 범위

- OpenCV 카메라, 영상 파일, 합성 카메라의 공통 입력
- MediaPipe 손·포즈·얼굴 랜드마크(선택 설치)와 합성 회귀 공급자
- 정적 손 모양, 손 흔들기·스와이프·손 들기, 고개 끄덕임·젓기
- START/HOLD/END 안정화, 쿨다운, 모드 필터, YAML 의도 매핑
- FastAPI REST, WebSocket, MJPEG, React 개발 콘솔
- 기본값으로 원본 영상·스냅샷·랜드마크를 저장하지 않음

한국수어 자유 문장 번역과 얼굴 신원 인식은 지원하지 않습니다. 한국수어는 향후 별도 명시적 모드와 모델 플러그인으로만 확장합니다.

## Windows 빠른 시작

```powershell
.\scripts\bootstrap.ps1
.\.venv\Scripts\Activate.ps1
suha-core doctor
suha-core serve
```

별도 터미널에서:

```powershell
pnpm --dir apps/dev-console dev
```

- API: http://127.0.0.1:8200
- OpenAPI: http://127.0.0.1:8200/docs
- Console: http://127.0.0.1:5173
- WebSocket: ws://127.0.0.1:8200/v1/events/stream

카메라가 없는 개발 환경에서는 `synthetic-front` 카메라로 전체 경로를 검증할 수 있습니다. 문제 발생 시 `suha-core doctor`로 Python, OpenCV, MediaPipe, 카메라 상태를 확인하세요.

## API 예제

```bash
curl http://127.0.0.1:8200/v1/health
curl -X POST http://127.0.0.1:8200/v1/cameras/synthetic-front/start
```

## 개발 검증

```bash
python -m pytest
ruff check .
mypy packages/suha-core/src
pnpm -r test
pnpm -r build
```

## 데이터 검증과 정적 제스처 학습

```powershell
suha-core datasets validate .\data\recordings\local-captures-v1
suha-core train-static .\data\recordings\my-static-dataset .\models\custom\my-gesture --model-id my-static-gesture
suha-core train-dynamic .\data\recordings\my-dynamic-dataset .\models\custom\my-motion --model-id my-dynamic-gesture
```

정적 모델 학습 데이터는 최소 두 동작과 익명 사용자 세 명을 포함해야 합니다. 사용자 단위로 학습·검증·시험 데이터를 분리하며, 결과 폴더에 `model.pt`, `model.onnx`, `evaluation.json`, `manifest.json`이 생성됩니다.

## 한국수어 데이터 가져오기

데이터는 자동으로 다운로드하지 않습니다. 정식으로 내려받은 데이터의 이용 조건을 [KSL 라이선스 체크리스트](docs/KSL_DATA_LICENSE_CHECKLIST.md)로 확인한 후 실행합니다.

```powershell
python scripts\import_aihub_ksl.py --dataset-type aihub-sign-video --source "D:\datasets\aihub_ksl" --validate-only
python scripts\import_aihub_ksl.py --dataset-type aihub-sign-video --source "D:\datasets\aihub_ksl" --target ".\data\imports\aihub_ksl_v1" --extract-landmarks --anonymize-metadata --license-confirmed --license-reference "AIHUB-DATASET-TERMS-YYYY-MM-DD"
suha-core train-ksl-baseline .\data\imports\aihub_ksl_v1 .\models\custom\ksl-baseline --model-id ksl-isolated-baseline
```

현재 한국수어 기능은 등록된 제한 단어의 `ISOLATED_SIGN` 실험용 분류만 지원하며 연속 문장 번역은 지원하지 않습니다. 원본 영상은 복사하거나 저장소에 포함하지 않습니다.

## 모델 레지스트리

학습 결과의 `manifest.json` 경로를 `POST /v1/models`에 등록한 뒤 `/validate`, `/activate` 순서로 호출합니다. `GET /v1/models/runtime/providers`에서 사용 가능한 ONNX Runtime provider를 확인할 수 있으며 기본값은 CPU입니다. 체크섬·입력/출력 스키마·코어 버전·provider 검증 또는 warmup 추론에 실패한 모델은 격리되고 기존 활성 모델은 유지됩니다. `POST /v1/models/rollback`으로 이전 모델이나 내장 규칙 모델로 복귀합니다.

## Gemini 카메라 음성 안내

브라우저에 키를 저장하지 않습니다. Google AI Studio에서 새 키를 만든 뒤 서버를 시작한 PowerShell에만 설정하세요. 이미 채팅이나 화면에 노출된 키는 폐기하고 다시 발급해야 합니다.

```powershell
$env:GEMINI_API_KEY="새로 발급한 키"
$env:GEMINI_MODEL="gemini-3.5-flash"
suha-core serve
```

개발 콘솔에서 카메라를 시작하고 `AI 음성 안내 켜기`를 누르면 약 4초 간격으로 현재 프레임 한 장을 분석해 한국어로 안내합니다. `음성 질문`은 마이크로 질문한 뒤 현재 화면을 근거로 답합니다. AI 음성 안내가 꺼져 있고 음성 질문도 하지 않으면 프레임은 Google로 전송되지 않으며, 로컬 손·얼굴 랜드마크 인식은 그대로 동작합니다.

## SDK

```python
from suha_sdk import SuhaClient

with SuhaClient("http://127.0.0.1:8200") as client:
    for event in client.events(categories=["INTENT"]):
        print(event.intent)
```

```ts
import { SuhaClient } from "@suha-ai/sdk";

const client = new SuhaClient({ baseUrl: "http://127.0.0.1:8200" });
const unsubscribe = client.events.subscribe(event => console.log(event.intent));
```

전체 예제는 [Python SDK 예제](examples/python_sdk_events.py)와 [TypeScript SDK 예제](examples/typescript_sdk_events.ts)를 참고하십시오. 두 SDK 모두 이벤트 스키마 `1.0`, 요청 timeout, 구조화 오류, WebSocket 자동 재연결을 지원합니다.

라이선스는 Apache-2.0이며 제3자 구성요소와 모델 자산 고지는 `THIRD_PARTY_NOTICES.md`를 확인하세요.

# Development progress

| Loop | Status | Evidence |
|---|---|---|
| LOOP 00 | Complete | pytest 9 passed; ruff and strict mypy passed; pnpm tests/build passed |
| LOOP 01 | Complete | OpenCV, video-file and synthetic adapters; bounded capture queue; real camera opened and released |
| LOOP 02 | Complete | MediaPipe Tasks hand/pose/face models; overlay; real camera produced landmarks |
| LOOP 03 | Complete | Static landmark rules distinguish the v0.1 labels; raw candidates remain separate |
| LOOP 04 | Complete | START/HOLD/END, short-glance suppression, intent profiles and event contract tests |
| LOOP 05 | Complete | Temporal wave/swipe/raise/head rules, evidence, cooldown and negative distinction test |
| LOOP 06 | Complete | FastAPI REST/WebSocket/MJPEG/metrics, multi-subscriber bus and graceful runtime shutdown |
| LOOP 07 | Complete | Responsive React console, reconnecting WebSocket, browser start/stop E2E and zero console errors |
| LOOP 08 | Complete | Consent-gated capture sessions, countdown/progress UI, landmark JSONL, optional video, anonymized subjects, validation/distribution reports |
| LOOP 09 | Complete | Subject-based splits, logistic baseline, PyTorch MLP, ONNX export/parity, reports, manifest, API registry/hot swap/rollback |
| LOOP 10 | Complete | Window/padding/mask/resampling, TCN, four labels including NONE, ONNX parity, fusion comparison, false-activation and latency report |
| LOOP 11 | External acceptance pending | Three KSL import profiles, license gate, external references, corruption checks, keypoint mapping/extraction, signer split and 2-label baseline smoke test pass on representative fixtures; real licensed sample still required |
| LOOP 12 | Complete | Persistent registry, manifest/schema/core-version checks, checksum, warmup inference, provider selection, atomic activation pointer, rollback, quarantine, audit and model-change events |
| LOOP 13 | Complete | Typed Python/TypeScript clients, schema 1.0 validation, structured timeout/API/connection errors, reconnect backoff, cancellation, examples and API contract tests |
| LOOP 14 | Complete | RGB-D contracts, calibration, alignment, actual-vs-estimated distance sources, mock depth camera, vendor SDK adapter, capabilities API and depth-plugin integration |
| LOOP 15 | Pending | Packaging, deployment and operational verification; LOOP 11 real-dataset acceptance remains an explicitly tracked external risk |

Hardware validation is reported separately from deterministic synthetic-camera tests.

Pen edge tracking now preserves 16:9 input geometry, supplies MediaPipe with a 10% context border, and reconnects a nearby same-hand pointer after short bottom/outer-frame loss without bridging a large coordinate jump.

## LOOP 00–07 completion report

- Implemented: laptop/video/synthetic cameras, MediaPipe Tasks landmarks, static and temporal recognition, stabilization, intent mapping, REST/WebSocket/MJPEG, development console.
- Commands: `python -m pytest`, `ruff check .`, `mypy packages/suha-core/src`, `pnpm -r test`, `pnpm -r build`, `suha-core doctor`, `suha-core serve`.
- Automated result: 9 Python tests, 2 Vitest tests, Ruff and mypy all pass; both TypeScript packages build.
- Runtime result: the 60-second synthetic soak captured 1,759 frames and inferred 1,541, with 218 expected `DROP_OLDEST` drops; traced retained-memory growth was about 1.10 MB (8.05 MB peak); stop returned and the handle was closed.
- Hardware result: Windows 11 laptop camera opened; 65 frames captured and 24 inferred in a 3-second pre-resize check; `OPEN_PALM` was recognized; the camera handle was released.
- Browser E2E: synthetic camera showed MJPEG overlay at 29.7 FPS and delivered `THUMB_UP HOLD -> CONFIRM` and `HAND_WAVE -> WAKE_UP`; stop returned `STOPPED`; browser console had zero errors.
- Remaining risk: three MediaPipe Tasks on CPU measured about 8 FPS before analysis-frame resize. Performance depends on laptop hardware and needs a longer benchmark after the resize optimization. Real-person swipe and head-motion accuracy still needs a recorded manual test matrix.
- LOOP 08 result: API integration collected 20 `HAND_WAVE` landmark samples, produced no MP4 with video disabled, and the dataset CLI detected corrupted JSONL. The capture API uses fresh feature timestamps and event persistence no longer blocks inference.
- LOOP 08 verification: 15 Python tests, Ruff, strict mypy, Vitest, and the production console build all pass.
- LOOP 09 result: static landmark training creates train/validation/test splits by anonymous subject, compares a logistic baseline, exports PyTorch and ONNX artifacts, writes evaluation/manifest/checksum metadata, and combines an activated user model with the built-in rule recognizer.
- LOOP 09 verification: API registration, validation, activation without restart, built-in-rule rollback, and identical-sample PyTorch/ONNX tolerance tests pass.
- Current full gate: 17 Python tests, Ruff, strict mypy, Vitest, and the production console build all pass.
- LOOP 10 result: dynamic capture sessions become masked/resampled 65-feature windows; a lightweight TCN supports `HAND_WAVE`, `SWIPE_LEFT`, `SWIPE_RIGHT`, and `NONE`; ONNX runtime plugs into rule/model fusion.
- LOOP 10 verification: subject-excluded rule/model/fusion metrics, false-activation rates, approximate latency, and identical-sample PyTorch/ONNX tolerance tests pass.
- Current full gate: 18 Python tests, Ruff, strict mypy, Vitest, and the production console build all pass.
- LOOP 11 implementation: AI Hub sign-video, AI Hub disaster-safety, and NIKL parallel-corpus profiles; validate-only/import CLI; explicit license confirmation; no source-video copying; anonymous signer splits; existing-keypoint mapping; optional MediaPipe video extraction; validation/statistics reports; isolated-sign baseline command.
- LOOP 11 verification: representative 3-signer/2-label fixtures pass validate, import, core dataset validation, leakage-safe splitting, PyTorch/ONNX baseline training, KSL runtime activation, and disabled-feature server health tests.
- Current full gate: 21 Python tests, Ruff, strict mypy, Vitest, and the production console build all pass.
- Remaining LOOP 11 acceptance: run the importer against an actual user-downloaded licensed sample and add/adjust a mapping profile if that release differs. LOOP 12 proceeded at the user's explicit direction with this risk retained.
- LOOP 12 result: model catalog and active pointer persist atomically, startup restores the active model, validation checks identity/checksum/task/input/output/core version/provider, warmup performs real inference, failures quarantine the candidate without replacing the active model, and every activation/rollback emits an audit record and standard model event.
- LOOP 12 verification: corrupted ONNX activation and incompatible `[batch, 64]` static input were blocked and quarantined; the prior model remained active across server restart; CPU provider discovery, activation event, and rollback tests pass.
- Current full gate: 21 Python tests, Ruff, strict mypy, Vitest, and the production console build all pass.
- LOOP 13 result: Python dataclasses and TypeScript interfaces expose camera/event contracts; both SDKs enforce schema `1.0`, map API/connection/timeout/schema failures, reconnect WebSockets with bounded exponential backoff, support category/camera subscriptions, and provide cancellable/closable clients.
- LOOP 13 verification: Python HTTP/error/schema/reconnect tests, real FastAPI camera-contract parsing, TypeScript HTTP/error/schema/reconnect/timeout tests, both package builds, and minimal example apps pass.
- Current full gate: 24 Python tests, 4 TypeScript SDK tests, 1 console test, Ruff, strict mypy, TypeScript SDK build, and console production build all pass.
- Environment note: the bundled root-level pnpm launcher path is currently missing, so equivalent package-local npm scripts were executed successfully instead.
- LOOP 14 result: camera capabilities and calibration are explicit contracts; mock RGB-D frames carry aligned uint16 depth and calibration; actual sensor depth is labeled `ACTUAL_DEPTH` while monocular estimates are labeled `RGB_ESTIMATED_Z`; vendor SDKs plug in behind a backend protocol; and depth recognizers receive the same frame/features pipeline without changing RGB recognizers.
- LOOP 14 verification: mock depth alignment/distance, vendor adapter, depth-recognizer integration and capabilities API tests pass; the RGB synthetic camera remains depth-free and all prior tests pass.
- Current full gate: 28 Python tests, 4 TypeScript SDK tests, 1 console test, Ruff, strict mypy, TypeScript SDK build, and console production build all pass.
- Hardware note: no physical RGB-D device is required for LOOP 14 acceptance; vendor-specific alignment and calibration remain device validation work when hardware is selected.
- Live-camera follow-up: synthetic and real-camera histories are now separated in the console, only confirmed intents are shown by default, and stationary raised hands no longer emit repeated `RAISE_HAND` events. A no-hand physical-camera check held the confirmed timeline at zero events.
- Current full gate after live-camera stabilization: 30 Python tests, Ruff, strict mypy, console Vitest and console production build pass.
- Landmark overlay follow-up: the MJPEG preview now connects hand joints, upper-body joints and selected face contours instead of drawing isolated points only; overlay regression tests cover hand bones and face contour lines.
- Current full gate after connected overlays: 32 Python tests and Ruff pass; the live laptop preview shows the updated contour overlay.
- Gesture pen follow-up: diagnostics expose the normalized index-fingertip pointer; the console `펜` mode uses `POINTING_UP` for drawing, `VICTORY` to pause and a same-hand `OPEN_PALM -> CLOSED_FIST` transition within 1.8 seconds to clear, with smoothing, jump rejection and five toolbar colors.
- Fast pen follow-up: pointer polling is 30 ms, drawing starts on the first `POINTING_UP` sample, smoothing automatically increases its tracking rate with movement speed, and legitimate normalized motion up to 0.42 per inference step remains connected.
- Angle/position follow-up: static finger extension now combines 2D wrist distance with 3D PIP/DIP straightness, preserving fingers aimed toward the camera; the console bridges up to four transient `UNKNOWN` polls while a valid pointer remains available.
- Temporal skeleton follow-up: diagnostics timestamp the 3D index tip; an alpha-beta-style tracker combines prior/current position and velocity, predicts through at most 240 ms of occlusion, breaks lines on hand changes or large reacquisition jumps, and stops immediately on explicit non-drawing gestures.
- Fast inference follow-up: entering console pen mode switches the runtime to `PEN_DRAW`, skips pose/face models, runs the hand skeleton only, and lowers hand detection/presence thresholds for motion blur; a live laptop delta measurement improved inference from 8.25 FPS to 19.5 FPS (2.36x), and the final live mode remains `PEN_DRAW`.
- Current full gate after gesture pen refinements: 35 Python tests, 6 console Vitest tests, Ruff, strict mypy, and the console production build pass; the live laptop camera runs on the timestamped 3D temporal finger tracker and hand-only fast mode.
- Next loop entry: LOOP 15 packaging, deployment and operational verification.

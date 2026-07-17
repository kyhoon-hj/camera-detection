# Changelog

## [0.1.0] - Unreleased

- LOOP 00: monorepo, quality gates, bootstrap scripts and project documentation.
- LOOP 01: common OpenCV, video-file and deterministic synthetic camera adapters.
- LOOP 02: MediaPipe Tasks hand, pose and face landmark providers with official model downloader and overlay.
- LOOP 03: static gesture rule recognizer and standard recognition candidates.
- LOOP 04: stable START/HOLD/END event envelope, intent profiles, mode filter and event bus.
- LOOP 05: trajectory-based wave, swipe, raised-hand and head-motion recognition.
- LOOP 06: local FastAPI REST, WebSocket, MJPEG, metrics, camera/session/event and capture endpoints.
- LOOP 07: responsive React development console with diagnostics and WebSocket reconnection.
- LOOP 08: consent-gated landmark/video capture sessions, anonymized subjects, capture console, dataset validation CLI and distribution reports.
- LOOP 09: subject-split static gesture trainer, baseline/PyTorch evaluation, ONNX export, model manifests and REST hot-swap/rollback registry.
- LOOP 10: masked/resampled dynamic windows, lightweight TCN, NONE class, ONNX temporal plugin, rule/model fusion, latency and false-activation evaluation.
- LOOP 11 candidate: profile-driven KSL dataset validation/import, license gate, external-only source references, signer-safe splits, keypoint/video extraction and isolated-sign baseline training; awaiting validation on a real licensed sample.
- LOOP 12: persistent model catalog and active pointer, compatibility and output-schema checks, ONNX warmup, provider selection, quarantine/audit, atomic activation, restart restore, rollback and model-change events.
- LOOP 13: typed Python and TypeScript SDKs with schema validation, structured errors, request timeouts, reconnecting event subscriptions, API contract tests and example applications.
- LOOP 14: RGB-D capability/calibration contracts, depth alignment, actual and RGB-estimated distance source separation, deterministic mock depth camera, vendor SDK adapter template, capabilities API and depth recognizer extension point.
- Reduced live-camera false activations: camera changes clear prior timeline events, the console shows confirmed intents by default, raised-hand detection now requires upward motion, hand-wave thresholds are stricter, and static gestures observe a per-hand restart cooldown.
- Added connected landmark overlays for the 21-point hand skeleton, upper-body pose, and selected face contours around the oval, eyes, eyebrows and mouth.
- Added a gesture pen demo to the development console: one raised finger draws, two raised fingers pause, showing an open palm and then folding its four fingers clears the canvas even if the thumb remains extended, the toolbar selects line color, and smoothing/jump rejection reduce landmark jitter.
- Improved fast pen movement with immediate one-finger activation, 30 ms pointer sampling, adaptive smoothing and a wider but still bounded jump filter.
- Improved camera-facing and oblique finger recognition with 3D PIP/DIP joint angles and a short UNKNOWN-frame drawing grace period to bridge landmark occlusion.
- Added timestamped fingertip diagnostics and a bounded 3D temporal tracker that estimates velocity from prior/current landmarks and predicts coordinates for up to 240 ms of occlusion.
- Added an explicit `PEN_DRAW` fast mode that skips pose and face inference, prioritizes the hand skeleton, and uses motion-tolerant MediaPipe hand confidence thresholds.
- Improved lower/outer-frame pen tracking by preserving the camera aspect ratio, adding a 10% detector context margin, predicting brief edge loss for 420 ms, and retaining safe same-hand reentry memory for 950 ms.
- Moved SQLite event persistence off the inference thread and enabled WAL so recording cannot stall the vision pipeline.
- Added opt-in Gemini camera understanding with server-only API-key handling, structured gesture/shape/expression results, Korean browser speech output, repeated-announcement suppression, and voice questions grounded in the current camera frame.

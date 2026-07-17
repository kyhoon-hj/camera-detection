# Architecture decisions

## ADR-001 — Apache-2.0 project license

The repository is Apache-2.0. Dependencies with unclear, GPL, or AGPL terms are excluded from the default stack.

## ADR-002 — Local-first and no raw-video persistence

The server binds to `127.0.0.1`; raw video, snapshots, and landmark persistence are off by default. Camera frames remain in bounded memory queues.

## ADR-003 — Deterministic hardware-independent tests

`SyntheticCameraAdapter` and metadata landmarks exercise the same recognition, event, API and console contracts in CI. Physical-camera evidence is additive and never faked.

## ADR-004 — Optional MediaPipe runtime

Core contracts do not import MediaPipe at module import time. A clear health state is returned when vision extras or model assets are unavailable.

## ADR-005 — MediaPipe Tasks instead of removed Solutions API

MediaPipe 0.10.35 no longer exposes `mp.solutions`. The runtime uses the supported Tasks `HandLandmarker`, `PoseLandmarker`, and `FaceLandmarker` video APIs with externally downloaded, checksummed model assets.

## ADR-006 — Production preview for the local console command

The console command builds and serves a production preview. This avoids Windows dependency-optimizer path traversal failures observed in the local development optimizer while retaining a reproducible Vite build and local-only binding.

## ADR-007 — Depth is optional and its provenance is explicit

RGB-D support extends `FramePacket` and camera capabilities without changing the RGB recognition contract. Metric sensor samples use the `ACTUAL_DEPTH` source, while monocular estimates use `RGB_ESTIMATED_Z`; consumers must not treat the latter as calibrated sensor distance. Vendor SDK code stays behind `DeviceSdkBackend`, and deterministic mock depth is the hardware-independent acceptance path.

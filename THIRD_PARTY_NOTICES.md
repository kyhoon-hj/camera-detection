# Third-party notices

| Component | License | Purpose | Included by default |
|---|---|---|---|
| FastAPI | MIT | Local REST/WebSocket server | Yes |
| Pydantic | MIT | API schema validation | Yes |
| OpenCV | Apache-2.0 | Camera/video I/O and image processing | Yes |
| NumPy | BSD-3-Clause | Frame and landmark arrays | Yes |
| MediaPipe | Apache-2.0 | Optional landmark extraction | Optional |
| React | MIT | Development console | Yes |
| Vite | MIT | Development console build | Yes |
| Prometheus client | Apache-2.0 | Metrics | Yes |

MediaPipe model assets are not committed. A downloader/validator records source URL and SHA-256 before activation. AI Hub data is never downloaded automatically or redistributed by this repository. No GPL/AGPL dependency is part of the default stack.

## MediaPipe model assets used for local runtime

| Asset | Official source | SHA-256 |
|---|---|---|
| Hand Landmarker float16 | `storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task` | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |
| Pose Landmarker Lite float16 | `storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task` | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| Face Landmarker float16 | `storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task` | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |

The assets are downloaded by `scripts/download_mediapipe_models.py`, remain outside Git, and are used under MediaPipe's Apache-2.0 distribution terms.

## RGB-D extension boundary

LOOP 14 adds only internal protocols, NumPy arrays and OpenCV nearest-neighbor alignment; it introduces no new third-party dependency or vendor SDK. Future device backends must add their SDK license, redistributable runtime terms, calibration source and native-binary notices here before distribution.

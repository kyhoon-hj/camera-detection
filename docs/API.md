# API v1

The local server binds to `127.0.0.1:8200`. Interactive OpenAPI documentation is available at `/docs`.

- System: `/v1/health`, `/v1/ready`, `/v1/version`, `/v1/config/effective`, `/v1/metrics`
- Cameras: `/v1/cameras`, start, stop, reconnect, snapshot, MJPEG and diagnostics
- RGB-D capabilities: `/v1/capabilities` and `/v1/cameras/{cameraId}/capabilities` expose RGB/depth/infrared/timestamp/calibration support and optional calibration metadata
- Sessions: create, inspect, end and change mode/profile
- Events: history plus WebSocket `/v1/events/stream`
- Capture: create and sample landmark-only capture sessions
- Models: active runtime model summary
- Gemini vision voice: `GET /v1/ai/gemini/status` reports server-side configuration without exposing the key; `POST /v1/ai/gemini/analyze` sends one raw camera JPEG to Gemini and returns structured Korean speech, gesture, expression and shape fields

`POST /v1/ai/gemini/analyze` accepts `cameraId`, optional `question`, and optional `previousInteractionId`. It returns `503 SUHA-AI-001` when `GEMINI_API_KEY` is absent and `409 SUHA-CAMERA-002` when the camera has no frame. The API key is sent only from the core server in the `x-goog-api-key` header.

WebSocket clients may send `{"action":"SUBSCRIBE","categories":[],"cameraIds":[]}`. Empty filters subscribe to all events. Every event uses schema version `1.0`.

# Architecture

```text
CameraAdapter -> bounded capture queue -> landmark provider -> recognizers
 -> stabilizer -> mode filter -> intent mapper -> event bus
 -> REST / WebSocket / SDK / development console
```

Capture and inference run on separate workers. Queues use `DROP_OLDEST` so latency does not grow under load. The event bus is camera-agnostic and retains only a bounded in-memory history for v0.1.0. Raw candidates remain distinct from stable external events.

RGB-D adapters attach an optional aligned depth plane and calibration to `FramePacket`. Depth recognizers receive both the frame and normalized `FeatureFrame`; existing RGB recognizers continue to consume only normalized features. Metric depth and monocular Z estimates retain distinct provenance labels.

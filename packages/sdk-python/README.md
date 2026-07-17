# SuhaAI Python SDK

```python
from suha_sdk import SuhaClient

with SuhaClient("http://127.0.0.1:8200") as client:
    for camera in client.cameras():
        print(camera.camera_id, camera.running)
    for event in client.events(categories=["INTENT"]):
        print(event.intent)
```

REST calls use the configured timeout and raise `SuhaApiError`, `SuhaTimeoutError`, `SuhaConnectionError`, or `SuhaSchemaError`. Event subscriptions reconnect with bounded exponential backoff by default.

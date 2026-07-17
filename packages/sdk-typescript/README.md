# SuhaAI TypeScript SDK

```ts
import { SuhaClient } from "@suha-ai/sdk";

const client = new SuhaClient({ baseUrl: "http://127.0.0.1:8200" });
const unsubscribe = client.events.subscribe(
  event => console.log(event.intent),
  { categories: ["INTENT"], onError: console.error },
);
```

The SDK validates schema `1.0` at runtime, reconnects event streams with exponential backoff, aborts timed-out requests, and exposes typed camera and event contracts.

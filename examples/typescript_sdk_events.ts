import { SuhaClient } from "@suha-ai/sdk";

const client = new SuhaClient({ baseUrl: "http://127.0.0.1:8200", timeoutMs: 5_000 });

const unsubscribe = client.events.subscribe(
  event => {
    console.log(event.timestamp, event.eventCode, event.intent, event.confidence);
  },
  {
    categories: ["INTENT", "GESTURE_DYNAMIC"],
    onError: error => console.error("SuhaAI SDK:", error.message),
  },
);

window.addEventListener("beforeunload", unsubscribe);

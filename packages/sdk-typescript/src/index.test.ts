import { describe, expect, it, vi } from "vitest";
import { parseSuhaEvent, SuhaApiError, SuhaClient, SuhaSchemaError, SuhaTimeoutError, type SuhaEvent } from "./index";

const event = (): Record<string, unknown> => ({
  schemaVersion: "1.0", eventId: "evt_1", traceId: "trc_1", cameraId: "synthetic-front", sessionId: "ses_1",
  personId: null, timestamp: "2026-07-16T00:00:00Z", category: "GESTURE_DYNAMIC", eventCode: "HAND_WAVE",
  phase: "END", intent: "WAKE_UP", confidence: 0.9, durationMs: 500, source: {}, quality: {}, metadata: {},
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sent: string[] = [];
  constructor(public readonly url: string) { FakeSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.({} as CloseEvent); }
  open() { this.onopen?.({} as Event); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
  disconnect() { this.onclose?.({} as CloseEvent); }
}

describe("SuhaClient", () => {
  it("uses typed camera responses and structured API errors", async () => {
    const camera = {cameraId:"synthetic-front",running:false,sessionId:"ses",mode:"GENERIC_GESTURE",profile:"default",capturedFrames:0,inferredFrames:0,droppedFrames:0,captureFps:0,inferenceFps:0,error:null,health:{}};
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([camera]), {status: 200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({error:{code:"SUHA-TEST",message:"bad",traceId:"trc"}}), {status: 400}));
    const client = new SuhaClient({fetch: fetchMock as typeof fetch});
    expect((await client.cameras())[0].cameraId).toBe("synthetic-front");
    await expect(client.startCamera("missing")).rejects.toMatchObject<Partial<SuhaApiError>>({status:400,code:"SUHA-TEST"});
  });

  it("validates schema versions", () => {
    expect(parseSuhaEvent(event()).eventCode).toBe("HAND_WAVE");
    expect(() => parseSuhaEvent({...event(), schemaVersion:"2.0"})).toThrow(SuhaSchemaError);
  });

  it("subscribes, reports malformed events, and reconnects", async () => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    const received: SuhaEvent[] = [];
    const errors: Error[] = [];
    const client = new SuhaClient({WebSocket: FakeSocket, timeoutMs:1000});
    const unsubscribe = client.events.subscribe(value => received.push(value), {categories:["GESTURE_DYNAMIC"], initialBackoffMs:10, onError:error=>errors.push(error)});
    const first = FakeSocket.instances[0]; first.open(); first.message(event()); first.message({...event(), schemaVersion:"9"});
    expect(received[0].intent).toBe("WAKE_UP");
    expect(errors[0]).toBeInstanceOf(SuhaSchemaError);
    expect(JSON.parse(first.sent[0]).categories).toEqual(["GESTURE_DYNAMIC"]);
    first.disconnect();
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeSocket.instances).toHaveLength(2);
    unsubscribe();
    vi.useRealTimers();
  });

  it("raises a timeout when fetch is aborted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const client = new SuhaClient({fetch: fetchMock as typeof fetch, timeoutMs:10});
    const pending = client.cameras();
    const assertion = expect(pending).rejects.toBeInstanceOf(SuhaTimeoutError);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    vi.useRealTimers();
  });
});

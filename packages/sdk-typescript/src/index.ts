export const SUPPORTED_SCHEMA_VERSION = "1.0" as const;

export type EventCategory = "PERSON" | "GESTURE_STATIC" | "GESTURE_DYNAMIC" | "HEAD_MOTION" | "SIGN_LANGUAGE" | "INTENT" | "QUALITY" | "MODEL" | string;
export type EventPhase = "START" | "HOLD" | "END" | string;

export interface SuhaEvent {
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  eventId: string;
  traceId: string;
  cameraId: string;
  sessionId: string;
  personId: string | null;
  timestamp: string;
  category: EventCategory;
  eventCode: string;
  phase: EventPhase;
  intent: string;
  confidence: number;
  durationMs: number;
  source: Record<string, unknown>;
  quality: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface CameraStatus {
  cameraId: string;
  running: boolean;
  sessionId: string;
  mode: string;
  profile: string;
  capturedFrames: number;
  inferredFrames: number;
  droppedFrames: number;
  captureFps: number;
  inferenceFps: number;
  error: string | null;
  health: Record<string, unknown>;
}

export class SuhaError extends Error {}
export class SuhaConnectionError extends SuhaError {}
export class SuhaTimeoutError extends SuhaError {}
export class SuhaSchemaError extends SuhaError {}
export class SuhaApiError extends SuhaError {
  constructor(public readonly status: number, message: string, public readonly code?: string, public readonly traceId?: string) {
    super(message);
  }
}

export interface EventSubscriptionOptions {
  categories?: string[];
  cameraIds?: string[];
  reconnect?: boolean;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  onError?: (error: SuhaError) => void;
}

interface SocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

type SocketConstructor = new (url: string) => SocketLike;

export interface SuhaClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  WebSocket?: SocketConstructor;
}

export class SuhaClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly Socket?: SocketConstructor;

  constructor(options: SuhaClientOptions | string = {}) {
    const normalized = typeof options === "string" ? { baseUrl: options } : options;
    this.baseUrl = (normalized.baseUrl ?? "http://127.0.0.1:8200").replace(/\/$/, "");
    this.timeoutMs = normalized.timeoutMs ?? 10_000;
    this.fetchImplementation = normalized.fetch ?? globalThis.fetch.bind(globalThis);
    const socket = normalized.WebSocket ?? globalThis.WebSocket;
    this.Socket = socket as SocketConstructor | undefined;
  }

  async cameras(): Promise<CameraStatus[]> {
    const value = await this.request("/v1/cameras");
    if (!Array.isArray(value)) throw new SuhaSchemaError("Camera response must be an array");
    return value.map(parseCameraStatus);
  }

  async startCamera(cameraId: string): Promise<CameraStatus> {
    return parseCameraStatus(await this.request(`/v1/cameras/${encodeURIComponent(cameraId)}/start`, { method: "POST" }));
  }

  async stopCamera(cameraId: string): Promise<CameraStatus> {
    return parseCameraStatus(await this.request(`/v1/cameras/${encodeURIComponent(cameraId)}/stop`, { method: "POST" }));
  }

  readonly events = {
    subscribe: (onEvent: (event: SuhaEvent) => void, options: EventSubscriptionOptions = {}): (() => void) => {
      let active = true;
      let attempts = 0;
      let socket: SocketLike | undefined;
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
      let openTimer: ReturnType<typeof setTimeout> | undefined;
      const reconnect = options.reconnect ?? true;
      const initialBackoff = options.initialBackoffMs ?? 250;
      const maximumBackoff = options.maxBackoffMs ?? 5_000;
      const report = (error: SuhaError) => options.onError?.(error);

      const connectSocket = () => {
        if (!active) return;
        if (!this.Socket) {
          report(new SuhaConnectionError("WebSocket is unavailable in this runtime"));
          active = false;
          return;
        }
        socket = new this.Socket(this.baseUrl.replace(/^http/, "ws") + "/v1/events/stream");
        openTimer = setTimeout(() => {
          report(new SuhaTimeoutError(`WebSocket did not open within ${this.timeoutMs}ms`));
          socket?.close();
        }, this.timeoutMs);
        socket.onopen = () => {
          if (openTimer) clearTimeout(openTimer);
          attempts = 0;
          socket?.send(JSON.stringify({ action: "SUBSCRIBE", categories: options.categories ?? [], cameraIds: options.cameraIds ?? [] }));
        };
        socket.onmessage = message => {
          try {
            onEvent(parseSuhaEvent(JSON.parse(String(message.data))));
          } catch (error) {
            report(error instanceof SuhaError ? error : new SuhaSchemaError(String(error)));
          }
        };
        socket.onerror = () => report(new SuhaConnectionError("WebSocket transport error"));
        socket.onclose = () => {
          if (openTimer) clearTimeout(openTimer);
          if (!active || !reconnect) return;
          const delay = Math.min(maximumBackoff, initialBackoff * 2 ** attempts++);
          reconnectTimer = setTimeout(connectSocket, delay);
        };
      };
      connectSocket();
      return () => {
        active = false;
        if (openTimer) clearTimeout(openTimer);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        socket?.close();
      };
    },
  };

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new SuhaTimeoutError(`${init.method ?? "GET"} ${path} timed out`);
      throw new SuhaConnectionError(String(error));
    } finally {
      clearTimeout(timer);
    }
    const payload: unknown = await response.json().catch(() => {
      throw new SuhaSchemaError("Response is not valid JSON");
    });
    if (!response.ok) {
      const root = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
      throw new SuhaApiError(
        response.status,
        isRecord(root) && typeof root.message === "string" ? root.message : `HTTP ${response.status}`,
        isRecord(root) && typeof root.code === "string" ? root.code : undefined,
        isRecord(root) && typeof root.traceId === "string" ? root.traceId : undefined,
      );
    }
    return payload;
  }
}

export function parseSuhaEvent(value: unknown): SuhaEvent {
  if (!isRecord(value)) throw new SuhaSchemaError("Event payload must be an object");
  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) throw new SuhaSchemaError(`Unsupported event schema: ${String(value.schemaVersion)}`);
  const strings = ["eventId", "traceId", "cameraId", "sessionId", "timestamp", "category", "eventCode", "phase", "intent"] as const;
  for (const key of strings) if (typeof value[key] !== "string") throw new SuhaSchemaError(`Malformed event field: ${key}`);
  if (typeof value.confidence !== "number" || typeof value.durationMs !== "number") throw new SuhaSchemaError("Malformed event numeric fields");
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    eventId: value.eventId as string,
    traceId: value.traceId as string,
    cameraId: value.cameraId as string,
    sessionId: value.sessionId as string,
    personId: typeof value.personId === "string" ? value.personId : null,
    timestamp: value.timestamp as string,
    category: value.category as string,
    eventCode: value.eventCode as string,
    phase: value.phase as string,
    intent: value.intent as string,
    confidence: value.confidence,
    durationMs: value.durationMs,
    source: isRecord(value.source) ? value.source : {},
    quality: isRecord(value.quality) ? value.quality : {},
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
}

function parseCameraStatus(value: unknown): CameraStatus {
  if (!isRecord(value)) throw new SuhaSchemaError("Camera response must be an object");
  const stringKeys = ["cameraId", "sessionId", "mode", "profile"] as const;
  const numberKeys = ["capturedFrames", "inferredFrames", "droppedFrames", "captureFps", "inferenceFps"] as const;
  for (const key of stringKeys) if (typeof value[key] !== "string") throw new SuhaSchemaError(`Malformed camera field: ${key}`);
  for (const key of numberKeys) if (typeof value[key] !== "number") throw new SuhaSchemaError(`Malformed camera field: ${key}`);
  if (typeof value.running !== "boolean") throw new SuhaSchemaError("Malformed camera field: running");
  return value as unknown as CameraStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

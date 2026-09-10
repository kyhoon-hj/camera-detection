import { afterEach, describe, expect, it, vi } from "vitest";
import { speedKmh, watchDriverSpeed } from "../src/driverSpeed";

afterEach(() => vi.useRealTimers());
describe("GPS 참고 속도", () => {
  it("m/s를 km/h로 변환하며 실제 0은 정지 속도로 유지한다", () => {
    expect(speedKmh(20, 1000, 1000)).toBe(72);
    expect(speedKmh(0, 1000, 1000)).toBe(0);
  });
  it("측정 불가, 음수, 오래되거나 비정상인 값을 숫자로 표시하지 않는다", () => {
    for (const value of [null, -1, NaN, Infinity]) expect(speedKmh(value, 1000, 1000)).toBeNull();
    expect(speedKmh(20, 1000, 17000)).toBeNull();
    expect(speedKmh(20, NaN, 1000)).toBeNull();
    expect(speedKmh(20, 5000, 1000)).toBeNull();
  });
  it("갱신이 끊기면 숫자를 지우고 종료 뒤 늦은 콜백을 무시한다", () => {
    vi.useFakeTimers(); vi.setSystemTime(100000);
    let onPosition!: PositionCallback;
    const clearWatch = vi.fn(); const update = vi.fn();
    const geo = { watchPosition: vi.fn((success: PositionCallback) => { onPosition = success; return 4; }), clearWatch } as unknown as Geolocation;
    const stop = watchDriverSpeed(geo, update);
    onPosition({ timestamp: Date.now(), coords: { speed: 10 } } as GeolocationPosition);
    expect(update).toHaveBeenLastCalledWith({ kmh: 36, label: "GPS 참고 속도" });
    vi.advanceTimersByTime(16000);
    expect(update).toHaveBeenLastCalledWith({ kmh: null, label: "GPS 재수신 대기" });
    stop(); expect(clearWatch).toHaveBeenCalledWith(4);
    const calls = update.mock.calls.length;
    onPosition({ timestamp: Date.now(), coords: { speed: 10 } } as GeolocationPosition);
    vi.advanceTimersByTime(20000);
    expect(update).toHaveBeenCalledTimes(calls);
  });
  it("위치 권한 거부를 명확히 표시한다", () => {
    vi.useFakeTimers();
    const update = vi.fn();
    const geo = { watchPosition: (_success: PositionCallback, error: PositionErrorCallback) => { error({ code: 1 } as GeolocationPositionError); return 1; }, clearWatch: vi.fn() } as unknown as Geolocation;
    const stop = watchDriverSpeed(geo, update);
    expect(update).toHaveBeenLastCalledWith({ kmh: null, label: "위치 권한 필요" }); stop();
  });
});

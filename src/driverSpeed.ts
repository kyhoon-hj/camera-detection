export interface SpeedReading { kmh: number | null; label: string }
export const SPEED_MAX_AGE_MS = 15_000;

export function speedKmh(speed: number | null, timestamp: number, now = Date.now()): number | null {
  if (speed === null || !Number.isFinite(speed) || speed < 0 || !Number.isFinite(timestamp) || now - timestamp > SPEED_MAX_AGE_MS || timestamp > now + 1000) return null;
  return Math.round(speed * 3.6);
}

// 좌표는 저장/전송하지 않고 기기가 제공하는 속도만 사용합니다.
export function watchDriverSpeed(geo: Geolocation, update: (value: SpeedReading) => void): () => void {
  let disposed = false;
  let receivedAt = 0;
  let watchId: number | undefined;
  const emit = (value: SpeedReading) => { if (!disposed) update(value); };
  emit({ kmh: null, label: "GPS 연결 중" });
  try {
    watchId = geo.watchPosition(position => {
      if (disposed) return;
      receivedAt = position.timestamp;
      const kmh = speedKmh(position.coords.speed, position.timestamp);
      emit({ kmh, label: kmh === null ? "속도 측정 대기" : "GPS 참고 속도" });
    }, error => {
      receivedAt = 0;
      emit({ kmh: null, label: error.code === 1 ? "위치 권한 필요" : error.code === 3 ? "GPS 응답 대기" : "GPS 수신 불가" });
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
  } catch {
    emit({ kmh: null, label: "GPS 사용 불가" });
  }
  const expiry = setInterval(() => {
    if (receivedAt && Date.now() - receivedAt > SPEED_MAX_AGE_MS) {
      receivedAt = 0;
      emit({ kmh: null, label: "GPS 재수신 대기" });
    }
  }, 1000);
  return () => {
    disposed = true;
    clearInterval(expiry);
    if (watchId !== undefined) geo.clearWatch(watchId);
  };
}

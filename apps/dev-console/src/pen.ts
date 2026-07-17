export function isPenPointerGesture(gesture?: string) {
  return gesture === "POINTING_UP" || gesture === "VICTORY";
}

export function shouldDrawWithGesture(gesture?: string) {
  return gesture === "POINTING_UP";
}

export type PenPoint = {x: number; y: number};
export type PenMeasurement = PenPoint & {z?: number; handedness?: string};
export type TrackedPenPoint = PenMeasurement & {predicted: boolean; reacquired: boolean};

export function isNearFrameEdge(point: PenPoint, sideMargin = 0.08, bottomMargin = 0.14) {
  return point.x <= sideMargin || point.x >= 1-sideMargin || point.y <= sideMargin || point.y >= 1-bottomMargin;
}

function clampMeasurement(measurement: PenMeasurement): PenMeasurement {
  return {...measurement, x:Math.min(1, Math.max(0, measurement.x)), y:Math.min(1, Math.max(0, measurement.y))};
}

export function smoothPenPoint(previous: PenPoint | null, next: PenPoint, alpha?: number): PenPoint {
  if (!previous) return next;
  const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
  const adaptiveAlpha = alpha ?? Math.min(0.78, 0.38 + distance * 1.6);
  return {
    x: previous.x + (next.x - previous.x) * adaptiveAlpha,
    y: previous.y + (next.y - previous.y) * adaptiveAlpha,
  };
}

export function isPlausiblePenMove(previous: PenPoint | null, next: PenPoint, maxDistance = 0.42) {
  if (!previous) return true;
  return Math.hypot(next.x - previous.x, next.y - previous.y) <= maxDistance;
}

export class TemporalPenTracker {
  private current: TrackedPenPoint | null = null;
  private velocity = {x:0, y:0, z:0};
  private lastTimestamp: number | null = null;
  private lastSeenTimestamp: number | null = null;

  reset() {
    this.current = null;
    this.velocity = {x:0, y:0, z:0};
    this.lastTimestamp = null;
    this.lastSeenTimestamp = null;
  }

  update(measurement: PenMeasurement | null, timestampMs: number, predictionWindowMs = 420, reentryWindowMs = 950): TrackedPenPoint | null {
    if (this.lastTimestamp !== null && timestampMs <= this.lastTimestamp) return this.current;
    const missingFor = this.lastSeenTimestamp === null ? 0 : timestampMs-this.lastSeenTimestamp;
    if (missingFor > reentryWindowMs) this.reset();
    const seconds = this.lastTimestamp === null ? 1 / 30 : Math.min(0.2, Math.max(0.016, (timestampMs - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestampMs;

    if (measurement) {
      measurement = clampMeasurement(measurement);
      const handChanged = Boolean(this.current?.handedness && measurement.handedness && this.current.handedness !== measurement.handedness);
      if (!this.current || handChanged) {
        this.current = {...measurement, predicted:false, reacquired:true};
        this.velocity = {x:0, y:0, z:0};
        this.lastSeenTimestamp = timestampMs;
        return this.current;
      }
      const predicted = {
        x:this.current.x + this.velocity.x * seconds,
        y:this.current.y + this.velocity.y * seconds,
        z:(this.current.z ?? 0) + this.velocity.z * seconds,
      };
      const residual = {x:measurement.x-predicted.x, y:measurement.y-predicted.y, z:(measurement.z??0)-predicted.z};
      const wasOccluded = this.lastSeenTimestamp !== null && timestampMs-this.lastSeenTimestamp > 80;
      const edgeReentry = isNearFrameEdge(this.current) || isNearFrameEdge(measurement);
      const jumpLimit = wasOccluded ? (edgeReentry ? 0.30 : 0.22) : 0.48;
      const jump = Math.hypot(residual.x, residual.y) > jumpLimit;
      if (jump) {
        this.current = {...measurement, predicted:false, reacquired:true};
        this.velocity = {x:0, y:0, z:0};
      } else {
        const alpha = Math.min(0.82, 0.5 + Math.hypot(residual.x, residual.y) * 1.4);
        const next = {
          x:Math.min(1, Math.max(0, predicted.x + residual.x * alpha)),
          y:Math.min(1, Math.max(0, predicted.y + residual.y * alpha)),
          z:predicted.z + residual.z * alpha,
        };
        const observedVelocity = {
          x:(next.x-this.current.x)/seconds,
          y:(next.y-this.current.y)/seconds,
          z:(next.z-(this.current.z??0))/seconds,
        };
        this.velocity = {
          x:this.velocity.x*0.65+observedVelocity.x*0.35,
          y:this.velocity.y*0.65+observedVelocity.y*0.35,
          z:this.velocity.z*0.65+observedVelocity.z*0.35,
        };
        this.current = {...measurement, ...next, predicted:false, reacquired:false};
      }
      this.lastSeenTimestamp = timestampMs;
      return this.current;
    }

    if (!this.current || this.lastSeenTimestamp === null) {
      this.reset();
      return null;
    }
    if (timestampMs-this.lastSeenTimestamp > predictionWindowMs) {
      this.velocity = {x:this.velocity.x*0.65, y:this.velocity.y*0.65, z:this.velocity.z*0.65};
      return null;
    }
    this.current = {
      ...this.current,
      x:Math.min(1, Math.max(0, this.current.x + this.velocity.x * seconds)),
      y:Math.min(1, Math.max(0, this.current.y + this.velocity.y * seconds)),
      z:(this.current.z??0) + this.velocity.z * seconds,
      predicted:true,
      reacquired:false,
    };
    this.velocity = {x:this.velocity.x*0.82, y:this.velocity.y*0.82, z:this.velocity.z*0.82};
    return this.current;
  }
}

export type EraseGestureState = {armedHand: string | null; armedAt: number};
type EraseCandidate = {
  code: string;
  handedness?: string | null;
  metadata?: {extendedFingers?: number};
};

export function advanceEraseGesture(
  state: EraseGestureState,
  candidates: EraseCandidate[],
  now: number,
  timeoutMs = 2600,
) {
  const activeState = state.armedHand && now - state.armedAt <= timeoutMs ? state : {armedHand:null, armedAt:0};
  const openPalm = candidates.find(candidate => candidate.code === "OPEN_PALM");
  if (openPalm) {
    const hand = openPalm.handedness ?? "ANY";
    return {state: activeState.armedHand === hand ? activeState : {armedHand:hand, armedAt:now}, shouldClear:false};
  }
  const fingersFoldedSameHand = activeState.armedHand && candidates.some(candidate =>
    (candidate.code === "CLOSED_FIST" || candidate.metadata?.extendedFingers === 0) &&
    ((candidate.handedness ?? "ANY") === activeState.armedHand || activeState.armedHand === "ANY")
  );
  if (fingersFoldedSameHand) return {state:{armedHand:null, armedAt:0}, shouldClear:true};
  return {state:activeState, shouldClear:false};
}

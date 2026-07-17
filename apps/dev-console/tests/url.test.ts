import { describe, expect, it } from "vitest";
import { advanceEraseGesture, isNearFrameEdge, isPenPointerGesture, isPlausiblePenMove, shouldDrawWithGesture, smoothPenPoint, TemporalPenTracker } from "../src/pen";
function wsUrl(base:string){return base.replace(/^http/,"ws")+"/v1/events/stream"}
describe("WebSocket endpoint",()=>{it("maps local API protocol",()=>expect(wsUrl("http://127.0.0.1:8200")).toBe("ws://127.0.0.1:8200/v1/events/stream"))});
describe("gesture pen",()=>{
  it("uses one finger to draw and two fingers as pointer-only",()=>{
    expect(isPenPointerGesture("POINTING_UP")).toBe(true);
    expect(shouldDrawWithGesture("POINTING_UP")).toBe(true);
    expect(isPenPointerGesture("VICTORY")).toBe(true);
    expect(shouldDrawWithGesture("VICTORY")).toBe(false);
    expect(isPenPointerGesture("CLOSED_FIST")).toBe(false);
  });
  it("smooths normal motion and rejects landmark jumps",()=>{
    expect(smoothPenPoint({x:0,y:0},{x:1,y:1},0.25)).toEqual({x:0.25,y:0.25});
    expect(isPlausiblePenMove({x:0.4,y:0.4},{x:0.5,y:0.45})).toBe(true);
    expect(isPlausiblePenMove({x:0.1,y:0.1},{x:0.8,y:0.8})).toBe(false);
  });
  it("follows fast valid motion more aggressively than slow motion",()=>{
    const slow = smoothPenPoint({x:0.1,y:0.1},{x:0.12,y:0.12});
    const fast = smoothPenPoint({x:0.1,y:0.1},{x:0.4,y:0.4});
    expect(slow.x).toBeLessThan(0.11);
    expect(fast.x).toBeGreaterThan(0.3);
    expect(isPlausiblePenMove({x:0.1,y:0.1},{x:0.4,y:0.35})).toBe(true);
  });
  it("predicts a briefly occluded 3D fingertip and retains safe reentry memory",()=>{
    const tracker = new TemporalPenTracker();
    tracker.update({x:0.1,y:0.2,z:-0.1,handedness:"RIGHT"},1000);
    const observed = tracker.update({x:0.2,y:0.2,z:-0.12,handedness:"RIGHT"},1100)!;
    const predicted = tracker.update(null,1200)!;
    expect(predicted.predicted).toBe(true);
    expect(predicted.x).toBeGreaterThan(observed.x);
    expect(tracker.update(null,1600)).toBe(null);
    const reentered = tracker.update({x:0.39,y:0.2,z:-0.12,handedness:"RIGHT"},1700)!;
    expect(reentered.reacquired).toBe(false);
  });
  it("keeps bottom-edge motion longer, clamps it, and rejects a far reentry bridge",()=>{
    const tracker = new TemporalPenTracker();
    tracker.update({x:0.5,y:0.88,handedness:"RIGHT"},1000);
    tracker.update({x:0.5,y:0.98,handedness:"RIGHT"},1100);
    const edgePrediction = tracker.update(null,1450)!;
    expect(edgePrediction.predicted).toBe(true);
    expect(edgePrediction.y).toBeGreaterThan(0.98);
    expect(edgePrediction.y).toBeLessThanOrEqual(1);
    expect(isNearFrameEdge(edgePrediction)).toBe(true);
    const farReentry = tracker.update({x:0.1,y:0.2,handedness:"RIGHT"},1600)!;
    expect(farReentry.reacquired).toBe(true);
    expect(tracker.update({x:1.2,y:-0.2,handedness:"RIGHT"},1700)).toMatchObject({x:1,y:0});
  });
  it("clears after one hand changes from open palm to folded fingers",()=>{
    const armed = advanceEraseGesture({armedHand:null,armedAt:0},[{code:"OPEN_PALM",handedness:"RIGHT"}],1000);
    expect(armed.shouldClear).toBe(false);
    expect(armed.state.armedHand).toBe("RIGHT");
    const cleared = advanceEraseGesture(armed.state,[{code:"CLOSED_FIST",handedness:"RIGHT"}],1500);
    expect(cleared.shouldClear).toBe(true);
    expect(cleared.state.armedHand).toBe(null);
    const wrongHand = advanceEraseGesture(armed.state,[{code:"CLOSED_FIST",handedness:"LEFT"}],1500);
    expect(wrongHand.shouldClear).toBe(false);
    const thumbStillOut = advanceEraseGesture(armed.state,[{code:"THUMB_UP",handedness:"RIGHT",metadata:{extendedFingers:0}}],1700);
    expect(thumbStillOut.shouldClear).toBe(true);
    const oneFingerDraw = advanceEraseGesture(armed.state,[{code:"POINTING_UP",handedness:"RIGHT",metadata:{extendedFingers:1}}],1700);
    expect(oneFingerDraw.shouldClear).toBe(false);
    const expired = advanceEraseGesture(armed.state,[{code:"CLOSED_FIST",handedness:"RIGHT"}],3700);
    expect(expired.shouldClear).toBe(false);
  });
});

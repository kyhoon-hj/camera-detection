import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('offline distribution assets',()=>{
  it('includes the actual model and wasm files needed on first launch',()=>{
    for(const file of ['models/face_landmarker.task','models/pose_landmarker_lite.task','wasm/vision_wasm_internal.js','wasm/vision_wasm_internal.wasm','wasm/vision_wasm_nosimd_internal.js','wasm/vision_wasm_nosimd_internal.wasm']) {
      expect(fs.statSync(`public/${file}`).size).toBeGreaterThan(1000);
    }
  });
  it('does not restore removed speed or location telemetry from old parameter names',async()=>{
    const {cleanParams}=await import('../src/analyticsCore');
    expect(cleanParams({latitude:37,longitude:127,max_kmh:80,speed_sum:100,speed_valid_seconds:8,speed_80_plus_seconds:3,measured_seconds:4})).toEqual({measured_seconds:4});
  });
});

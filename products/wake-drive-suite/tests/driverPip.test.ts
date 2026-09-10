import { describe, expect, it } from "vitest";
import { EMPTY_PIP_STATE, keepsPipCamera } from "../src/driverPip";

describe("작은 화면의 카메라 유지 범위", () => {
  const active = { ...EMPTY_PIP_STATE, supported: true, monitoring: true, active: true };
  it("측정 중인 작은 창이 실제로 보일 때 유지한다", () => {
    expect(keepsPipCamera(active)).toBe(true);
    expect(keepsPipCamera({ ...active, active: false, transitioning: true })).toBe(true);
  });
  it("창 닫기·화면 끄기·측정 종료·미지원 상태를 유지 대상으로 처리하지 않는다", () => {
    expect(keepsPipCamera({ ...active, visible: false })).toBe(false);
    expect(keepsPipCamera({ ...active, monitoring: false })).toBe(false);
    expect(keepsPipCamera({ ...active, supported: false })).toBe(false);
    expect(keepsPipCamera({ ...active, active: false })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { FIRST_RUN_NOTICE_ACKNOWLEDGED, shouldShowFirstRunNotice } from "../src/firstRunNotice";

describe("first run privacy notice", () => {
  it("최초 실행 시 안내를 표시한다", () => {
    expect(shouldShowFirstRunNotice(null)).toBe(true);
  });

  it("확인한 이후에는 다시 표시하지 않는다", () => {
    expect(shouldShowFirstRunNotice(FIRST_RUN_NOTICE_ACKNOWLEDGED)).toBe(false);
  });
});

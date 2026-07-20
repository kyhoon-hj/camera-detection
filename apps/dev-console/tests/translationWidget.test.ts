import { describe, expect, it } from "vitest";
import { normalizeWidgetSettings } from "../src/widgetSettings";

describe("translation widget settings",()=>{
  it("clamps persisted visual settings",()=>{
    expect(normalizeWidgetSettings({fontSize:100,opacity:.1,position:"TOP_LEFT"})).toMatchObject({fontSize:44,opacity:.55,position:"TOP_LEFT"});
  });
  it("falls back from an invalid position",()=>{
    expect(normalizeWidgetSettings({position:"SIDE" as never}).position).toBe("BOTTOM_RIGHT");
  });
});

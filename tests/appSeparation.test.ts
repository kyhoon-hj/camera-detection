import { describe, expect, it } from "vitest";
import { getAppProfile, isAllowedModule, resolveInitialModule } from "../src/appProfile";
import { scopedStorage } from "../src/appStorage";

describe("independent applications", () => {
  it("never accepts another service or obsolete module through a URL or saved session", () => {
    for (const variant of ["jolbang", "yeolgong"] as const) {
      const own = getAppProfile(variant).module;
      for (const foreign of ["STUDY", "DROWSINESS", "SIGN", "POSTURE", "WIDGET", "MEDITATION"]) {
        if (foreign === own) continue;
        expect(isAllowedModule(variant, foreign)).toBe(false);
        expect(resolveInitialModule(variant, "", foreign)).toBe("HOME");
      }
      expect(resolveInitialModule(variant, "", own)).toBe(own);
    }
    expect(resolveInitialModule("jolbang", "?mode=study", "DROWSINESS")).toBe("HOME");
    expect(resolveInitialModule("yeolgong", "?mode=drowsiness", "STUDY")).toBe("HOME");
  });
  it("cannot read, overwrite or remove the other app's settings on the same origin", () => {
    const data = new Map<string, string>([["settings", "legacy"]]);
    const backend = () => ({ getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } });
    const drive = scopedStorage("jolbang", backend);
    const study = scopedStorage("yeolgong", backend);
    expect(drive.getItem("settings")).toBeNull();
    drive.setItem("settings", "drive");
    study.setItem("settings", "study");
    expect(drive.getItem("settings")).toBe("drive");
    expect(study.getItem("settings")).toBe("study");
    drive.removeItem("settings");
    expect(study.getItem("settings")).toBe("study");
    expect(data.get("settings")).toBe("legacy");
  });
  it("requires explicit, distinct installation identities", () => {
    expect(getAppProfile("jolbang").appId).not.toBe(getAppProfile("yeolgong").appId);
    expect(() => getAppProfile("combined")).toThrow();
  });
});

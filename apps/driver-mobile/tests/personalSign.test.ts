import { describe, expect, it } from "vitest";
import { addPersonalSample, rankPersonalSigns, summarizeSignSequence } from "../src/personalSign";

function sequence(offset = 0) {
  return Array.from({ length: 14 }, (_, frame) => Array.from({ length: 8 }, (_, feature) => offset + frame * 0.02 + feature * 0.01));
}

describe("personal sign recognition", () => {
  it("resamples a variable-length sequence to a stable shape", () => {
    expect(summarizeSignSequence(sequence(), 12)).toHaveLength(96);
    expect(summarizeSignSequence(sequence().slice(0, 8), 12)).toHaveLength(96);
  });

  it("requires three local samples before returning a candidate", () => {
    let library = {};
    library = addPersonalSample(library, "HELP_NEEDED", sequence());
    library = addPersonalSample(library, "HELP_NEEDED", sequence(0.01));
    expect(rankPersonalSigns(sequence(), library)).toEqual([]);
    library = addPersonalSample(library, "HELP_NEEDED", sequence(-0.01));
    const candidates = rankPersonalSigns(sequence(0.005), library);
    expect(candidates[0].id).toBe("HELP_NEEDED");
    expect(candidates[0].confidence).toBeGreaterThan(0.9);
  });

  it("ranks the closest learned expression first", () => {
    let library = {};
    for (const delta of [0, 0.01, -0.01]) library = addPersonalSample(library, "YES", sequence(delta));
    for (const delta of [0, 0.01, -0.01]) library = addPersonalSample(library, "NO", sequence(1 + delta));
    expect(rankPersonalSigns(sequence(0.02), library)[0].id).toBe("YES");
  });
});

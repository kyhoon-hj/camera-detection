import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUDY_REWARD_STATE,
  canDrawStudyReward,
  drawStudyReward,
  loadStudyRewardState,
  recordStudyCompletion,
  resetStudyProgress,
  STUDY_REWARD_IMAGES,
  type StudyRewardState,
  unlockAllStudyRewardsForTest,
} from "../src/studyRewards";

describe("study reward attendance and daily draw", () => {
  it("starts with image zero owned and selected", () => {
    expect(loadStudyRewardState(null)).toEqual(DEFAULT_STUDY_REWARD_STATE);
  });

  it("counts one completion per day and continues only on consecutive days", () => {
    const day1 = recordStudyCompletion(DEFAULT_STUDY_REWARD_STATE, new Date(2026, 6, 24, 9));
    const sameDay = recordStudyCompletion(day1, new Date(2026, 6, 24, 21));
    const day2 = recordStudyCompletion(sameDay, new Date(2026, 6, 25, 9));
    const reset = recordStudyCompletion(day2, new Date(2026, 6, 27, 9));
    expect(day1.streak).toBe(1);
    expect(sameDay.streak).toBe(1);
    expect(day2.streak).toBe(2);
    expect(reset.streak).toBe(1);
  });

  it("resets only calendar progress and preserves reward ownership", () => {
    const state: StudyRewardState = {
      ...DEFAULT_STUDY_REWARD_STATE,
      owned: ["0_books_notebook.png", "01_gold_pig.png"],
      selected: "01_gold_pig.png",
      streak: 8,
      lastCompletedDate: "2026-07-24",
      lastDrawDate: "2026-07-24",
    };
    expect(resetStudyProgress(state)).toEqual({
      ...state,
      streak: 0,
      lastCompletedDate: null,
    });
  });

  it("allows one draw only after today's completed study session", () => {
    const now = new Date(2026, 6, 24, 9);
    expect(canDrawStudyReward(DEFAULT_STUDY_REWARD_STATE, now)).toBe(false);
    const completed = recordStudyCompletion(DEFAULT_STUDY_REWARD_STATE, now);
    expect(canDrawStudyReward(completed, now)).toBe(true);
    const drawn = drawStudyReward(completed, now, () => 0);
    expect(drawn.owned).toHaveLength(2);
    expect(drawn.selected).not.toBe("0_open_notebook.png");
    expect(canDrawStudyReward(drawn, now)).toBe(false);
  });

  it("unlocks every image at once while the reward picker is in test mode", () => {
    const unlocked = unlockAllStudyRewardsForTest(DEFAULT_STUDY_REWARD_STATE, new Date(2026, 6, 24, 9));
    expect(unlocked.owned).toEqual(STUDY_REWARD_IMAGES);
    expect(unlocked.selected).toBe("0_books_notebook.png");
  });
});

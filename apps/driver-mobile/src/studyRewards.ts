export const STUDY_REWARDS_STORAGE_KEY = "suha.study.rewards.v1";

export const STUDY_REWARD_IMAGES = [
  "0_books_notebook.png",
  "01_gold_pig.png",
  "02_lucky_pig.png",
  "03_lucky_charm.png",
  "04_four_leaf_clover.png",
  "05_flower_bouquet.png",
  "06_flower_vase.png",
  "07_teddy_bear_study.png",
  "08_dinosaur_study_fixed.png",
  "09_hanging_stars.png",
  "10_stationery_set.png",
  "11_cloud_stars.png",
  "12_star_bottle.png",
  "14_laptop_tablet_drink.png",
  "15_alarm_clock.png",
  "16_glowing_plant.png",
  "17_headphones_books.png",
  "18_gaming_desk.png",
  "19_watch_wallet_tools.png",
  "20_timer_candle.png",
  "21_sports_gear.png",
  "22_study_woman_white_full.png",
  "23_study_woman_pink_full.png",
  "24_study_woman_coffee_full.png",
  "25_study_woman_laptop_full.png",
  "26_study_woman_navy_full.png",
  "27_study_woman_lavender_full.png",
  "28_study_boy_earphones.png",
] as const;

export type StudyRewardImage = typeof STUDY_REWARD_IMAGES[number];

export interface StudyRewardState {
  owned: StudyRewardImage[];
  selected: StudyRewardImage;
  streak: number;
  lastCompletedDate: string | null;
  lastDrawDate: string | null;
}

export const DEFAULT_STUDY_REWARD_STATE: StudyRewardState = {
  owned: ["0_books_notebook.png"],
  selected: "0_books_notebook.png",
  streak: 0,
  lastCompletedDate: null,
  lastDrawDate: null,
};

export function studyRewardPath(image: StudyRewardImage): string {
  return `/media/study-focus/rewards/${image}`;
}

export function loadStudyRewardState(raw: string | null): StudyRewardState {
  if (!raw) return DEFAULT_STUDY_REWARD_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<StudyRewardState>;
    const valid = new Set<StudyRewardImage>(STUDY_REWARD_IMAGES);
    const owned = Array.from(new Set([
      "0_books_notebook.png" as const,
      ...(Array.isArray(parsed.owned) ? parsed.owned.filter((item): item is StudyRewardImage => valid.has(item as StudyRewardImage)) : []),
    ]));
    const selected = valid.has(parsed.selected as StudyRewardImage) && owned.includes(parsed.selected as StudyRewardImage)
      ? parsed.selected as StudyRewardImage
      : "0_books_notebook.png";
    return {
      owned,
      selected,
      streak: Number.isFinite(parsed.streak) ? Math.max(0, Math.floor(parsed.streak as number)) : 0,
      lastCompletedDate: typeof parsed.lastCompletedDate === "string" ? parsed.lastCompletedDate : null,
      lastDrawDate: typeof parsed.lastDrawDate === "string" ? parsed.lastDrawDate : null,
    };
  } catch {
    return DEFAULT_STUDY_REWARD_STATE;
  }
}

export function localStudyDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function recordStudyCompletion(state: StudyRewardState, now = new Date()): StudyRewardState {
  const today = localStudyDate(now);
  if (state.lastCompletedDate === today) return state;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const streak = state.lastCompletedDate === localStudyDate(yesterday) ? state.streak + 1 : 1;
  return { ...state, streak, lastCompletedDate: today };
}

export function resetStudyProgress(state: StudyRewardState): StudyRewardState {
  return { ...state, streak: 0, lastCompletedDate: null };
}

export function canDrawStudyReward(state: StudyRewardState, now = new Date()): boolean {
  const today = localStudyDate(now);
  return state.lastCompletedDate === today
    && state.lastDrawDate !== today
    && state.owned.length < STUDY_REWARD_IMAGES.length;
}

export function drawStudyReward(state: StudyRewardState, now = new Date(), random = Math.random): StudyRewardState {
  if (!canDrawStudyReward(state, now)) return state;
  const unowned = STUDY_REWARD_IMAGES.filter((image) => !state.owned.includes(image));
  const index = Math.min(unowned.length - 1, Math.floor(Math.max(0, random()) * unowned.length));
  const selected = unowned[index];
  return {
    ...state,
    owned: [...state.owned, selected],
    selected,
    lastDrawDate: localStudyDate(now),
  };
}

export function unlockAllStudyRewardsForTest(state: StudyRewardState, now = new Date()): StudyRewardState {
  return {
    ...state,
    owned: [...STUDY_REWARD_IMAGES],
    lastDrawDate: localStudyDate(now),
  };
}

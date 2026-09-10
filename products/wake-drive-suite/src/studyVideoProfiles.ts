const STUDY_WARNING_VIDEO_TITLES = [
  "훈련교관",
  "저승사자",
  "교관의 기습",
  "선생님",
  "좀비",
  "엄마",
  "마법 선생님",
  "군기반장",
  "귀족 선생님",
  "비밀요원",
  "아버지",
  "처녀귀신",
] as const;

const STUDY_ENDING_VIDEO_TITLES = [
  "공부왕",
  "완벽한 마무리",
  "VIP 합격",
  "슈퍼스타 등장",
  "오늘의 주인공",
  "금메달 수상",
  "저승사자",
  "열공 우승",
  "노력의 나무",
  "열공 스타",
  "황금 독수리",
] as const;

export const STUDY_WARNING_VIDEO_PROFILES = STUDY_WARNING_VIDEO_TITLES.map((name, index) => ({
  id: `study-warning-${index}` as StudyWarningVideoId,
  name,
  path: `/media/study-warning/s${index}.mp4`,
}));

export const STUDY_ENDING_VIDEO_PROFILES = STUDY_ENDING_VIDEO_TITLES.map((name, index) => ({
  id: `study-ending-${index}` as StudyEndingVideoId,
  name,
  path: `/media/study-ending/e${index}.mp4`,
}));

export type StudyWarningVideoId = `study-warning-${number}`;
export type StudyEndingVideoId = `study-ending-${number}`;

export const STUDY_WARNING_VIDEO_STORAGE_KEY = "suha.study-warning-video.v1";
export const STUDY_ENDING_VIDEO_STORAGE_KEY = "suha.study-ending-video.v1";
export const STUDY_WARNING_LIBRARY_STORAGE_KEY = "suha.study-warning-library.v2";
export const STUDY_ENDING_LIBRARY_STORAGE_KEY = "suha.study-ending-library.v2";
export const DEFAULT_STUDY_WARNING_VIDEO_ID: StudyWarningVideoId = "study-warning-0";
export const DEFAULT_STUDY_ENDING_VIDEO_ID: StudyEndingVideoId = "study-ending-0";

export interface StudyVideoLibraryState<Id extends string> {
  downloadedIds: Id[];
  appliedId: Id;
}

export const DEFAULT_STUDY_WARNING_LIBRARY_STATE: StudyVideoLibraryState<StudyWarningVideoId> = {
  downloadedIds: [DEFAULT_STUDY_WARNING_VIDEO_ID],
  appliedId: DEFAULT_STUDY_WARNING_VIDEO_ID,
};

export const DEFAULT_STUDY_ENDING_LIBRARY_STATE: StudyVideoLibraryState<StudyEndingVideoId> = {
  downloadedIds: [DEFAULT_STUDY_ENDING_VIDEO_ID],
  appliedId: DEFAULT_STUDY_ENDING_VIDEO_ID,
};

export function isStudyWarningVideoId(value: unknown): value is StudyWarningVideoId {
  return typeof value === "string"
    && STUDY_WARNING_VIDEO_PROFILES.some((profile) => profile.id === value);
}

export function loadStudyWarningVideoId(storedValue: string | null): StudyWarningVideoId {
  return isStudyWarningVideoId(storedValue) ? storedValue : DEFAULT_STUDY_WARNING_VIDEO_ID;
}

export function getStudyWarningVideoProfile(id: StudyWarningVideoId) {
  return STUDY_WARNING_VIDEO_PROFILES.find((profile) => profile.id === id)
    ?? STUDY_WARNING_VIDEO_PROFILES[0];
}

export function isStudyEndingVideoId(value: unknown): value is StudyEndingVideoId {
  return typeof value === "string"
    && STUDY_ENDING_VIDEO_PROFILES.some((profile) => profile.id === value);
}

export function loadStudyEndingVideoId(storedValue: string | null): StudyEndingVideoId {
  return isStudyEndingVideoId(storedValue) ? storedValue : DEFAULT_STUDY_ENDING_VIDEO_ID;
}

export function getStudyEndingVideoProfile(id: StudyEndingVideoId) {
  return STUDY_ENDING_VIDEO_PROFILES.find((profile) => profile.id === id)
    ?? STUDY_ENDING_VIDEO_PROFILES[0];
}

function loadStudyVideoLibraryState<Id extends string>(
  storedValue: string | null,
  knownIds: readonly Id[],
  defaultId: Id,
): StudyVideoLibraryState<Id> {
  if (!storedValue) return { downloadedIds: [defaultId], appliedId: defaultId };
  try {
    const parsed = JSON.parse(storedValue) as { downloadedIds?: unknown; appliedId?: unknown };
    const known = new Set<string>(knownIds);
    const downloadedIds = Array.isArray(parsed.downloadedIds)
      ? [...new Set(parsed.downloadedIds.filter((id): id is Id => typeof id === "string" && known.has(id)))]
      : [];
    if (!downloadedIds.includes(defaultId)) downloadedIds.unshift(defaultId);
    const appliedId = typeof parsed.appliedId === "string"
      && downloadedIds.includes(parsed.appliedId as Id)
      ? parsed.appliedId as Id
      : defaultId;
    return { downloadedIds, appliedId };
  } catch {
    return { downloadedIds: [defaultId], appliedId: defaultId };
  }
}

export function loadStudyWarningLibraryState(storedValue: string | null) {
  return loadStudyVideoLibraryState(
    storedValue,
    STUDY_WARNING_VIDEO_PROFILES.map((profile) => profile.id),
    DEFAULT_STUDY_WARNING_VIDEO_ID,
  );
}

export function loadStudyEndingLibraryState(storedValue: string | null) {
  return loadStudyVideoLibraryState(
    storedValue,
    STUDY_ENDING_VIDEO_PROFILES.map((profile) => profile.id),
    DEFAULT_STUDY_ENDING_VIDEO_ID,
  );
}

export function addDownloadedStudyVideo<Id extends string>(
  state: StudyVideoLibraryState<Id>,
  id: Id,
): StudyVideoLibraryState<Id> {
  return state.downloadedIds.includes(id)
    ? state
    : { ...state, downloadedIds: [...state.downloadedIds, id] };
}

export function applyDownloadedStudyVideo<Id extends string>(
  state: StudyVideoLibraryState<Id>,
  id: Id,
): StudyVideoLibraryState<Id> {
  return state.downloadedIds.includes(id) ? { ...state, appliedId: id } : state;
}

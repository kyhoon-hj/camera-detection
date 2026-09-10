import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUDY_ENDING_VIDEO_ID,
  DEFAULT_STUDY_ENDING_LIBRARY_STATE,
  DEFAULT_STUDY_WARNING_VIDEO_ID,
  DEFAULT_STUDY_WARNING_LIBRARY_STATE,
  STUDY_ENDING_VIDEO_PROFILES,
  STUDY_WARNING_VIDEO_PROFILES,
  addDownloadedStudyVideo,
  applyDownloadedStudyVideo,
  getStudyEndingVideoProfile,
  getStudyWarningVideoProfile,
  loadStudyEndingLibraryState,
  loadStudyEndingVideoId,
  loadStudyWarningLibraryState,
  loadStudyWarningVideoId,
} from "../src/studyVideoProfiles";

describe("study warning video profiles", () => {
  it("registers all twelve uploaded warning videos in natural order", () => {
    expect(STUDY_WARNING_VIDEO_PROFILES).toHaveLength(12);
    expect(STUDY_WARNING_VIDEO_PROFILES[0].path).toBe("/media/study-warning/s0.mp4");
    expect(STUDY_WARNING_VIDEO_PROFILES[0].name).toBe("훈련교관");
    expect(STUDY_WARNING_VIDEO_PROFILES[11].name).toBe("처녀귀신");
    expect(STUDY_WARNING_VIDEO_PROFILES[11].path).toBe("/media/study-warning/s11.mp4");
  });

  it("restores a known applied profile and falls back safely", () => {
    expect(loadStudyWarningVideoId("study-warning-7")).toBe("study-warning-7");
    expect(loadStudyWarningVideoId("unknown")).toBe(DEFAULT_STUDY_WARNING_VIDEO_ID);
    expect(loadStudyWarningVideoId(null)).toBe(DEFAULT_STUDY_WARNING_VIDEO_ID);
  });

  it("resolves an applied profile", () => {
    expect(getStudyWarningVideoProfile("study-warning-3").path).toBe("/media/study-warning/s3.mp4");
  });

  it("registers and restores all uploaded ending videos", () => {
    expect(STUDY_ENDING_VIDEO_PROFILES).toHaveLength(11);
    expect(STUDY_ENDING_VIDEO_PROFILES[0].path).toBe("/media/study-ending/e0.mp4");
    expect(STUDY_ENDING_VIDEO_PROFILES[0].name).toBe("공부왕");
    expect(STUDY_ENDING_VIDEO_PROFILES[10].name).toBe("황금 독수리");
    expect(STUDY_ENDING_VIDEO_PROFILES[10].path).toBe("/media/study-ending/e10.mp4");
    expect(loadStudyEndingVideoId("study-ending-8")).toBe("study-ending-8");
    expect(loadStudyEndingVideoId("unknown")).toBe(DEFAULT_STUDY_ENDING_VIDEO_ID);
    expect(getStudyEndingVideoProfile("study-ending-4").path).toBe("/media/study-ending/e4.mp4");
  });

  it("provides only profile zero for free in each study library", () => {
    expect(loadStudyWarningLibraryState(null)).toEqual(DEFAULT_STUDY_WARNING_LIBRARY_STATE);
    expect(loadStudyEndingLibraryState(null)).toEqual(DEFAULT_STUDY_ENDING_LIBRARY_STATE);
  });

  it("downloads before applying and restores valid library state", () => {
    const downloaded = addDownloadedStudyVideo(DEFAULT_STUDY_WARNING_LIBRARY_STATE, "study-warning-4");
    expect(downloaded.downloadedIds).toEqual(["study-warning-0", "study-warning-4"]);
    expect(applyDownloadedStudyVideo(DEFAULT_STUDY_WARNING_LIBRARY_STATE, "study-warning-4").appliedId)
      .toBe("study-warning-0");
    expect(applyDownloadedStudyVideo(downloaded, "study-warning-4").appliedId)
      .toBe("study-warning-4");
    const applied = applyDownloadedStudyVideo(downloaded, "study-warning-4");
    expect(loadStudyWarningLibraryState(JSON.stringify({
      downloadedIds: ["study-warning-0", "study-warning-4", "unknown"],
      appliedId: "study-warning-4",
    }))).toEqual(applied);
  });
});

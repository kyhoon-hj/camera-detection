import numpy as np
from suha_core.domain import FeatureFrame, FrameQuality, LandmarkSet
from suha_core.pipeline import CoreRuntime


def test_overlay_draws_hand_bones_between_landmark_points() -> None:
    points = [(0.1, 0.5, 0.0), (0.9, 0.5, 0.0)] + [(0.5, 0.5, 0.0)] * 19
    hand = LandmarkSet(points, [1.0] * 21, "RIGHT")
    features = FeatureFrame("cam", "session", 0, "person", None, hand, None, None, FrameQuality())
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    CoreRuntime._draw_landmarks(image, features)
    assert image[50, 50].any()


def test_overlay_draws_face_contours_without_full_mesh_noise() -> None:
    points = [(0.5, 0.5, 0.0)] * 478
    points[10] = (0.2, 0.2, 0.0)
    points[338] = (0.8, 0.2, 0.0)
    face = LandmarkSet(points, [1.0] * 478)
    features = FeatureFrame("cam", "session", 0, "person", None, None, None, face, FrameQuality())
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    CoreRuntime._draw_landmarks(image, features)
    assert image[20, 50].any()

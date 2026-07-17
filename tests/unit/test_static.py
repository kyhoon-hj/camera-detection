from suha_core.domain import FeatureFrame, FrameQuality, LandmarkSet
from suha_core.recognizers import StaticGestureRecognizer


def test_index_aimed_toward_camera_remains_pointing() -> None:
    points = [(0.5, 0.68, 0.0)] * 21
    points[0] = (0.5, 0.82, 0.0)
    # The index overlaps in image x/y but is straight along depth, which defeats
    # a purely 2D wrist-distance test.
    points[5] = (0.48, 0.54, 0.12)
    points[6] = (0.48, 0.54, 0.02)
    points[7] = (0.48, 0.54, -0.08)
    points[8] = (0.48, 0.54, -0.18)
    # Keep the other fingers visibly curled.
    for mcp, pip, dip, tip, offset in ((9, 10, 11, 12, 0.02), (13, 14, 15, 16, 0.05), (17, 18, 19, 20, 0.08)):
        points[mcp] = (0.5 + offset, 0.58, 0.0)
        points[pip] = (0.5 + offset, 0.53, 0.0)
        points[dip] = (0.55 + offset, 0.57, 0.0)
        points[tip] = (0.53 + offset, 0.62, 0.0)
    hand = LandmarkSet(points, [1.0] * 21, "RIGHT")
    features = FeatureFrame("cam", "session", 1, "person", None, hand, None, None, FrameQuality())

    candidates = StaticGestureRecognizer().process(features)

    assert candidates[0].code == "POINTING_UP"

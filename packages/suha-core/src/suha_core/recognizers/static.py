from __future__ import annotations

from math import acos, degrees, dist

from suha_core.domain import FeatureFrame, LandmarkSet, RecognitionCandidate


def _joint_angle(points: list[tuple[float, float, float]], first: int, center: int, last: int) -> float:
    left = tuple(points[first][axis] - points[center][axis] for axis in range(3))
    right = tuple(points[last][axis] - points[center][axis] for axis in range(3))
    denominator = (sum(value * value for value in left) * sum(value * value for value in right)) ** 0.5
    if denominator <= 1e-8:
        return 0.0
    cosine = max(-1.0, min(1.0, sum(a * b for a, b in zip(left, right, strict=True)) / denominator))
    return degrees(acos(cosine))


def _finger_extended(hand: LandmarkSet, tip: int, dip: int, pip: int, mcp: int, wrist: int = 0) -> bool:
    points = hand.landmarks
    radial_extension = dist(points[tip][:2], points[wrist][:2]) > dist(points[pip][:2], points[wrist][:2]) * 1.12
    # A finger aimed toward the camera is foreshortened in x/y. Its 3D PIP and DIP
    # joints are still nearly straight, so preserve it as extended using z as well.
    straight_in_3d = _joint_angle(points, mcp, pip, dip) >= 145 and _joint_angle(points, pip, dip, tip) >= 150
    return radial_extension or straight_in_3d


class StaticGestureRecognizer:
    plugin_id = "landmark-rule-static"
    plugin_version = "0.1.0"

    def process(self, features: FeatureFrame) -> list[RecognitionCandidate]:
        explicit = features.metadata.get("staticGesture")
        if explicit:
            return [self._candidate(features, str(explicit), 0.99, "RIGHT", {"synthetic": True})]
        candidates: list[RecognitionCandidate] = []
        for hand in (features.left_hand, features.right_hand):
            if hand is None or len(hand.landmarks) < 21:
                continue
            index = _finger_extended(hand, 8, 7, 6, 5)
            middle = _finger_extended(hand, 12, 11, 10, 9)
            ring = _finger_extended(hand, 16, 15, 14, 13)
            pinky = _finger_extended(hand, 20, 19, 18, 17)
            extended = sum((index, middle, ring, pinky))
            thumb_tip = hand.landmarks[4]
            thumb_mcp = hand.landmarks[2]
            wrist = hand.landmarks[0]
            if extended == 4:
                code = "OPEN_PALM"
            elif index and middle and not ring and not pinky:
                code = "VICTORY"
            elif index and not middle and not ring and not pinky:
                code = "POINTING_UP"
            elif extended == 0 and thumb_tip[1] < thumb_mcp[1] - 0.04:
                code = "THUMB_UP"
            elif extended == 0 and thumb_tip[1] > wrist[1] + 0.04:
                code = "THUMB_DOWN"
            elif extended == 0:
                code = "CLOSED_FIST"
            else:
                code = "UNKNOWN"
            candidates.append(
                self._candidate(
                    features,
                    code,
                    0.9 if code != "UNKNOWN" else 0.4,
                    hand.handedness,
                    {"extendedFingers": extended},
                )
            )
        return candidates

    def _candidate(
        self,
        features: FeatureFrame,
        code: str,
        confidence: float,
        handedness: str | None,
        metadata: dict[str, object],
    ) -> RecognitionCandidate:
        return RecognitionCandidate(
            "GESTURE_STATIC",
            code,
            confidence,
            features.person_id,
            handedness,
            features.timestamp_ms,
            features.timestamp_ms,
            self.plugin_id,
            metadata=metadata,
        )

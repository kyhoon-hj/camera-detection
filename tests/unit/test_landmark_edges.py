from __future__ import annotations

import numpy as np
import pytest
from suha_core.landmarks.providers import _edge_padded_hand_frame, _unpad_hand_coordinate
from suha_core.pipeline.runtime import _fit_analysis_size


def test_pen_analysis_preserves_camera_aspect_ratio() -> None:
    assert _fit_analysis_size(1280, 720) == (640, 360)
    assert _fit_analysis_size(720, 1280) == (270, 480)
    assert _fit_analysis_size(320, 240) == (320, 240)


def test_hand_edge_padding_maps_camera_bounds_back_exactly() -> None:
    rgb = np.full((100, 200, 3), 80, dtype=np.uint8)
    padded, (pad_x, pad_y) = _edge_padded_hand_frame(rgb)
    assert padded.shape == rgb.shape

    top_left = _unpad_hand_coordinate(pad_x / 200, pad_y / 100, 200, 100, pad_x, pad_y)
    bottom_right = _unpad_hand_coordinate(
        (200 - pad_x) / 200,
        (100 - pad_y) / 100,
        200,
        100,
        pad_x,
        pad_y,
    )
    assert top_left == pytest.approx((0.0, 0.0))
    assert bottom_right == pytest.approx((1.0, 1.0))

"""Unit tests for ``counting.mpp`` (#1868)."""

import pytest

from app.counting.mpp import mpp_from_metadata, nuclei_downsample


@pytest.mark.parametrize(
    "metadata,expected",
    [
        (None, None),
        ({}, None),
        # mpp_x straight through.
        ({"mpp_x": 0.25}, 0.25),
        ({"mpp_x": 2}, 2.0),
        # mpp_x wins over a derived scale.
        (
            {
                "mpp_x": 0.11,
                "measurement_scale": 4.0,
                "measurement_unit": "um",
            },
            0.11,
        ),
        # Garbage mpp_x falls through to the scale fallback.
        ({"mpp_x": True, "measurement_scale": 4.0}, 0.25),
        ({"mpp_x": 0, "measurement_scale": 4.0}, 0.25),
        ({"mpp_x": -1, "measurement_scale": 4.0}, 0.25),
        ({"mpp_x": "0.5", "measurement_scale": 4.0}, 0.25),
        # Approved scale → µm/px per unit (scale = px per unit).
        ({"measurement_scale": 4.0, "measurement_unit": "um"}, 0.25),
        ({"measurement_scale": 4000.0, "measurement_unit": "mm"}, 0.25),
        ({"measurement_scale": 0.004, "measurement_unit": "nm"}, 0.25),
        ({"measurement_scale": 40000.0, "measurement_unit": "cm"}, 0.25),
        # A missing unit defaults to "um" (the metadata contract writes
        # it alongside the scale).
        ({"measurement_scale": 4.0}, 0.25),
        ({"measurement_scale": 4.0, "measurement_unit": None}, 0.25),
        # Unknown unit or unusable scale -> absent.
        ({"measurement_scale": 4.0, "measurement_unit": "px"}, None),
        # Free-form metadata: non-string units are unusable, not errors.
        ({"measurement_scale": 4.0, "measurement_unit": ["um"]}, None),
        ({"measurement_scale": 4.0, "measurement_unit": {"u": "um"}}, None),
        ({"measurement_scale": 4.0, "measurement_unit": 5}, None),
        ({"measurement_scale": 0}, None),
        ({"measurement_scale": -3}, None),
        ({"measurement_scale": "4"}, None),
        ({"measurement_scale": True}, None),
        # Derived value outside the plausible microscopy range is absent.
        ({"measurement_scale": 0.001}, None),   # 1000 µm/px
        ({"measurement_scale": 10_000_000}, None),  # 1e-7 µm/px
        # Bounds are inclusive.
        ({"measurement_scale": 100.0}, 0.01),
        ({"measurement_scale": 0.01}, 100.0),
        # Extra keys are ignored.
        ({"mpp_x": 0.5, "annotations": []}, 0.5),
    ],
)
def test_mpp_from_metadata(metadata, expected) -> None:
    assert mpp_from_metadata(metadata) == expected


@pytest.mark.parametrize(
    "mpp,max_d,expected",
    [
        # No pixel size -> level 0 regardless of budget headroom.
        (None, 8, 1),
        (0, 8, 1),
        (-1.0, 8, 1),
        # Coarsest d inside the ~0.5 µm/px sweet spot.
        (0.5, 8, 1),    # 0.5*2 > 0.5
        (0.3, 8, 1),    # 0.3*2 > 0.5
        (0.25, 8, 2),   # 0.25*2 = 0.5
        (0.1, 8, 4),    # 0.1*4 = 0.4
        (0.01, 8, 8),   # capped by max_downsample
        (0.25, 1, 1),   # max_downsample itself bounds d
        (0.25, 2, 2),
    ],
)
def test_nuclei_downsample(mpp, max_d, expected) -> None:
    """Must match ``pipeline._choose_downsample``'s nuclei branch."""
    assert nuclei_downsample(mpp, max_d) == expected

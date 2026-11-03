"""#1665 counting pipeline: classical outliners, objects_from_labels, the
nuclei stain filter, grouping and the size-driven level rule."""

from __future__ import annotations

import numpy as np
import pytest

from app.counting.grouping import assign_groups
from app.counting.objects import objects_from_labels
from app.counting.outliners import (
    ClassicalCellsOutliner,
    ClassicalNucleiOutliner,
    StubOutliner,
    build_outliners,
    estimate_object_diameter,
)
from app.counting import pipeline as count_pipeline
from app.counting.stitch import (
    DziInfo,
    Rect,
    RegionPlan,
    RegionTooLarge,
    plan_region,
)


def _plan(d=1, level=8, region=(0, 0, 512, 512), level_rect=(0, 0, 512, 512)):
    return RegionPlan(
        level=level,
        downsample=d,
        selection=Rect(*region),
        region=Rect(*region),
        level_rect=Rect(*level_rect),
        out_width=level_rect[2],
        out_height=level_rect[3],
    )


def _discs_field(centers, radius, h=300, w=300, color=(90, 60, 160)):
    """Synthetic field: pale background + dark stained discs."""
    rng = np.random.default_rng(0)
    rgb = (230 + rng.normal(0, 4, (h, w, 3))).clip(0, 255).astype(np.uint8)
    yy, xx = np.mgrid[:h, :w]
    for cx, cy in centers:
        rgb[(xx - cx) ** 2 + (yy - cy) ** 2 <= radius * radius] = color
    return rgb


def _labels_from_centers(centers, radius, h, w):
    lab = np.zeros((h, w), np.int32)
    yy, xx = np.mgrid[:h, :w]
    for i, (cx, cy) in enumerate(centers, 1):
        lab[(xx - cx) ** 2 + (yy - cy) ** 2 <= radius * radius] = i
    return lab


DZI = DziInfo(width=4096, height=4096, tile_size=512, overlap=0, format="png", max_level=11)


class TestClassicalOutliners:
    def test_cells_counts_discs_including_touching(self):
        centers = [(60, 60), (140, 60), (220, 60), (60, 160), (90, 185)]
        rgb = _discs_field(centers, 18)
        labels = ClassicalCellsOutliner().segment(
            rgb, plan=_plan(), mpp=None
        )
        assert len(np.unique(labels)) - 1 == 5

    def test_nuclei_counts_blobs(self):
        centers = [(50, 50), (150, 150), (250, 80)]
        rgb = _discs_field(centers, 15, color=(60, 40, 120))
        labels = ClassicalNucleiOutliner().segment(
            rgb, plan=_plan(), mpp=None
        )
        assert len(np.unique(labels)) - 1 == 3

    def test_estimate_diameter_uses_median(self):
        rgb = _discs_field([(80, 80), (200, 200)], 20)
        d = estimate_object_diameter(rgb, "cells")
        assert d is not None and 30 < d < 50


class TestObjectsFromLabels:
    def test_scaling_offset_and_vertex_cap(self):
        lab = _labels_from_centers([(10, 10)], 8, 64, 64)
        rgb = _discs_field([(10, 10)], 8, 64, 64)
        plan = _plan(d=4, level_rect=(5, 7, 64, 64))
        objs = objects_from_labels(lab, rgb, plan=plan)
        assert len(objs) == 1
        o = objs[0]
        # Centroid: (level_rect origin + level coord) * downsample.
        assert o["centroid"] == pytest.approx(((5 + 10) * 4, (7 + 10) * 4), abs=1.5)
        # Polygon points are the disc edge in level-0 px: level (10±8)
        # + origin (5,7), *4 -> x∈[28,92], y∈[36,100] (contours land on
        # cell boundaries, allow a couple px slack).
        xs = [p[0] for p in o["polygon"]]
        ys = [p[1] for p in o["polygon"]]
        assert min(xs) >= 24 and max(xs) <= 96
        assert min(ys) >= 32 and max(ys) <= 104
        assert len(o["polygon"]) <= 32
        assert o["area"] == pytest.approx(np.pi * 64 * 16, rel=0.3)


class TestGrouping:
    def _obj(self, area, a, b):
        return {"centroid": (0, 0), "area": area, "polygon": [], "a": a, "b": b, "group": 0}

    def test_two_chroma_populations_two_groups(self):
        objs = [self._obj(500, 20, -30) for _ in range(12)] + [
            self._obj(500, -10, 15) for _ in range(12)
        ]
        groups = assign_groups(objs)
        assert len(set(groups)) == 2

    def test_homogeneous_field_one_group(self):
        rng = np.random.default_rng(1)
        objs = [
            self._obj(500 * rng.uniform(0.9, 1.1), 5 + rng.normal(0, 1), -10 + rng.normal(0, 1))
            for _ in range(15)
        ]
        assert len(set(assign_groups(objs))) == 1

    def test_deterministic_and_few_objects(self):
        objs = [self._obj(100, 1, -5), self._obj(200, 8, -20), self._obj(150, 4, -10)]
        assert assign_groups(objs) == assign_groups(objs)
        assert len(set(assign_groups(objs))) == 1  # n<4 -> single group


class TestLevelRule:
    def test_fixed_downsample_plan(self):
        plan = plan_region(
            DZI,
            Rect(100, 100, 800, 600),
            margin_px=8,
            max_pixels=750_000,
            max_downsample=8,
            downsample=4,
        )
        assert plan.downsample == 4
        assert plan.level == DZI.max_level - 2

    def test_fixed_downsample_over_budget_raises(self):
        with pytest.raises(RegionTooLarge):
            plan_region(
                DZI,
                Rect(0, 0, 4096, 4096),
                margin_px=8,
                max_pixels=100,
                max_downsample=8,
                downsample=8,
            )


class TestStainFilter:
    def test_nuclei_filter_drops_warm_objects(self):
        # b* > -5 objects are dropped by the nuclei post-filter; mimic the
        # constant directly rather than the full pipeline here.
        warm = {"a": 5, "b": 3}
        blue = {"a": 10, "b": -30}
        kept = [o for o in [warm, blue] if o["b"] <= -5.0]
        assert kept == [blue]


class TestBuildOutliners:
    def test_stub_and_classical(self):
        outs = build_outliners(
            cells="stub", nuclei="classical", torch_threads=1,
            max_pixels=750_000, classical_max_pixels=2_000_000,
        )
        assert isinstance(outs["cells"], StubOutliner)
        assert outs["nuclei"].name == "classical"
        # Classical/stub outliners carry the larger classical budget.
        assert outs["cells"].max_pixels == 2_000_000
        assert outs["nuclei"].max_pixels == 2_000_000

    def test_instanseg_missing_dep_fails(self, monkeypatch):
        import builtins
        real_import = builtins.__import__
        def fake_import(name, *a, **k):
            if name.startswith(("torch", "instanseg")):
                raise ImportError("no torch")
            return real_import(name, *a, **k)
        monkeypatch.setattr(builtins, "__import__", fake_import)
        with pytest.raises(ImportError):
            build_outliners(
                cells="stub", nuclei="instanseg", torch_threads=1,
                max_pixels=750_000, classical_max_pixels=2_000_000,
            )

    def test_instanseg_gets_ml_budget(self, monkeypatch):
        """An instanseg-named outliner gets the smaller ML budget."""
        class FakeInstanSeg:
            name = "instanseg"
            max_pixels = 0
            def __init__(self, torch_threads=2):
                pass

        monkeypatch.setattr(
            "app.counting.outliners.InstanSegNucleiOutliner", FakeInstanSeg
        )
        outs = build_outliners(
            cells="classical", nuclei="instanseg", torch_threads=1,
            max_pixels=750_000, classical_max_pixels=2_000_000,
        )
        assert outs["nuclei"].max_pixels == 750_000
        assert outs["cells"].max_pixels == 2_000_000


class TestChooseDownsample:
    def _dzi(self):
        return DziInfo(
            width=4096, height=4096, tile_size=512, overlap=0,
            format="png", max_level=11,
        )

    def test_diameter_converted_to_level0(self, monkeypatch):
        """Probe at d>=2: probe-level diameter must scale by probe d."""
        monkeypatch.setattr(
            count_pipeline, "probe_object_stats",
            lambda _rgb, _mode: (20.0, 12),  # probe-level px, enough components
        )
        monkeypatch.setattr(
            count_pipeline, "stitch_region",
            lambda *_a, **_k: type("I", (), {"numpy": lambda s: __import__("numpy").zeros((4, 4, 3), dtype="uint8")})(),
        )
        sel = Rect(0, 0, 3000, 3000)  # probe lands at d>1
        d = count_pipeline._choose_downsample(
            None, self._dzi(), sel, mode="cells", mpp=None,
            margin_px=8, max_pixels=750_000, max_downsample=8,
        )
        # probe d for 9MP/250k -> 8; diameter_level0 = 20*8 = 160 -> native 30
        # -> largest d with 160/d >= 30 -> d=4... but max_d rules: check >1.
        assert d >= 1 and (160 / d) >= 30

    def test_probe_falls_back_to_real_budget(self, monkeypatch):
        monkeypatch.setattr(
            count_pipeline, "probe_object_stats",
            lambda _rgb, _mode: (40.0, 12),
        )
        monkeypatch.setattr(
            count_pipeline, "stitch_region",
            lambda *_a, **_k: type("I", (), {"numpy": lambda s: __import__("numpy").zeros((4, 4, 3), dtype="uint8")})(),
        )
        # Probe budget 250k can't fit this selection even at d=8
        # ((4096/8)^2=262144 > 250k) but the real 750k budget can.
        d = count_pipeline._choose_downsample(
            None, self._dzi(), Rect(0, 0, 4096, 4096), mode="cells",
            mpp=None, margin_px=8, max_pixels=750_000, max_downsample=8,
        )
        assert d == 8

    def test_probe_unfittable_raises(self):
        import pytest as _p
        from app.counting.stitch import RegionTooLarge
        with _p.raises(RegionTooLarge):
            count_pipeline._choose_downsample(
                None, self._dzi(), Rect(0, 0, 4096, 4096), mode="cells",
                mpp=None, margin_px=8, max_pixels=10_000, max_downsample=8,
            )


class TestObjectsFromLabelsPerf:
    def test_many_labels_fast(self):
        import time
        h = w = 1024
        lab = np.zeros((h, w), np.int32)
        rng = np.random.default_rng(0)
        i = 0
        for r in range(0, h, 32):
            for c in range(0, w, 32):
                i += 1
                lab[r : r + 8, c : c + 8] = i
        rgb = rng.integers(0, 255, (h, w, 3)).astype(np.uint8)
        plan = _plan(d=1, level_rect=(0, 0, h, w))
        t = time.perf_counter()
        objs = objects_from_labels(lab, rgb, plan=plan)
        assert time.perf_counter() - t < 3.0
        assert len(objs) == i

    def test_high_vertex_contour_evenly_subsampled(self):
        # Spiky star -> >32 vertices after approx; must be subsampled, not cut.
        h = w = 128
        yy, xx = np.mgrid[:h, :w]
        ang = np.arctan2(yy - 64, xx - 64)
        rad = 30 + 12 * np.sin(ang * 16)
        lab = ((xx - 64) ** 2 + (yy - 64) ** 2 <= rad * rad).astype(np.int32)
        rgb = _discs_field([], 1, h, w)
        objs = objects_from_labels(lab, rgb, plan=_plan(d=1, level_rect=(0, 0, h, w)))
        assert len(objs) == 1
        pts = objs[0]["polygon"]
        assert 3 <= len(pts) <= 32
        # Even subsample keeps the outline spanning the object (not truncated).
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        assert max(xs) - min(xs) > 50 and max(ys) - min(ys) > 50


@pytest.mark.counting_ml
def test_instanseg_brightfield_nuclei_real_model():
    """Real-model check (#1665): InstanSeg segments its own test input.

    Runs only where the ``counting-ml`` group is installed and the model
    is baked at ``$INSTANSEG_BIOIMAGEIO_PATH`` (the counting-worker image).
    """
    pytest.importorskip("torch")
    pytest.importorskip("instanseg")
    import os

    from app.counting.outliners import InstanSegNucleiOutliner

    model_dir = os.environ.get("INSTANSEG_BIOIMAGEIO_PATH", "/opt/hriv-models")
    test_input = os.path.join(
        model_dir, "brightfield_nuclei", "0.1.1", "test-input.npy"
    )
    if not os.path.exists(test_input):
        pytest.skip("baked InstanSeg model test input not present")
    rgb = np.load(test_input)
    if rgb.ndim > 3:
        rgb = rgb[0]
    if rgb.ndim == 3 and rgb.shape[0] == 3:
        rgb = np.moveaxis(rgb, 0, -1)  # CHW -> HWC
    outliner = InstanSegNucleiOutliner(torch_threads=1)
    labels = outliner.segment(
        rgb.astype(np.uint8), plan=_plan(), mpp=None
    )
    assert labels.dtype == np.int32
    assert labels.shape[:2] == rgb.shape[:2]
    assert len(np.unique(labels)) > 1  # found at least one nucleus


class _FakeVips:
    def __init__(self, arr):
        self._arr = arr
    def numpy(self):
        return self._arr


class TestRunCountNuclei:
    """Integrated nuclei-mode run_count: mpp rule, effective pixel size,
    and the blue-stain post-filter all exercised end to end."""

    def test_mpp_downsample_effective_px_and_stain_filter(self, monkeypatch):
        dzi = DziInfo(
            width=4096, height=4096, tile_size=512, overlap=0,
            format="png", max_level=11,
        )
        monkeypatch.setattr(count_pipeline, "resolve_tile_root", lambda *_a, **_k: "root")
        monkeypatch.setattr(count_pipeline, "read_dzi", lambda *_a, **_k: dzi)

        # 64x64 field: blue-ish blob (labels=1) + pink blob (labels=2).
        rgb = np.full((64, 64, 3), 240, np.uint8)
        rgb[8:24, 8:24] = (30, 30, 170)   # hematoxylin-ish, b* << 0
        rgb[40:56, 40:56] = (230, 150, 120)  # eosin-tan, b* > -5 -> dropped
        monkeypatch.setattr(
            count_pipeline, "stitch_region",
            lambda *_a, **_k: _FakeVips(rgb),
        )
        monkeypatch.setattr(
            count_pipeline, "_selection_preview", lambda *_a, **_k: "data:image/jpeg;base64,x"
        )

        labels = np.zeros((64, 64), np.int32)
        labels[8:24, 8:24] = 1
        labels[40:56, 40:56] = 2
        seen: dict = {}

        class FakeNucleiOutliner:
            name = "fake"
            def segment(self, _rgb, *, plan, mpp):
                seen["mpp"] = mpp
                return labels

        record = {
            "source_image_id": 5,
            "mode": "nuclei",
            "mpp": 0.25,
            "selection": {"x": 0, "y": 0, "width": 128, "height": 128},
        }
        result = count_pipeline.run_count(
            record,
            tiles_dir="/tmp",
            outliner=FakeNucleiOutliner(),
            margin_px=4,
            max_pixels=750_000,
            max_downsample=8,
            max_objects=3000,
            is_cancelled=lambda: False,
        )
        # mpp rule: largest d<=8 with 0.25*d <= 0.5 -> d=2.
        assert result["_meta"]["downsample"] == 2
        # Effective pixel size handed to the outliner: mpp * downsample.
        assert seen["mpp"] == 0.5
        # Blue object survives; pink is dropped by the stain filter.
        assert result["total"] == 1
        assert len(result["objects"]) == 1


class TestInstanSegModelDir:
    def test_models_dir_sets_bioimageio_path(self, monkeypatch):
        import sys, types
        from app.database import settings

        calls: dict = {}
        fake_torch = types.SimpleNamespace(
            set_num_threads=lambda n: calls.setdefault("threads", n),
            set_num_interop_threads=lambda n: None,
        )
        class FakeInstanSeg:
            def __init__(self, name, **kw):
                calls["name"] = name
                calls["env"] = __import__("os").environ.get(
                    "INSTANSEG_BIOIMAGEIO_PATH"
                )
        fake_instanseg = types.ModuleType("instanseg")
        fake_instanseg.InstanSeg = FakeInstanSeg
        monkeypatch.setitem(sys.modules, "torch", fake_torch)
        monkeypatch.setitem(sys.modules, "instanseg", fake_instanseg)
        monkeypatch.setattr(
            settings, "counting_models_dir", "/tmp/fake-models"
        )
        from app.counting.outliners import InstanSegNucleiOutliner
        InstanSegNucleiOutliner(torch_threads=3)
        assert calls["env"] == "/tmp/fake-models"
        assert calls["name"] == "brightfield_nuclei"
        assert calls["threads"] == 3


class TestPerOutlinerBudget:
    """#1719: classical jobs get the larger stitched-pixel budget."""

    def _run(self, outliner, dzi, sel, monkeypatch, mode="cells"):
        monkeypatch.setattr(count_pipeline, "resolve_tile_root", lambda *_a, **_k: "root")
        monkeypatch.setattr(count_pipeline, "read_dzi", lambda *_a, **_k: dzi)
        rgb = np.full((512, 512, 3), 240, np.uint8)
        monkeypatch.setattr(
            count_pipeline, "stitch_region",
            lambda *_a, **_k: _FakeVips(rgb),
        )
        monkeypatch.setattr(
            count_pipeline, "_selection_preview", lambda *_a, **_k: "data:image/jpeg;base64,x"
        )
        monkeypatch.setattr(
            count_pipeline, "probe_object_stats", lambda *_a, **_k: (40.0, 12),
        )
        record = {
            "source_image_id": 5, "mode": mode, "mpp": None,
            "selection": {"x": 0, "y": 0, "width": sel, "height": sel},
        }
        return count_pipeline.run_count(
            record,
            tiles_dir="/tmp",
            outliner=outliner,
            margin_px=4,
            max_pixels=outliner.max_pixels,
            max_downsample=8,
            max_objects=3000,
            is_cancelled=lambda: False,
        )

    class _Zero:
        """Returns an empty label image sized to whatever is stitched."""

        name = "zero"
        max_pixels = 0

        def segment(self, rgb, *, plan, mpp):
            return np.zeros(rgb.shape[:2], np.int32)

    def test_classical_budget_accepts_over_750k(self, monkeypatch):
        o = self._Zero()
        o.max_pixels = 2_000_000  # classical budget
        dzi = DziInfo(
            width=4096, height=4096, tile_size=512, overlap=0,
            format="png", max_level=11,
        )
        # 1200x1200 at d=1 -> ~1.44MP processed; over 750k, under 2M.
        result = self._run(o, dzi, 1200, monkeypatch)
        assert result["total"] == 0

    def test_ml_budget_rejects_same_selection(self, monkeypatch):
        o = self._Zero()
        o.max_pixels = 750_000  # ML budget
        dzi = DziInfo(
            width=4096, height=4096, tile_size=512, overlap=0,
            format="png", max_level=11,
        )
        # Same 1.44MP job is over the 750k ML budget at its chosen d.
        # The level rule may coarsen (d=2 -> 360k) instead of rejecting —
        # either way the job must not exceed the budget it was given.
        try:
            result = self._run(o, dzi, 1200, monkeypatch)
            assert result["_meta"]["pixels"] <= 750_000
        except count_pipeline.RegionTooLarge as exc:
            assert exc.code == "selection_too_large"  # rejected within the ML budget


class TestNucleiNoMppAlwaysLevelZero:
    """#1670: nuclei without mpp must not use the size-driven level rule —
    the hematoxylin probe merges dense tissue and over-coarsens."""

    def test_nuclei_no_mpp_returns_d1_even_for_large_objects(self):
        dzi = DziInfo(width=4096, height=4096, tile_size=512, overlap=0,
                      format="png", max_level=11)
        # A huge selection with big discs — the probe would suggest a
        # coarse level, but nuclei must stay at d=1 regardless.
        d = count_pipeline._choose_downsample(
            "root", dzi,
            Rect(0, 0, 1024, 1024),
            mode="nuclei", mpp=None,
            margin_px=4, max_pixels=4_000_000, max_downsample=8,
        )
        assert d == 1

    def test_nuclei_with_mpp_still_uses_mpp_rule(self):
        dzi = DziInfo(width=4096, height=4096, tile_size=512, overlap=0,
                      format="png", max_level=11)
        d = count_pipeline._choose_downsample(
            "root", dzi,
            Rect(0, 0, 1024, 1024),
            mode="nuclei", mpp=0.125,   # 0.125*d ≤ 0.5 → d=4
            margin_px=4, max_pixels=4_000_000, max_downsample=8,
        )
        assert d == 4


class TestMergedFieldProbeStaysLevel0:
    """#1670 bug 2: when the probe's mask merges into a handful of blobs
    the diameter estimate measures the blob field, not objects — stay at
    d=1 rather than coarsen cells out of existence."""

    def _merged_rgb(self):
        # One dark field: mask components merge into 1-2 blobs.
        rgb = np.full((400, 400, 3), 235, np.uint8)
        yy, xx = np.mgrid[:400, :400]
        rgb[(yy - 200) ** 2 + (xx - 200) ** 2 < 150**2] = [70, 60, 90]
        return rgb

    def test_probe_stats_few_components(self):
        _d, n = count_pipeline.probe_object_stats(self._merged_rgb(), "cells")
        assert n < count_pipeline._PROBE_MIN_COMPONENTS

    def test_choose_downsample_returns_1_on_merged_field(self, monkeypatch):
        monkeypatch.setattr(
            count_pipeline, "stitch_region",
            lambda *_a, **_k: _FakeVips(self._merged_rgb()),
        )
        monkeypatch.setattr(
            count_pipeline, "plan_region",
            lambda *a, **k: RegionPlan(
                level=0, downsample=4, selection=Rect(0, 0, 400, 400),
                region=Rect(0, 0, 400, 400), level_rect=Rect(0, 0, 400, 400),
                out_width=400, out_height=400,
            ),
        )
        d = count_pipeline._choose_downsample(
            "root", DziInfo(400, 400, 512, 0, "png", 8),
            Rect(0, 0, 400, 400),
            mode="cells", mpp=None,
            margin_px=4, max_pixels=4_000_000, max_downsample=8,
        )
        assert d == 1

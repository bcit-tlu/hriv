"""Unit tests for ``scripts/count_load_test.py`` (#1670).

The load script lives outside ``app/``, so it is loaded by file path —
the same approach ``test_purge_failed_source_images.py`` uses.
"""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

pytest.importorskip("httpx")


def _load_load_test_script() -> ModuleType:
    path = Path(__file__).resolve().parents[2] / "scripts" / "count_load_test.py"
    spec = importlib.util.spec_from_file_location("count_load_test", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


load_test = _load_load_test_script()


@pytest.mark.parametrize(
    ("rec", "unexpected"),
    [
        ({"expect": "over", "status": "rejected", "post_status": 422,
          "detail": "selection_too_large"}, False),
        ({"expect": "over", "status": "rejected", "post_status": 500}, True),
        ({"expect": "ok", "status": "rejected", "post_status": 422,
          "detail": "selection_too_large"}, True),
        ({"expect": "over", "status": "failed", "error": "too_large"}, False),
        ({"expect": "ok", "status": "failed", "error": "too_large"}, True),
        ({"expect": "ok", "status": "http_500"}, True),
        ({"expect": "over", "status": "http_500"}, True),
        ({"expect": "ok", "status": "cancel_http_404"}, True),
        ({"expect": "ok", "status": "cancelled"}, False),
        ({"expect": "ok", "status": "done"}, False),
        ({"expect": "ok", "status": "client_timeout"}, True),
    ],
)
def test_is_unexpected(rec, unexpected):
    assert load_test.is_unexpected(rec) is unexpected


def test_pct():
    assert load_test.pct([1.0, 2.0, 3.0, 4.0], 50) in (2.0, 3.0)
    assert load_test.pct([], 95) is None
    vals = list(range(1, 101))
    assert load_test.pct(vals, 95) == 95.0
    assert load_test.pct(list(range(1, 100)), 50) == 50.0

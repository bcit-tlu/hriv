"""Tests for component build/version metric rendering."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from unittest.mock import patch

from app.build_info_metrics import render_build_info_metrics
from app.synthetic_result import StoredSyntheticJourneyState, SyntheticJourneyResult, SyntheticJourneyStep


def _synthetic_state() -> StoredSyntheticJourneyState:
    now = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)
    return StoredSyntheticJourneyState(
        latest_result=SyntheticJourneyResult(
            event_version=1,
            started_at=now,
            completed_at=now,
            success=True,
            duration_ms=1000,
            component_version="2.3.4-rc.abcdef0",
            steps=[SyntheticJourneyStep(name="frontend", success=True, duration_ms=1000)],
        ),
        last_success_completed_at=now,
        updated_at=now,
    )


async def test_render_build_info_metrics_includes_all_components(tmp_path) -> None:
    backup_version = tmp_path / "backup-version"
    backup_version.write_text("1.2.3-rc.abc1234\n")
    backup_image_tag = tmp_path / "backup-image-tag"
    backup_image_tag.write_text("1.2.3-rc.20260714120000.abc1234\n")
    frontend_version = tmp_path / "frontend-version"
    frontend_version.write_text("4.5.6\n")
    frontend_image_tag = tmp_path / "frontend-image-tag"
    frontend_image_tag.write_text("1.9.0-rc.20260714120500.def5678\n")

    env = {
        **os.environ,
        "APP_VERSION": "9.8.7",
        "APP_IMAGE_TAG": "9.8.7-rc.20260714121000.123abcd",
        "WORKER_VERSION": "9.8.7",
        "WORKER_IMAGE_TAG": "sha-456def0",
        "BACKUP_VERSION_FILE": str(backup_version),
        "BACKUP_IMAGE_TAG_FILE": str(backup_image_tag),
        "FRONTEND_VERSION_FILE": str(frontend_version),
        "FRONTEND_IMAGE_TAG_FILE": str(frontend_image_tag),
        "SYNTHETIC_COMMIT_SHA": "fedcba9",
    }

    with (
        patch.dict(os.environ, env, clear=True),
        patch("app.build_info_metrics.load_stored_synthetic_result_state", return_value=_synthetic_state()),
    ):
        content, _ = await render_build_info_metrics()

    assert b'hriv_build_info{commit_sha="123abcd",component="backend",version="9.8.7"} 1.0' in content
    assert b'hriv_build_info{commit_sha="456def0",component="worker",version="9.8.7"} 1.0' in content
    assert b'hriv_build_info{commit_sha="abc1234",component="backup",version="1.2.3-rc.abc1234"} 1.0' in content
    assert b'hriv_build_info{commit_sha="def5678",component="frontend",version="4.5.6"} 1.0' in content
    assert (
        b'hriv_build_info{commit_sha="fedcba9",component="synthetic",version="2.3.4-rc.abcdef0"} 1.0'
        in content
    )


async def test_render_build_info_metrics_falls_back_to_unknowns() -> None:
    with (
        patch.dict(os.environ, {}, clear=True),
        patch("app.build_info_metrics.load_stored_synthetic_result_state", return_value=None),
    ):
        content, _ = await render_build_info_metrics()

    assert b'component="frontend",version="unknown"' in content
    assert b'component="synthetic",version="unknown"' in content
    assert b'commit_sha="unknown",component="backup"' in content

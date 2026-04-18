#!/usr/bin/env python3
"""Verify that the two copies of the frontend nginx config are in sync.

HRIV deploys its SPA-reverse-proxy nginx config from two places:

* ``frontend/nginx.conf.template``
    Baked into the production Docker image as a fallback.  Used when the
    image is run without a ConfigMap override (standalone Docker, local
    `docker run`, etc.).

* ``charts/frontend/values.yaml`` → ``configMounts[0].data."default.conf.template"``
    Authoritative copy used by the Helm chart.  Kubernetes mounts this
    as a ConfigMap at ``/etc/nginx/templates/default.conf.template``,
    which shadows the baked-in copy above.

Edits must be made in **both** places or the two deployment paths will
drift apart — which has already caused incidents (see issue #37).  This
script extracts the inline value from ``values.yaml`` and diffs it
against ``frontend/nginx.conf.template``; CI invokes it and fails the
build on any mismatch.

Uses only the Python stdlib so it runs on the CI runner without an
extra ``poetry install`` or ``pip install`` step.
"""

from __future__ import annotations

import difflib
import pathlib
import sys
from typing import Optional


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
FRONTEND_COPY = REPO_ROOT / "frontend" / "nginx.conf.template"
VALUES_YAML = REPO_ROOT / "charts" / "frontend" / "values.yaml"

# Marker identifying the block scalar we want to extract.  We use a
# literal YAML path rather than a full YAML parser so the script has no
# third-party dependencies.
SENTINEL = "default.conf.template: |-"


def _extract_block_scalar(yaml_text: str, sentinel: str) -> Optional[str]:
    """Return the contents of the ``|-`` block scalar following ``sentinel``.

    The block scalar is assumed to be indented more deeply than the line
    containing ``sentinel``; we use the first non-empty line's indent as
    the reference prefix and strip exactly that many leading spaces from
    every subsequent line.  The scalar ends at the first line whose
    indentation is less than or equal to the sentinel's own indent (or
    at end-of-file).
    """
    lines = yaml_text.splitlines()
    for i, line in enumerate(lines):
        if line.lstrip().startswith(sentinel):
            sentinel_indent = len(line) - len(line.lstrip())
            break
    else:
        return None

    # Find the first non-empty line after the sentinel to determine the
    # block scalar's base indentation.
    base_indent: Optional[int] = None
    scalar_lines: list[str] = []
    for j in range(i + 1, len(lines)):
        body = lines[j]
        if body.strip() == "":
            scalar_lines.append("")
            continue
        current_indent = len(body) - len(body.lstrip())
        if current_indent <= sentinel_indent:
            # Dedented back out of the scalar — we're done.
            break
        if base_indent is None:
            base_indent = current_indent
        # Strip exactly ``base_indent`` spaces (preserve any excess, which
        # is meaningful inside nginx ``server {}`` block content).
        scalar_lines.append(body[base_indent:])

    if base_indent is None:
        return ""

    # ``|-`` strips the final trailing newline; emulate that by popping
    # any trailing blank lines before re-joining.
    while scalar_lines and scalar_lines[-1] == "":
        scalar_lines.pop()
    return "\n".join(scalar_lines) + "\n"


def main() -> int:
    if not FRONTEND_COPY.is_file():
        print(f"error: missing {FRONTEND_COPY}", file=sys.stderr)
        return 2
    if not VALUES_YAML.is_file():
        print(f"error: missing {VALUES_YAML}", file=sys.stderr)
        return 2

    frontend_text = FRONTEND_COPY.read_text()
    chart_text = _extract_block_scalar(VALUES_YAML.read_text(), SENTINEL)
    if chart_text is None:
        print(
            f"error: could not find '{SENTINEL}' block scalar in {VALUES_YAML}",
            file=sys.stderr,
        )
        return 2

    if frontend_text == chart_text:
        print("nginx configs are in sync ✓")
        return 0

    print(
        "nginx configs drifted — frontend/nginx.conf.template and the inline\n"
        "ConfigMap template in charts/frontend/values.yaml must match byte-for-byte.\n"
        "Re-apply your edit to both files and re-run this script.\n",
        file=sys.stderr,
    )
    diff = difflib.unified_diff(
        chart_text.splitlines(keepends=True),
        frontend_text.splitlines(keepends=True),
        fromfile="charts/frontend/values.yaml (extracted)",
        tofile="frontend/nginx.conf.template",
    )
    sys.stderr.writelines(diff)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

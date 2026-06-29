#!/usr/bin/env python3
"""Generate THIRD-PARTY-LICENSES.txt for this component's runtime dependencies.

This component's Docker image installs and redistributes these packages, so
their license notices ship with it. This enumerates the ``main`` Poetry
dependency group (runtime only, no dev/test tooling) and reproduces each
package's license text from its installed metadata.

    poetry run python scripts/generate_third_party_licenses.py            # write
    poetry run python scripts/generate_third_party_licenses.py --check    # verify

Run from the component's directory (backend/ or backup/) with the main
dependency group installed (``poetry install --only main``).
"""

from __future__ import annotations

import importlib.metadata as md
import re
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
OUTPUT = ROOT_DIR / "THIRD-PARTY-LICENSES.txt"


def _project_name() -> str:
    pyproject = (ROOT_DIR / "pyproject.toml").read_text(encoding="utf-8")
    m = re.search(r'(?m)^name\s*=\s*"([^"]+)"', pyproject)
    return m.group(1) if m else ROOT_DIR.name


APP_NAME = _project_name()

LICENSE_FILE_RE = re.compile(r"(^|/)(licen[sc]e|copying|notice)[^/]*$", re.IGNORECASE)


def _normalize(text: str) -> str:
    """Normalize line endings so output is identical across platforms."""
    return text.replace("\r\n", "\n").replace("\r", "\n").rstrip()


def runtime_package_names() -> list[str]:
    """Authoritative runtime set: the resolved ``main`` Poetry group."""
    out = subprocess.check_output(
        ["poetry", "show", "--only=main", "--no-ansi"],
        cwd=ROOT_DIR,
        text=True,
    )
    names: list[str] = []
    for line in out.splitlines():
        m = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]+)\s", line)
        if m:
            names.append(m.group(1))
    return names


def license_id(meta: md.PackageMetadata) -> str:
    expr = meta.get("License-Expression")
    if expr:
        return expr
    classifiers = [
        c.split("::")[-1].strip()
        for c in meta.get_all("Classifier", [])
        if c.startswith("License ::")
    ]
    if classifiers:
        return "; ".join(dict.fromkeys(classifiers))
    lic = meta.get("License")
    if lic and len(lic) < 60 and "\n" not in lic:
        return lic.strip()
    return "See license text" if lic else "UNKNOWN"


def homepage(meta: md.PackageMetadata) -> str:
    for url in meta.get_all("Project-URL", []):
        label, _, value = url.partition(",")
        if label.strip().lower() in {"homepage", "source", "repository"}:
            return value.strip()
    return meta.get("Home-page", "") or ""


def license_text(dist: md.Distribution, meta: md.PackageMetadata) -> str | None:
    texts: list[str] = []
    for f in dist.files or []:
        if LICENSE_FILE_RE.search(str(f)) and "dist-info" in str(f).lower():
            try:
                raw = Path(dist.locate_file(f)).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            texts.append(_normalize(raw))
    if texts:
        return "\n\n".join(t for t in texts if t)
    lic = meta.get("License")
    if lic and ("\n" in lic or len(lic) >= 60):
        return _normalize(lic)
    return None


def build() -> str:
    records = []
    for name in sorted(set(runtime_package_names()), key=str.lower):
        try:
            dist = md.distribution(name)
        except md.PackageNotFoundError:
            records.append((name, "", "UNKNOWN", "", None))
            continue
        meta = dist.metadata
        records.append(
            (
                meta["Name"],
                meta["Version"],
                license_id(meta),
                homepage(meta),
                license_text(dist, meta),
            )
        )

    sep = "=" * 80
    header = f"""{APP_NAME} — Third-Party Software Notices
{sep}

HRIV itself is licensed under the Mozilla Public License 2.0 (see ../LICENSE).

This file lists the third-party open-source Python packages installed into this
service's Docker image and distributed with it, together with their license
notices. It is generated from the runtime (Poetry ``main``) dependency group;
regenerate with ``poetry run python scripts/generate_third_party_licenses.py``
after dependency changes.

Total packages: {len(records)}
{sep}
"""

    blocks = []
    for name, version, lic, url, text in records:
        meta_lines = [f"{name}{('@' + version) if version else ''}", f"License: {lic}"]
        if url:
            meta_lines.append(f"Homepage: {url}")
        body = text if text else f"(No license file shipped in the package. License: {lic}.)"
        blocks.append(f"{sep}\n" + "\n".join(meta_lines) + f"\n{sep}\n\n{body}\n")

    return header + "\n" + "\n".join(blocks)


def main() -> int:
    output = build()
    if "--check" in sys.argv:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != output:
            print(
                "THIRD-PARTY-LICENSES.txt is out of date. Run "
                "`poetry run python scripts/generate_third_party_licenses.py` and commit it.",
                file=sys.stderr,
            )
            return 1
        print("THIRD-PARTY-LICENSES.txt is up to date.")
        return 0
    OUTPUT.write_text(output, encoding="utf-8")
    m = re.search(r"Total packages: (\d+)", output)
    print(f"Wrote {OUTPUT} ({m.group(1) if m else '?'} packages).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

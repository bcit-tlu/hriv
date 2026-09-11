#!/usr/bin/env python3
from __future__ import annotations

import importlib.metadata as md
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "THIRD-PARTY-LICENSES.txt"
LICENSE_RE = re.compile(r"(^|/)(licen[sc]e|copying|notice)[^/]*$", re.I)


def packages() -> list[str]:
    output = subprocess.check_output(["poetry", "show", "--only=main", "--no-ansi"], cwd=ROOT, text=True)
    return sorted({line.split()[0] for line in output.splitlines() if line and not line.startswith("!")}, key=str.lower)


def build() -> str:
    records: list[str] = []
    for package in packages():
        dist = md.distribution(package)
        meta = dist.metadata
        license_id = meta.get("License-Expression") or meta.get("License") or "UNKNOWN"
        texts: list[str] = []
        for file in dist.files or []:
            if "dist-info" in str(file).lower() and LICENSE_RE.search(str(file)):
                try:
                    texts.append(Path(dist.locate_file(file)).read_text(encoding="utf-8").replace("\r\n", "\n").rstrip())
                except (OSError, UnicodeDecodeError):
                    safe_package = re.sub(r"[^A-Za-z0-9._-]", "?", package)[:128]
                    safe_file = re.sub(r"[^A-Za-z0-9._/+-]", "?", str(file))[:512]
                    print(f"warning: skipped license file for {safe_package}: {safe_file}", file=sys.stderr)
        records.append(f"{'=' * 80}\n{meta['Name']}@{meta['Version']}\nLicense: {license_id}\n{'=' * 80}\n\n" + ("\n\n".join(texts) or "(No license file shipped in the package.)") + "\n")
    output = f"hriv-restore-validation — Third-Party Software Notices\n{'=' * 80}\n\nHRIV itself is licensed under the Mozilla Public License 2.0 (see ../LICENSE).\nThis generated file covers locked runtime Python dependencies.\n\nTotal packages: {len(records)}\n\n" + "\n".join(records)
    return "\n".join(line.rstrip() for line in output.splitlines()) + "\n"


def main() -> int:
    output = build()
    if "--check" in sys.argv:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != output:
            print("THIRD-PARTY-LICENSES.txt is out of date", file=sys.stderr)
            return 1
    else:
        OUTPUT.write_text(output, encoding="utf-8")
        print(f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

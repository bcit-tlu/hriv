#!/usr/bin/env python3
"""Upload legacy CORGI images into an existing HRIV category tree.

The script mirrors the local directory structure under ``images/`` into HRIV by
mapping each image's parent directory to an existing HRIV category path. It does
not create categories: it prints missing category paths and exits before any
upload when one or more required categories are absent.

By default this is a dry run. Add ``--upload`` after the preflight is clean to
upload images that do not already exist in HRIV.

Examples:
    HRIV_URL=http://localhost:8000 HRIV_EMAIL=admin@example.ca \
      HRIV_PASSWORD=password scripts/upload-corgi-images.py

    scripts/upload-corgi-images.py --upload --wait

    scripts/upload-corgi-images.py --images-dir images --url https://hriv.example.ca \
      --email instructor@example.ca --password '...secret...' --upload
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".tif",
    ".tiff",
    ".gif",
    ".webp",
    ".svs",
}

TERMINAL_SOURCE_STATUSES = {"completed", "failed"}
SKIPPABLE_SOURCE_STATUSES = {"pending", "processing", "completed"}


@dataclass(frozen=True)
class LocalImage:
    path: Path
    category_path: tuple[str, ...]

    @property
    def image_name(self) -> str:
        # HRIV processing uses SourceImage.name when provided; otherwise the
        # uploaded filename stem. We always send this name explicitly so the
        # duplicate probe and eventual Image.name match.
        return self.path.stem

    @property
    def display_category_path(self) -> str:
        return format_category_path(self.category_path)


@dataclass(frozen=True)
class CategoryRef:
    id: int
    label: str
    path: tuple[str, ...]


class ApiError(RuntimeError):
    pass


def format_category_path(path: tuple[str, ...]) -> str:
    return "/" if not path else "/" + "/".join(path)


def image_sort_key(image: LocalImage) -> tuple[str, str, str]:
    return (image.display_category_path.casefold(), image.image_name.casefold(), str(image.path))


def api_url(base_url: str, path: str, query: dict[str, str] | None = None) -> str:
    url = f"{base_url.rstrip('/')}{path}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    return url


def request_json(
    method: str,
    base_url: str,
    path: str,
    *,
    token: str | None = None,
    body: dict[str, Any] | None = None,
    query: dict[str, str] | None = None,
) -> Any:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(
        api_url(base_url, path, query),
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ApiError(f"{method} {path} failed with HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"{method} {path} failed: {exc.reason}") from exc

    if not payload:
        return None
    return json.loads(payload)


def login(base_url: str, email: str, password: str) -> str:
    payload = request_json(
        "POST",
        base_url,
        "/api/auth/login",
        body={"email": email, "password": password},
    )
    try:
        return str(payload["access_token"])
    except (KeyError, TypeError) as exc:
        raise ApiError("Login response did not include an access_token") from exc


def scan_local_images(images_dir: Path) -> list[LocalImage]:
    if not images_dir.exists():
        raise FileNotFoundError(f"Images directory does not exist: {images_dir}")
    if not images_dir.is_dir():
        raise NotADirectoryError(f"Images path is not a directory: {images_dir}")

    images: list[LocalImage] = []
    for path in images_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        rel_parent = path.parent.relative_to(images_dir)
        category_path = () if rel_parent == Path(".") else rel_parent.parts
        images.append(LocalImage(path=path, category_path=category_path))
    return sorted(images, key=image_sort_key)


def iter_required_category_paths(images: list[LocalImage]) -> set[tuple[str, ...]]:
    required: set[tuple[str, ...]] = set()
    for image in images:
        for depth in range(1, len(image.category_path) + 1):
            required.add(image.category_path[:depth])
    return required


def index_category_tree(tree: list[dict[str, Any]]) -> tuple[dict[tuple[str, ...], CategoryRef], dict[int, tuple[str, ...]]]:
    by_path: dict[tuple[str, ...], CategoryRef] = {}
    path_by_id: dict[int, tuple[str, ...]] = {}

    def visit(nodes: list[dict[str, Any]], parent_path: tuple[str, ...]) -> None:
        for node in nodes:
            label = str(node["label"])
            path = (*parent_path, label)
            category_id = int(node["id"])
            by_path[path] = CategoryRef(id=category_id, label=label, path=path)
            path_by_id[category_id] = path
            visit(node.get("children", []), path)

    visit(tree, ())
    return by_path, path_by_id


def index_existing_images(
    tree: list[dict[str, Any]],
    uncategorized_images: list[dict[str, Any]],
) -> dict[int | None, set[str]]:
    names_by_category: dict[int | None, set[str]] = defaultdict(set)

    for image in uncategorized_images:
        names_by_category[None].add(str(image["name"]))

    def visit(nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            category_id = int(node["id"])
            for image in node.get("images", []):
                names_by_category[category_id].add(str(image["name"]))
            visit(node.get("children", []))

    visit(tree)
    return names_by_category


def source_image_name(source: dict[str, Any]) -> str:
    explicit_name = source.get("name")
    if explicit_name:
        return str(explicit_name)
    original_filename = str(source.get("original_filename") or "")
    return Path(original_filename).stem


def index_active_source_images(sources: list[dict[str, Any]]) -> dict[int | None, set[str]]:
    names_by_category: dict[int | None, set[str]] = defaultdict(set)
    for source in sources:
        status = str(source.get("status") or "")
        if status not in SKIPPABLE_SOURCE_STATUSES:
            continue
        category_id = source.get("category_id")
        key = int(category_id) if category_id is not None else None
        name = source_image_name(source)
        if name:
            names_by_category[key].add(name)
    return names_by_category


def local_category_id(image: LocalImage, categories_by_path: dict[tuple[str, ...], CategoryRef]) -> int | None:
    if not image.category_path:
        return None
    return categories_by_path[image.category_path].id


def print_missing_categories(missing: list[tuple[str, ...]]) -> None:
    print("Missing HRIV categories; create these manually, then rerun this script:")
    for path in missing:
        print(f"  {format_category_path(path)}")


def print_plan(
    images: list[LocalImage],
    categories_by_path: dict[tuple[str, ...], CategoryRef],
    existing_images: dict[int | None, set[str]],
    active_sources: dict[int | None, set[str]],
) -> tuple[list[LocalImage], int, int]:
    to_upload: list[LocalImage] = []
    skipped_existing = 0
    skipped_source = 0

    for image in images:
        category_id = local_category_id(image, categories_by_path)
        if image.image_name in existing_images.get(category_id, set()):
            skipped_existing += 1
        elif image.image_name in active_sources.get(category_id, set()):
            skipped_source += 1
        else:
            to_upload.append(image)

    print(f"Local images found: {len(images)}")
    print(f"Already present as HRIV images: {skipped_existing}")
    print(f"Already present as pending/processing/completed source images: {skipped_source}")
    print(f"Images to upload: {len(to_upload)}")

    if to_upload:
        print("\nUpload plan:")
        for image in to_upload:
            print(f"  {image.display_category_path}: {image.image_name} ({image.path})")

    return to_upload, skipped_existing, skipped_source


def run_curl_upload(
    base_url: str,
    token: str,
    image: LocalImage,
    category_id: int | None,
    *,
    copyright_text: str | None,
    note: str | None,
    active: bool,
) -> dict[str, Any]:
    content_type = mimetypes.guess_type(image.path.name)[0]
    file_form = f"file=@{image.path}"
    if content_type:
        file_form = f"{file_form};type={content_type}"

    args = [
        "curl",
        "-sfS",
        "--progress-bar",
        "-X",
        "POST",
        api_url(base_url, "/api/source-images/upload"),
        "-H",
        f"Authorization: Bearer {token}",
        "-F",
        file_form,
        "-F",
        f"name={image.image_name}",
        "-F",
        f"active={str(active).lower()}",
    ]
    if category_id is not None:
        args.extend(["-F", f"category_id={category_id}"])
    if copyright_text is not None:
        args.extend(["-F", f"copyright={copyright_text}"])
    if note is not None:
        args.extend(["-F", f"note={note}"])

    result = subprocess.run(args, check=False, stdout=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"curl upload failed for {image.path} with exit code {result.returncode}")
    return json.loads(result.stdout)


def wait_for_sources(
    base_url: str,
    token: str,
    source_ids: list[int],
    *,
    poll_interval: float,
) -> bool:
    pending = set(source_ids)
    failed = False
    while pending:
        for source_id in list(pending):
            source = request_json("GET", base_url, f"/api/source-images/{source_id}", token=token)
            status = str(source["status"])
            progress = source.get("progress", 0)
            status_message = source.get("status_message") or ""
            print(f"  source #{source_id}: {status} ({progress}%) {status_message}".rstrip())
            if status in TERMINAL_SOURCE_STATUSES:
                pending.remove(source_id)
                if status == "failed":
                    failed = True
                    error = source.get("error_message") or "Unknown processing error"
                    print(f"    ERROR: {error}")
        if pending:
            time.sleep(poll_interval)
    return not failed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images-dir", default="images", help="Local legacy image root (default: images)")
    parser.add_argument("--url", default=os.environ.get("HRIV_URL", "http://localhost:8000"), help="HRIV base URL")
    parser.add_argument("--email", default=os.environ.get("HRIV_EMAIL", "admin@example.ca"), help="HRIV login email")
    parser.add_argument("--password", default=os.environ.get("HRIV_PASSWORD", "password"), help="HRIV login password")
    parser.add_argument("--upload", action="store_true", help="Upload missing images. Without this, only prints a dry-run plan.")
    parser.add_argument("--wait", action="store_true", help="Poll uploaded source images until processing completes.")
    parser.add_argument("--poll-interval", type=float, default=5.0, help="Seconds between --wait status checks (default: 5)")
    parser.add_argument("--copyright", dest="copyright_text", help="Optional copyright text applied to uploaded images")
    parser.add_argument("--note", help="Optional note applied to uploaded images")
    parser.add_argument("--inactive", action="store_true", help="Upload images with active=false")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    images_dir = Path(args.images_dir)

    try:
        images = scan_local_images(images_dir)
        if not images:
            print(f"No supported image files found under {images_dir}")
            return 0

        print(f"Authenticating to {args.url} as {args.email}...")
        token = login(args.url, args.email, args.password)

        print("Loading HRIV categories and existing images...")
        tree = request_json("GET", args.url, "/api/categories/tree", token=token)
        categories_by_path, _path_by_id = index_category_tree(tree)
        uncategorized_images = request_json(
            "GET",
            args.url,
            "/api/images/",
            token=token,
            query={"uncategorized": "true"},
        )
        sources = request_json("GET", args.url, "/api/source-images/", token=token)

        required_paths = iter_required_category_paths(images)
        missing = sorted(
            (path for path in required_paths if path not in categories_by_path),
            key=lambda path: (len(path), tuple(part.casefold() for part in path)),
        )
        if missing:
            print_missing_categories(missing)
            return 2

        print("All required HRIV categories exist.")
        existing_images = index_existing_images(tree, uncategorized_images)
        active_sources = index_active_source_images(sources)
        to_upload, _skipped_existing, _skipped_source = print_plan(
            images,
            categories_by_path,
            existing_images,
            active_sources,
        )

        if not args.upload:
            print("\nDry run only. Re-run with --upload to upload the planned images.")
            return 0

        if not to_upload:
            print("\nNothing to upload.")
            return 0

        uploaded_source_ids: list[int] = []
        active = not args.inactive
        print("\nUploading images...")
        for index, image in enumerate(to_upload, start=1):
            category_id = local_category_id(image, categories_by_path)
            print(f"[{index}/{len(to_upload)}] {image.display_category_path}: {image.path.name}")
            response = run_curl_upload(
                args.url,
                token,
                image,
                category_id,
                copyright_text=args.copyright_text,
                note=args.note,
                active=active,
            )
            source_id = int(response["id"])
            uploaded_source_ids.append(source_id)
            print(f"  uploaded source #{source_id}: {response.get('status', 'unknown')}")

        if args.wait:
            print("\nWaiting for processing to finish...")
            return 0 if wait_for_sources(
                args.url,
                token,
                uploaded_source_ids,
                poll_interval=args.poll_interval,
            ) else 3

        print("\nUploads accepted. Re-run later to skip processed images, or use --wait next time to poll processing.")
        return 0
    except (ApiError, FileNotFoundError, NotADirectoryError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

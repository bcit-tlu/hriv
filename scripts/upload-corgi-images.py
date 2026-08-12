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
from typing import Callable, NotRequired, TypeVar, TypedDict

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

T = TypeVar("T")


class LoginResponse(TypedDict):
    access_token: str


class ImagePayload(TypedDict):
    name: str


class CategoryTreePayload(TypedDict):
    id: int
    label: str
    children: list["CategoryTreePayload"]
    images: list[ImagePayload]


class SourceImagePayload(TypedDict):
    id: int
    status: str
    progress: NotRequired[int]
    error_message: NotRequired[str | None]
    status_message: NotRequired[str | None]
    name: NotRequired[str | None]
    original_filename: NotRequired[str]
    category_id: NotRequired[int | None]


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
    body: dict[str, str] | None = None,
    query: dict[str, str] | None = None,
) -> object:
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
    parsed: object = json.loads(payload)
    return parsed


def expect_mapping(value: object, context: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ApiError(f"Expected {context} to be a JSON object")
    result: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise ApiError(f"Expected {context} object keys to be strings")
        result[key] = item
    return result


def parse_int(value: object, context: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ApiError(f"Expected {context} to be an integer")
    return value


def parse_optional_int(value: object, context: str) -> int | None:
    if value is None:
        return None
    return parse_int(value, context)


def parse_str(value: object, context: str) -> str:
    if not isinstance(value, str):
        raise ApiError(f"Expected {context} to be a string")
    return value


def parse_optional_str(value: object, context: str) -> str | None:
    if value is None:
        return None
    return parse_str(value, context)


def parse_list(value: object, item_parser: Callable[[object], T], context: str) -> list[T]:
    if not isinstance(value, list):
        raise ApiError(f"Expected {context} to be a JSON array")
    return [item_parser(item) for item in value]


def parse_image_payload(value: object) -> ImagePayload:
    payload = expect_mapping(value, "image")
    return {"name": parse_str(payload.get("name"), "image.name")}


def parse_category_tree_payload(value: object) -> CategoryTreePayload:
    payload = expect_mapping(value, "category")
    children_value = payload.get("children", [])
    images_value = payload.get("images", [])
    return {
        "id": parse_int(payload.get("id"), "category.id"),
        "label": parse_str(payload.get("label"), "category.label"),
        "children": parse_list(children_value, parse_category_tree_payload, "category.children"),
        "images": parse_list(images_value, parse_image_payload, "category.images"),
    }


def parse_source_image_payload(value: object) -> SourceImagePayload:
    payload = expect_mapping(value, "source image")
    result: SourceImagePayload = {
        "id": parse_int(payload.get("id"), "source_image.id"),
        "status": parse_str(payload.get("status"), "source_image.status"),
    }
    if "progress" in payload:
        result["progress"] = parse_int(payload.get("progress"), "source_image.progress")
    if "error_message" in payload:
        result["error_message"] = parse_optional_str(payload.get("error_message"), "source_image.error_message")
    if "status_message" in payload:
        result["status_message"] = parse_optional_str(payload.get("status_message"), "source_image.status_message")
    if "name" in payload:
        result["name"] = parse_optional_str(payload.get("name"), "source_image.name")
    if "original_filename" in payload:
        result["original_filename"] = parse_str(payload.get("original_filename"), "source_image.original_filename")
    if "category_id" in payload:
        result["category_id"] = parse_optional_int(payload.get("category_id"), "source_image.category_id")
    return result


def parse_login_response(value: object) -> LoginResponse:
    payload = expect_mapping(value, "login response")
    return {"access_token": parse_str(payload.get("access_token"), "login response.access_token")}


def login(base_url: str, email: str, password: str) -> str:
    payload = parse_login_response(request_json(
        "POST",
        base_url,
        "/api/auth/login",
        body={"email": email, "password": password},
    ))
    return payload["access_token"]


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


def index_category_tree(tree: list[CategoryTreePayload]) -> dict[tuple[str, ...], list[CategoryRef]]:
    by_path: dict[tuple[str, ...], list[CategoryRef]] = defaultdict(list)

    def visit(nodes: list[CategoryTreePayload], parent_path: tuple[str, ...]) -> None:
        for node in nodes:
            label = str(node["label"])
            path = (*parent_path, label)
            category_id = int(node["id"])
            by_path[path].append(CategoryRef(id=category_id, label=label, path=path))
            visit(node["children"], path)

    visit(tree, ())
    return dict(by_path)


def resolve_category_paths(
    categories_by_path: dict[tuple[str, ...], list[CategoryRef]],
    required_paths: set[tuple[str, ...]],
) -> dict[tuple[str, ...], CategoryRef]:
    return {
        path: categories_by_path[path][0]
        for path in required_paths
        if len(categories_by_path.get(path, [])) == 1
    }


def index_existing_images(
    tree: list[CategoryTreePayload],
    uncategorized_images: list[ImagePayload],
) -> dict[int | None, set[str]]:
    names_by_category: dict[int | None, set[str]] = defaultdict(set)

    for image in uncategorized_images:
        names_by_category[None].add(str(image["name"]))

    def visit(nodes: list[CategoryTreePayload]) -> None:
        for node in nodes:
            category_id = int(node["id"])
            for image in node["images"]:
                names_by_category[category_id].add(image["name"])
            visit(node["children"])

    visit(tree)
    return names_by_category


def source_image_name(source: SourceImagePayload) -> str:
    explicit_name = source.get("name")
    if explicit_name:
        return str(explicit_name)
    original_filename = str(source.get("original_filename") or "")
    return Path(original_filename).stem


def index_active_source_images(sources: list[SourceImagePayload]) -> dict[int | None, set[str]]:
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


def print_ambiguous_categories(ambiguous: list[tuple[tuple[str, ...], list[CategoryRef]]]) -> None:
    print("Ambiguous HRIV category paths; rename or reorganize these categories before uploading:")
    for path, refs in ambiguous:
        ids = ", ".join(str(ref.id) for ref in refs)
        print(f"  {format_category_path(path)} matches category IDs: {ids}")


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


def curl_file_form_value(field_name: str, path: Path, content_type: str | None) -> str:
    # curl's multipart parser treats commas as multi-file separators and
    # semicolons as part-option delimiters for @ file uploads. The quoted
    # filename form keeps those characters literal; escape backslashes and
    # double quotes because they are special inside curl's quoted string.
    escaped_path = str(path).replace("\\", "\\\\").replace('"', '\\"')
    value = f'{field_name}=@"{escaped_path}"'
    if content_type:
        value = f"{value};type={content_type}"
    return value


def run_curl_upload(
    base_url: str,
    token: str,
    image: LocalImage,
    category_id: int | None,
    *,
    copyright_text: str | None,
    note: str | None,
    active: bool,
) -> SourceImagePayload:
    content_type = mimetypes.guess_type(image.path.name)[0]
    file_form = curl_file_form_value("file", image.path, content_type)

    args = [
        "curl",
        "-fS",
        "--progress-bar",
        "-X",
        "POST",
        api_url(base_url, "/api/source-images/upload"),
        "-H",
        f"Authorization: Bearer {token}",
        "-F",
        file_form,
        "--form-string",
        f"name={image.image_name}",
        "--form-string",
        f"active={str(active).lower()}",
    ]
    if category_id is not None:
        args.extend(["--form-string", f"category_id={category_id}"])
    if copyright_text is not None:
        args.extend(["--form-string", f"copyright={copyright_text}"])
    if note is not None:
        args.extend(["--form-string", f"note={note}"])

    result = subprocess.run(args, check=False, stdout=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"curl upload failed for {image.path} with exit code {result.returncode}")
    parsed: object = json.loads(result.stdout)
    return parse_source_image_payload(parsed)


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
            source = parse_source_image_payload(
                request_json("GET", base_url, f"/api/source-images/{source_id}", token=token)
            )
            status = source["status"]
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
        tree = parse_list(
            request_json("GET", args.url, "/api/categories/tree", token=token),
            parse_category_tree_payload,
            "category tree",
        )
        categories_by_path = index_category_tree(tree)
        uncategorized_images = parse_list(
            request_json(
                "GET",
                args.url,
                "/api/images/",
                token=token,
                query={"uncategorized": "true"},
            ),
            parse_image_payload,
            "uncategorized images",
        )
        sources = parse_list(
            request_json("GET", args.url, "/api/source-images/", token=token),
            parse_source_image_payload,
            "source images",
        )

        required_paths = iter_required_category_paths(images)
        missing = sorted(
            (path for path in required_paths if path not in categories_by_path),
            key=lambda path: (len(path), tuple(part.casefold() for part in path)),
        )
        if missing:
            print_missing_categories(missing)
            return 2

        ambiguous = sorted(
            (
                (path, categories_by_path[path])
                for path in required_paths
                if len(categories_by_path.get(path, [])) > 1
            ),
            key=lambda item: (len(item[0]), tuple(part.casefold() for part in item[0])),
        )
        if ambiguous:
            print_ambiguous_categories(ambiguous)
            return 2

        categories_by_path_resolved = resolve_category_paths(categories_by_path, required_paths)

        print("All required HRIV categories exist and are unambiguous.")
        existing_images = index_existing_images(tree, uncategorized_images)
        active_sources = index_active_source_images(sources)
        to_upload, _skipped_existing, _skipped_source = print_plan(
            images,
            categories_by_path_resolved,
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
            category_id = local_category_id(image, categories_by_path_resolved)
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

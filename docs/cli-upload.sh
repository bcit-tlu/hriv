#!/usr/bin/env bash
#
# cli-upload.sh — Upload images (including large TIFFs) to Corgi via the API.
#
# Usage:
#   # Single image upload
#   ./cli-upload.sh upload <file> [options]
#
#   # Bulk upload (multiple files and/or zips)
#   ./cli-upload.sh bulk <category_id> <file1> [file2 ...] [options]
#
#   # List categories (to find category IDs)
#   ./cli-upload.sh categories
#
#   # Check processing status of a source image
#   ./cli-upload.sh status <source_image_id>
#
# Options:
#   --url <base_url>       API base URL (default: http://localhost:8000)
#   --email <email>        Login email (default: admin@bcit.ca)
#   --password <password>  Login password (default: password)
#   --name <name>          Image name (single upload only)
#   --category <id>        Category ID (single upload only)
#   --copyright <text>     Copyright text (single upload only)
#   --note <text>          Note text (single upload only)
#
# Examples:
#   # Upload a single TIFF to category 3
#   ./cli-upload.sh upload large-scan.tiff --category 3 --name "Large Scan"
#
#   # Bulk upload all TIFFs in a directory to category 5
#   ./cli-upload.sh bulk 5 /path/to/scans/*.tiff
#
#   # Upload a zip archive of images
#   ./cli-upload.sh bulk 5 images.zip
#
set -euo pipefail

BASE_URL="${CORGI_URL:-http://localhost:8000}"
EMAIL="${CORGI_EMAIL:-admin@bcit.ca}"
PASSWORD="${CORGI_PASSWORD:-password}"
NAME=""
CATEGORY_ID=""
COPYRIGHT=""
NOTE=""

# ── Helpers ────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

get_token() {
  local resp
  resp=$(curl -sf "${BASE_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")
  echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null \
    || die "Login failed. Check --url, --email, --password."
}

# ── Commands ───────────────────────────────────────────────

cmd_upload() {
  local file="$1"
  [ -f "$file" ] || die "File not found: $file"

  echo "Authenticating..."
  local token
  token=$(get_token)

  local args=(-X POST "${BASE_URL}/api/source-images/upload"
    -H "Authorization: Bearer ${token}"
    -F "file=@${file}")

  [ -n "$NAME" ]         && args+=(-F "name=${NAME}")
  [ -n "$CATEGORY_ID" ]  && args+=(-F "category_id=${CATEGORY_ID}")
  [ -n "$COPYRIGHT" ]    && args+=(-F "copyright=${COPYRIGHT}")
  [ -n "$NOTE" ]         && args+=(-F "note=${NOTE}")

  local size
  size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo "?")
  echo "Uploading: $(basename "$file") (${size} bytes)..."

  local resp
  resp=$(curl --progress-bar "${args[@]}")
  echo ""

  local src_id status
  src_id=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
  status=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)

  echo "Source image ID: ${src_id}, status: ${status}"
  echo "Check processing status: $0 status ${src_id}"
}

cmd_bulk() {
  local category_id="$1"; shift
  [ -n "$category_id" ] || die "category_id is required"
  [ $# -gt 0 ] || die "At least one file is required"

  echo "Authenticating..."
  local token
  token=$(get_token)

  local args=(-X POST "${BASE_URL}/api/admin/bulk-import/"
    -H "Authorization: Bearer ${token}"
    -F "category_id=${category_id}")

  local count=0
  for file in "$@"; do
    [ -f "$file" ] || { echo "WARNING: Skipping non-existent file: $file" >&2; continue; }
    args+=(-F "files=@${file}")
    count=$((count + 1))
  done

  [ "$count" -gt 0 ] || die "No valid files to upload"

  echo "Uploading ${count} file(s) to category ${category_id}..."

  local resp
  resp=$(curl --progress-bar "${args[@]}")
  echo ""

  local job_id status total
  job_id=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
  status=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
  total=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['total_count'])" 2>/dev/null)

  echo "Bulk import job #${job_id}: ${total} images, status: ${status}"
  echo ""

  # Poll until complete
  echo "Waiting for processing to finish..."
  while true; do
    sleep 3
    local job_resp
    job_resp=$(curl -sf "${BASE_URL}/api/admin/bulk-import/${job_id}" \
      -H "Authorization: Bearer ${token}")
    status=$(echo "$job_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
    local completed failed
    completed=$(echo "$job_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['completed_count'])" 2>/dev/null)
    failed=$(echo "$job_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['failed_count'])" 2>/dev/null)

    echo "  Status: ${status} — ${completed}/${total} completed, ${failed} failed"

    if [ "$status" = "completed" ] || [ "$status" = "failed" ]; then
      break
    fi
  done

  echo ""
  echo "Done! Final status: ${status}"
}

cmd_categories() {
  echo "Authenticating..."
  local token
  token=$(get_token)

  curl -sf "${BASE_URL}/api/categories/tree" \
    -H "Authorization: Bearer ${token}" \
    | python3 -c "
import sys, json
def show(cats, indent=0):
    for c in cats:
        print(f\"{'  ' * indent}[{c['id']}] {c['label']}\")
        show(c.get('children', []), indent + 1)
show(json.load(sys.stdin))
"
}

cmd_status() {
  local src_id="$1"
  [ -n "$src_id" ] || die "source_image_id is required"

  echo "Authenticating..."
  local token
  token=$(get_token)

  curl -sf "${BASE_URL}/api/source-images/${src_id}" \
    -H "Authorization: Bearer ${token}" \
    | python3 -m json.tool
}

# ── Argument parsing ───────────────────────────────────────

[ $# -gt 0 ] || { echo "Usage: $0 <upload|bulk|categories|status> [args...]"; exit 1; }

COMMAND="$1"; shift

# Parse options (collect positional args separately)
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --url)       BASE_URL="$2";   shift 2 ;;
    --email)     EMAIL="$2";      shift 2 ;;
    --password)  PASSWORD="$2";   shift 2 ;;
    --name)      NAME="$2";       shift 2 ;;
    --category)  CATEGORY_ID="$2"; shift 2 ;;
    --copyright) COPYRIGHT="$2";  shift 2 ;;
    --note)      NOTE="$2";       shift 2 ;;
    *)           POSITIONAL+=("$1"); shift ;;
  esac
done

case "$COMMAND" in
  upload)     cmd_upload "${POSITIONAL[@]}" ;;
  bulk)       cmd_bulk "${POSITIONAL[@]}" ;;
  categories) cmd_categories ;;
  status)     cmd_status "${POSITIONAL[@]}" ;;
  *)          die "Unknown command: $COMMAND" ;;
esac

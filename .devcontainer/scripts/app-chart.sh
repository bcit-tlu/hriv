#!/usr/bin/env bash
# Retrieve app helm chart and store locally in "./app-chart"
set -e
set -o nounset
set -o pipefail

# Robust script path resolver (bash & zsh)
if [ -n "${BASH_SOURCE:-}" ]; then
  _this="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  _this="${(%):-%N}"   # zsh-only; safe because we’re in zsh
else
  _this="$0"
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "$_this")" && pwd -P)"

# Load env vars + helpers
. "$SCRIPT_DIR/env.sh"
. "$SCRIPT_DIR/lib.sh"

# Check dependencies
need helm

log "🚀 Retrieving app chart into ./app-chart"

# Determine chart reference and optional version
version="${APP_CHART_VERSION:-}"

# Precedence for the effective chart ref:
# 1) APP_CHART_URL (explicit override)
# 2) CHART_REF from env.sh (or env)
# 3) Constructed fallback
if [ -n "${APP_CHART_URL:-}" ]; then
  log "🪔 APP_CHART_URL is set."
  CHART_REF="$APP_CHART_URL"
elif [ -n "${CHART_REF:-}" ]; then
  : # keep CHART_REF as provided/defaulted by env.sh
else
  : "${APP_NAME:?APP_NAME must be set when no APP_CHART_URL/CHART_REF is present}"
  : "${ORG_NAME:?ORG_NAME must be set when no APP_CHART_URL/CHART_REF is present}"
  : "${REGISTRY_HOST:?REGISTRY_HOST must be set when no APP_CHART_URL/CHART_REF is present}"
  CHART_REF="oci://${REGISTRY_HOST}/${ORG_NAME}/oci/${APP_NAME}"
fi

# Normalize (strip trailing slash), then export for child processes
CHART_REF="${CHART_REF%/}"
export CHART_REF

# Lowercase convenience alias for local readability
chart_ref="${CHART_REF}"

# Derive the chart directory name from the normalized ref (last path component)
temp_app_id="${chart_ref##*/}"

# Work in a temp dir under CWD so final moves are atomic on same filesystem
tdir="$(mktemp -d -p . .chart.XXXXXX)"
(
  set -o errexit -o nounset -o pipefail
  trap 'rm -rf -- "$tdir"' EXIT INT TERM

  # Bind the temporary chart name inside the subshell without exporting
  CHART_NAME="$temp_app_id"

  unpack="$tdir/unpack"
  mkdir -p "$unpack"

  if [[ -n "$version" ]]; then
    log "helm pull: $chart_ref (version: $version)"
    helm pull "$chart_ref" --version "$version" --untar --untardir "$unpack"
  else
    log "helm pull: $chart_ref"
    helm pull "$chart_ref" --untar --untardir "$unpack"
  fi

  # Determine the chart directory:
  # Prefer OCI layout (<unpack>/<CHART_NAME>), fall back to first dir with Chart.yaml
  CHART_DIR="$unpack/${CHART_NAME}"
  if [ ! -d "$CHART_DIR" ] || [ ! -f "$CHART_DIR/Chart.yaml" ]; then
    CHART_DIR=""
    for d in "$unpack"/*; do
      if [ -d "$d" ] && [ -f "$d/Chart.yaml" ]; then
        CHART_DIR="$d"
        break
      fi
    done
  fi

  [ -n "$CHART_DIR" ] || die "⚠️ No chart directory with Chart.yaml found under $unpack"

  stage="$tdir/app-chart.tmp"
  mv -- "$CHART_DIR" "$stage"

  # Optional: resolve dependencies & lint (non-fatal)
  # Ensure required repos exist for dependency resolution, then vendor deps
  helm repo add bcit-tlu https://bcit-tlu.github.io/helm-charts >/dev/null 2>&1 || true
  ( cd "$stage" && helm dependency build )
  # ( cd "$stage" && helm lint || true )

  rm -rf -- "app-chart"
  mv -- "$stage" "app-chart"
)

[[ -d "app-chart" ]] || die "⚠️ Chart directory not found: app-chart"
[[ -f "app-chart/Chart.yaml" ]] || die "⚠️ Chart.yaml missing in app-chart"

log "✅ Chart ready at ./app-chart"

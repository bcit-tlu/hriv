# Shared environment for all scripts and Make recipes (shell-agnostic)

# --- workspace root first (used by defaults below) ---
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# --- IDs & names ---
# Default APP_NAME to repo folder name if not provided (safe for strict shells)
export APP_NAME="${APP_NAME:-$(basename "$WORKSPACE_ROOT")}"
export CLUSTER_NAME="${CLUSTER_NAME:-review}"
export ORG_NAME="${ORG_NAME:-bcit-tlu}"

# --- workspace & state ---
export APP_STATE_DIR="${APP_STATE_DIR:-$HOME/.local/state/$APP_NAME}"
export TOKEN_PATH="${TOKEN_PATH:-$APP_STATE_DIR/k8s-dashboard-token}"
export K3D_CFG_PATH="${K3D_CFG_PATH:-$WORKSPACE_ROOT/.devcontainer/k3d/k3d.yaml}"

# --- registry / images ---
export REGISTRY_HOST="${REGISTRY_HOST:-ghcr.io}"

# CHART_REF precedence defaulting:
# 1) If CHART_REF already set, keep it.
# 2) Else if APP_CHART_URL provided, use it as CHART_REF.
# 3) Else construct the default OCI ref.
if [ -z "${CHART_REF:-}" ]; then
  if [ -n "${APP_CHART_URL:-}" ]; then
    CHART_REF="$APP_CHART_URL"
  else
    CHART_REF="oci://${REGISTRY_HOST}/${ORG_NAME}/oci/${APP_NAME}"
  fi
fi
export CHART_REF

# --- skaffold defaults ---
export SKAFFOLD_DEFAULT_REPO="${SKAFFOLD_DEFAULT_REPO:-registry.localhost:5000}"
export SKAFFOLD_PORT_FORWARD="${SKAFFOLD_PORT_FORWARD:-true}"
export SKAFFOLD_FILENAME="${SKAFFOLD_FILENAME:-.devcontainer/skaffold/skaffold.yaml}"
export SKAFFOLD_ENV_FILE="${SKAFFOLD_ENV_FILE:-$WORKSPACE_ROOT/.devcontainer/skaffold/skaffold.env}"

# --- PATH for non-interactive shells (Make/CI) ---
for _p in "$HOME/.nix-profile/bin" "/nix/var/nix/profiles/default/bin"; do
  case ":$PATH:" in
    *":${_p}:"*) : ;;
    *) PATH="${_p}:${PATH}" ;;
  esac
done
export PATH

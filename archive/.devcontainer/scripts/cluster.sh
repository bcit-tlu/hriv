#!/usr/bin/env bash
# Create a k3d cluster using configuration file in "k3d/k3d.yaml"
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
need k3d
need kubectl

# Validate K3D_CFG_PATH
: "${K3D_CFG_PATH:?K3D_CFG_PATH must point to a k3d config YAML}"
[ -r "$K3D_CFG_PATH" ] || die "Config not readable: $K3D_CFG_PATH"

log "🚀 Creating k3d cluster from: $K3D_CFG_PATH"
k3d cluster create --config "$K3D_CFG_PATH" --wait --timeout 180s

log "📡 Fetching cluster info..."
kubectl cluster-info || true

log "⌛️ Waiting for nodes to be Ready..."
kubectl wait node --all --for=condition=Ready --timeout=120s || true

log "📦 Cluster nodes:"
kubectl get nodes -o wide

log "✅ Cluster setup complete."

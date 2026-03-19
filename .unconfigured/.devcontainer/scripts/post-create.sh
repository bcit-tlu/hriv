#!/usr/bin/env bash
# Post-create: runs once after devcontainer is built
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

log "=== post-create start ==="

# Prepare user-scoped dirs
mkdir -p "$APP_STATE_DIR" "$HOME/.local/bin"

# Ensure the user is in the "docker" group so docker CLI works without sudo.
if ! getent group docker >/dev/null 2>&1; then
  log "Creating 'docker' group"
  groupadd -f docker
fi
if id -nG "$USER" | grep -qvw docker; then
  log "Adding user '$USER' to 'docker' group"
  usermod -aG docker "$USER" || true
  log "You may need to re-open the shell for group changes to take effect."
fi

# Write skaffold.env expected by direnv and Skaffold templating
cat > "$SKAFFOLD_ENV_FILE" <<EOF
SKAFFOLD_DEFAULT_REPO=$SKAFFOLD_DEFAULT_REPO
SKAFFOLD_PORT_FORWARD=$SKAFFOLD_PORT_FORWARD
SKAFFOLD_FILENAME=$SKAFFOLD_FILENAME
EOF
log "Wrote $SKAFFOLD_ENV_FILE"


# direnv hook to load env vars
if command -v direnv >/dev/null 2>&1; then
  case "${SHELL:-}" in
    *zsh)  grep -q 'direnv hook zsh'  "$HOME/.zshrc"  2>/dev/null || echo 'eval "$(direnv hook zsh)"'  >> "$HOME/.zshrc" ;;
    *bash) grep -q 'direnv hook bash' "$HOME/.bashrc" 2>/dev/null || echo 'eval "$(direnv hook bash)"' >> "$HOME/.bashrc" ;;
  esac
fi

# Replace Codespaces banner (platform reads this path)
NOTICE_WS="/workspaces/.codespaces/shared/first-run-notice.txt"
cat > "$NOTICE_WS" <<'EOF'
👋 Welcome!

🛠  Commands:

   docker compose up   → local dev
   make cluster        → create k3d cluster using $(K3D_CFG)"
   skaffold dev        → build + deploy to local cluster to verify deployment/helm release
   make help           → additional commands

EOF

log "=== post-create complete ==="

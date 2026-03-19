#!/usr/bin/env bash
# Post-start: runs every time environment is started
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

log "=== post-start start ==="

# Fix docker.sock permissions (DinD can set root:root)
if [ -S /var/run/docker.sock ]; then
  grp="$(stat -c '%G' /var/run/docker.sock)"
  if [ "$grp" != "docker" ]; then
    log "Fixing docker.sock group → docker"
    chgrp docker /var/run/docker.sock || true
    chmod g+rw /var/run/docker.sock || true
  fi
fi

log "=== post-start complete ==="

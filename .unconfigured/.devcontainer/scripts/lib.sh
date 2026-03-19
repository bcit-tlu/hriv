# Common helpers (sourced by bash or zsh)
set -e
set -o nounset
set -o pipefail

log() { printf '[%s] %s\n' "$(basename "$0")" "$*"; }
die() { log "ERROR: $*"; exit "${2:-1}"; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

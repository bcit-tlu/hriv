# zsh startup for both interactive and non-interactive shells launched by Make/CI
emulate -L sh
set -e
set -o nounset
set -o pipefail

# Load the single source of truth for environment + PATH
. "$ZDOTDIR/env.sh"

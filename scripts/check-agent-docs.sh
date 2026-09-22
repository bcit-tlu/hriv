#!/usr/bin/env bash
# check-agent-docs.sh — verify agent-facing metadata stays accurate.
#
# Checks:
#   1. Every /path listed in root AGENTS.md "Project Structure" exists.
#   2. Markdown links to repo files in AGENTS.md / subdir AGENTS.md /
#      .agents/skills/**/SKILL.md + references/ resolve.
#   3. `npm run <script>` / `npm <script>` commands mentioned in AGENTS.md
#      files exist in frontend/package.json scripts.
#   4. Every .agents/skills/*/SKILL.md has `name:` and `description:` frontmatter.
#
# Read-only; exits non-zero with a report if anything is stale.
set -u
cd "$(dirname "$0")/.."
fail=0
err() { echo "STALE: $*"; fail=1; }

# --- 1. Project Structure paths in root AGENTS.md ---------------------------
in_struct=0
while IFS= read -r line; do
  case "$line" in
    '## Project Structure') in_struct=1; continue ;;
    '## '*) [ "$in_struct" = 1 ] && break ;;
  esac
  [ "$in_struct" = 1 ] || continue
  p=$(printf '%s' "$line" | sed -n 's/^- `\(\/[^`]*\)`.*$/\1/p')
  [ -n "$p" ] || continue
  p=${p%/}
  [ -e ".${p}" ] || err "AGENTS.md Project Structure lists missing path: $p"
done < AGENTS.md

# --- 2. Markdown links to repo files ----------------------------------------
check_links() {
  local f=$1 dir
  dir=$(dirname "$f")
  grep -oE '\]\(([^)]+)\)' "$f" | sed 's/^](\(.*\))$/\1/' | while IFS= read -r link; do
    case "$link" in
      http*|'#'*|mailto:*) continue ;;
    esac
    target=${link%%#*}
    [ -n "$target" ] || continue
    if [ ! -e "$dir/$target" ]; then
      echo "STALE: $f -> broken link: $link"
    fi
  done
}
for f in AGENTS.md */AGENTS.md .agents/skills/*/SKILL.md .agents/skills/*/references/*.md; do
  [ -f "$f" ] || continue
  out=$(check_links "$f")
  if [ -n "$out" ]; then echo "$out"; fail=1; fi
done

# --- 3. npm scripts referenced in AGENTS.md files ---------------------------
for f in AGENTS.md frontend/AGENTS.md; do
  [ -f "$f" ] || continue
  grep -oE 'npm run [a-z:-]+' "$f" | awk '{print $3}' | sort -u | while IFS= read -r s; do
    grep -q "\"$s\":" frontend/package.json || echo "STALE: $f references missing npm script: $s"
  done > /tmp/agent-docs-npm.$$
  if [ -s /tmp/agent-docs-npm.$$ ]; then cat /tmp/agent-docs-npm.$$; fail=1; fi
done
rm -f /tmp/agent-docs-npm.$$

# --- 4. SKILL.md frontmatter -------------------------------------------------
for f in .agents/skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  grep -q '^name:' "$f" || err "$f missing 'name:' in frontmatter"
  grep -q '^description:' "$f" || err "$f missing 'description:' in frontmatter"
done

if [ "$fail" = 0 ]; then
  echo "agent-docs check: all referenced paths, links, and npm scripts resolve"
else
  echo "agent-docs check: FAILURES above"
  exit 1
fi

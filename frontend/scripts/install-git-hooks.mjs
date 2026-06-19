import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

if (process.env.CI === 'true') {
  process.exit(0)
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

let repoRoot
try {
  repoRoot = git(['rev-parse', '--show-toplevel'])
} catch {
  process.exit(0)
}

const desiredHooksPath = resolve(repoRoot, '.githooks')
let currentHooksPath = ''

try {
  currentHooksPath = git(['config', '--local', '--get', 'core.hooksPath'], { cwd: repoRoot })
} catch {
  currentHooksPath = ''
}

if (currentHooksPath) {
  const resolvedCurrentHooksPath = resolve(repoRoot, currentHooksPath)
  if (resolvedCurrentHooksPath === desiredHooksPath) {
    process.exit(0)
  }

  console.warn(
    `[hriv] Skipping git hook installation because core.hooksPath is already set to "${currentHooksPath}".`,
  )
  process.exit(0)
}

execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
  cwd: repoRoot,
  stdio: 'inherit',
})

console.log('[hriv] Installed repo-local git hooks at .githooks')

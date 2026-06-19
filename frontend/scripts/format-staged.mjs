import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

const repoRoot = git(['rev-parse', '--show-toplevel'])
const stagedRaw = execFileSync(
  'git',
  ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
  {
    cwd: repoRoot,
    encoding: 'utf8',
  },
)

const stagedFiles = stagedRaw
  .split('\u0000')
  .filter(Boolean)
  .filter((file) => existsSync(join(repoRoot, file)))

if (stagedFiles.length === 0) {
  process.exit(0)
}

const prettierCli = fileURLToPath(
  new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url),
)
const prettierIgnorePath = join(repoRoot, '.prettierignore')

execFileSync(
  process.execPath,
  [prettierCli, '--write', '--ignore-unknown', '--ignore-path', prettierIgnorePath, ...stagedFiles],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
)

execFileSync('git', ['add', '--', ...stagedFiles], {
  cwd: repoRoot,
  stdio: 'inherit',
})

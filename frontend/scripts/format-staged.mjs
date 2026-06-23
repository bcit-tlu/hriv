import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { getFileInfo } from 'prettier'

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  }).trim()
}

function gitBuffer(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

function hasUnstagedChanges(file) {
  try {
    execFileSync('git', ['diff', '--quiet', '--', file], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    return false
  } catch (error) {
    if (error.status === 1) {
      return true
    }
    throw error
  }
}

function getIndexMode(file) {
  const indexEntry = git(['ls-files', '--stage', '--', file]).split(/\s+/)
  return indexEntry[0]
}

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim()

const stagedRaw = gitBuffer([
  'diff',
  '--cached',
  '--name-only',
  '--diff-filter=ACMR',
  '-z',
]).toString('utf8')
const stagedFiles = stagedRaw
  .split('\u0000')
  .filter(Boolean)
  .filter((file) => existsSync(join(repoRoot, file)))

if (stagedFiles.length === 0) {
  process.exit(0)
}

const tempRoot = mkdtempSync(join(tmpdir(), 'hriv-format-staged-'))
const prettierCli = fileURLToPath(
  new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url),
)
const prettierConfigPath = join(repoRoot, '.prettierrc.json')
const prettierIgnorePath = join(repoRoot, '.prettierignore')

try {
  const tempFiles = []
  for (const file of stagedFiles) {
    const fileInfo = await getFileInfo(join(repoRoot, file), {
      ignorePath: prettierIgnorePath,
    })
    if (fileInfo.ignored) continue

    const tempFile = join(tempRoot, file)
    mkdirSync(dirname(tempFile), { recursive: true })
    writeFileSync(tempFile, gitBuffer(['show', `:${file}`]))
    tempFiles.push({ file, tempFile, hadUnstagedChanges: hasUnstagedChanges(file) })
  }

  if (tempFiles.length === 0) {
    process.exit(0)
  }

  execFileSync(
    process.execPath,
    [
      prettierCli,
      '--write',
      '--config',
      prettierConfigPath,
      '--ignore-unknown',
      '--ignore-path',
      prettierIgnorePath,
      ...tempFiles.map(({ tempFile }) => tempFile),
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  )

  for (const { file, tempFile, hadUnstagedChanges } of tempFiles) {
    const blobHash = git(['hash-object', '-w', tempFile])
    const mode = getIndexMode(file)

    execFileSync('git', ['update-index', '--cacheinfo', `${mode},${blobHash},${file}`], {
      cwd: repoRoot,
      stdio: 'inherit',
    })

    if (!hadUnstagedChanges) {
      copyFileSync(tempFile, join(repoRoot, file))
    }
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}

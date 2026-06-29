#!/usr/bin/env node
// Generates THIRD-PARTY-LICENSES.txt for the frontend's production
// dependency tree (the packages Vite bundles and we redistribute in the
// nginx image). Self-contained: walks node_modules directly, no extra deps.
//
//   npm run licenses:generate   # rewrite the file
//   npm run licenses:check      # fail if the committed file is stale
//
// Run from the frontend/ directory after `npm ci`.

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Lives under public/ so Vite copies it verbatim into the production build
// (dist/), where nginx serves it at /THIRD-PARTY-LICENSES.txt. Committing the
// generated file keeps the acknowledgement visible in source too.
const OUTPUT = join(frontendDir, 'public', 'THIRD-PARTY-LICENSES.txt')

const LICENSE_FILE_RE = /^(licen[sc]e|copying|notice)(\..*)?$/i

/** Normalize line endings so output is identical across platforms. */
function normalize(text) {
  return text.replace(/\r\n?/g, '\n').trimEnd()
}

/** Resolve a package directory by walking up node_modules from `fromDir`. */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function findLicenseText(pkgDir) {
  let entries
  try {
    entries = readdirSync(pkgDir)
  } catch {
    return null
  }
  const matches = entries.filter((f) => LICENSE_FILE_RE.test(f)).sort()
  if (matches.length === 0) return null
  return matches.map((f) => normalize(readFileSync(join(pkgDir, f), 'utf8'))).join('\n\n')
}

function licenseId(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(' OR ')
  return 'UNKNOWN'
}

function repoUrl(pkg) {
  const r = pkg.repository
  if (!r) return pkg.homepage || ''
  if (typeof r === 'string') return r
  return r.url || pkg.homepage || ''
}

const rootPkg = readJson(join(frontendDir, 'package.json'))
const collected = new Map() // name@version -> record
const seenDirs = new Set()

/** BFS over the production dependency graph. */
const queue = Object.keys(rootPkg.dependencies ?? {}).map((name) => ({
  name,
  fromDir: frontendDir,
}))

while (queue.length > 0) {
  const { name, fromDir } = queue.shift()
  const pkgDir = resolvePackageDir(name, fromDir)
  if (!pkgDir || seenDirs.has(pkgDir)) continue
  seenDirs.add(pkgDir)

  const pkg = readJson(join(pkgDir, 'package.json'))
  const key = `${pkg.name}@${pkg.version}`
  if (!collected.has(key)) {
    collected.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: licenseId(pkg),
      repository: repoUrl(pkg),
      text: findLicenseText(pkgDir),
    })
  }

  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    queue.push({ name: dep, fromDir: pkgDir })
  }
}

const records = [...collected.values()].sort((a, b) => a.name.localeCompare(b.name))

const sep = '='.repeat(80)
const header = `HRIV — Third-Party Software Notices
${sep}

HRIV itself is licensed under the Mozilla Public License 2.0 (see LICENSE).

This file lists the third-party open-source packages bundled into the HRIV
frontend production build and distributed with it, together with their license
notices. It is generated from the production dependency tree; regenerate with
\`npm run licenses:generate\` after dependency changes.

Total packages: ${records.length}
${sep}
`

const body = records
  .map((r) => {
    const meta = [`${r.name}@${r.version}`, `License: ${r.license}`]
    if (r.repository) meta.push(`Repository: ${r.repository}`)
    const text = r.text
      ? r.text
      : `(No license file shipped in the package. SPDX identifier: ${r.license}.)`
    return `${sep}\n${meta.join('\n')}\n${sep}\n\n${text}\n`
  })
  .join('\n')

const output = `${header}\n${body}`

const checkMode = process.argv.includes('--check')
if (checkMode) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : ''
  if (current !== output) {
    console.error(
      'THIRD-PARTY-LICENSES.txt is out of date. Run `npm run licenses:generate` and commit the result.',
    )
    process.exit(1)
  }
  console.log('THIRD-PARTY-LICENSES.txt is up to date.')
} else {
  writeFileSync(OUTPUT, output)
  console.log(`Wrote ${OUTPUT} (${records.length} packages).`)
}

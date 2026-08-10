import { readFileSync } from 'node:fs'

const packageLock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
)
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const packageVersion = packageLock.packages['node_modules/@playwright/test']?.version
const imageVersion = dockerfile.match(/^FROM mcr\.microsoft\.com\/playwright:v([^-]+)-/m)?.[1]

if (!packageVersion || !imageVersion) {
  throw new Error('Unable to determine Playwright package and image versions')
}

if (packageVersion !== imageVersion) {
  throw new Error(
    `Playwright package ${packageVersion} requires image v${packageVersion}, found v${imageVersion}`,
  )
}

console.log(`Playwright package and image both use ${packageVersion}`)

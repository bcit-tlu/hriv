import fs from 'node:fs'
import path from 'node:path'

const dashboardsDir = path.resolve(
  import.meta.dirname,
  '../../charts/backend/observability/dashboards',
)
const coreDashboards = new Map([
  ['hriv-service-health.json', 'HRIV Service Health'],
  ['hriv-data-and-recovery.json', 'HRIV Data and Recovery'],
  ['hriv-usage-and-experience.json', 'HRIV Usage and Experience'],
])
const optionalDashboards = new Map([
  ['hriv-synthetic-monitoring.json', 'HRIV Synthetic Monitoring'],
])
const selectorVariables = ['namespace', 'component', 'user_role', 'application_version']
const requiredSelectorVariables = new Map([
  ['hriv-service-health.json', ['component', 'user_role']],
  ['hriv-data-and-recovery.json', []],
  ['hriv-usage-and-experience.json', ['component', 'user_role']],
])

function fail(message) {
  console.error(`dashboard validation failed: ${message}`)
  process.exitCode = 1
}

function readDashboard(filename) {
  const fullPath = path.join(dashboardsDir, filename)
  let raw
  try {
    raw = fs.readFileSync(fullPath, 'utf8')
  } catch (error) {
    fail(`could not read ${filename}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }

  try {
    return JSON.parse(raw)
  } catch (error) {
    fail(`invalid JSON in ${filename}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function collectPanels(panels) {
  return panels.flatMap((panel) => [panel, ...collectPanels(panel.panels ?? [])])
}

function collectTargetExpressions(dashboard) {
  return collectPanels(dashboard.panels ?? []).flatMap((panel) =>
    (panel.targets ?? []).flatMap((target) =>
      typeof target.expr === 'string' && target.expr.trim() ? [target.expr] : [],
    ),
  )
}

let jsonFiles = []
try {
  jsonFiles = fs
    .readdirSync(dashboardsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
} catch (error) {
  fail(
    `could not read dashboards directory: ${error instanceof Error ? error.message : String(error)}`,
  )
}

for (const retired of ['hriv-backend.json', 'hriv-usage-overview.json']) {
  if (jsonFiles.includes(retired)) {
    fail(`retired dashboard ${retired} is still present`)
  }
}

for (const [filename, title] of coreDashboards) {
  if (!jsonFiles.includes(filename)) {
    fail(`missing required dashboard ${title} (${filename})`)
  }
}

const allowedFiles = new Map([...coreDashboards, ...optionalDashboards])
for (const filename of jsonFiles) {
  if (!allowedFiles.has(filename)) {
    fail(`unexpected dashboard file ${filename}`)
  }
}

const seenTitles = new Set()
const seenUids = new Set()

for (const filename of jsonFiles) {
  const expectedTitle = allowedFiles.get(filename)
  if (!expectedTitle) {
    continue
  }

  const dashboard = readDashboard(filename)
  if (!dashboard) {
    continue
  }

  if (dashboard.title !== expectedTitle) {
    fail(`${filename} title mismatch: expected "${expectedTitle}", got "${dashboard.title}"`)
  }

  if (!dashboard.uid || seenUids.has(dashboard.uid)) {
    fail(`${filename} has a missing or duplicate uid`)
  }
  seenUids.add(dashboard.uid)

  if (seenTitles.has(dashboard.title)) {
    fail(`${filename} has duplicate title "${dashboard.title}"`)
  }
  seenTitles.add(dashboard.title)

  const tags = new Set(dashboard.tags ?? [])
  for (const tag of ['hriv', 'observability']) {
    if (!tags.has(tag)) {
      fail(`${filename} is missing required tag "${tag}"`)
    }
  }

  if (coreDashboards.has(filename)) {
    const variables = dashboard.templating?.list ?? []
    const variableNames = new Set(variables.map((variable) => variable.name))
    for (const variableName of requiredSelectorVariables.get(filename) ?? []) {
      if (!variableNames.has(variableName)) {
        fail(`${filename} is missing required variable "${variableName}"`)
      }
    }

    const targetExpressions = collectTargetExpressions(dashboard)
    for (const variable of variables) {
      if (selectorVariables.includes(variable.name) && variable.type === 'textbox') {
        fail(`${filename} uses unrestricted textbox variable "${variable.name}"`)
      }
      if (
        selectorVariables.includes(variable.name) &&
        !targetExpressions.some((expr) => expr.includes(`\${${variable.name}}`))
      ) {
        fail(`${filename} declares selector "${variable.name}" but no panel query uses it`)
      }
    }
  }

  const panels = collectPanels(dashboard.panels ?? [])
  const panelIds = new Set()
  for (const panel of panels) {
    if (panel.id == null || panelIds.has(panel.id)) {
      fail(`${filename} has a missing or duplicate panel id`)
    }
    panelIds.add(panel.id)

    if (panel.type !== 'text' && !panel.description?.trim()) {
      fail(`${filename} panel "${panel.title}" is missing a description`)
    }

    const targets = panel.targets ?? []
    for (const target of targets) {
      const expr = target.expr ?? ''
      if (expr.includes('user_email')) {
        fail(`${filename} panel "${panel.title}" still references named-user email data`)
      }
    }
  }

  if (filename === 'hriv-data-and-recovery.json') {
    const hasImageProcessingPanel = panels.some((panel) =>
      (panel.targets ?? []).some((target) =>
        (target.expr ?? '').includes('hriv_image_processing_'),
      ),
    )
    if (hasImageProcessingPanel) {
      fail('hriv-data-and-recovery.json still contains image-processing runtime panels')
    }
  }

  if (filename === 'hriv-service-health.json') {
    const titles = panels.map((panel) => panel.title)
    if (!titles.includes('Image views vs failures')) {
      fail('hriv-service-health.json is missing the user-visible image health panel')
    }
  }

  if (filename === 'hriv-usage-and-experience.json') {
    const privacyPanel = panels.find((panel) => panel.type === 'text')
    const content = privacyPanel?.options?.content ?? ''
    if (!content.includes('No named-user panels are provisioned')) {
      fail('hriv-usage-and-experience.json is missing the privacy statement')
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(
  `validated ${coreDashboards.size} core Grafana dashboards and ${jsonFiles.length - coreDashboards.size} optional dashboard(s)`,
)

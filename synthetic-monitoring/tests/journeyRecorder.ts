import { errors, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type SyntheticStepName = 'frontend' | 'login' | 'category' | 'image' | 'dzi' | 'tile'

type SyntheticFailureCode =
  | 'frontend_unreachable'
  | 'login_failed'
  | 'category_unavailable'
  | 'image_unavailable'
  | 'dzi_failed'
  | 'tile_failed'
  | 'timeout'
  | 'result_submission_failed'
  | 'unexpected_error'

interface SyntheticJourneyStep {
  name: SyntheticStepName
  success: boolean
  duration_ms: number
}

interface SyntheticJourneyResultPayload {
  event_version: 1
  started_at: string
  completed_at: string
  success: boolean
  duration_ms: number
  failure_code: SyntheticFailureCode | null
  component_version: string
  steps: SyntheticJourneyStep[]
}

const STEP_FAILURE_CODES: Record<
  SyntheticStepName,
  Exclude<SyntheticFailureCode, 'timeout' | 'result_submission_failed' | 'unexpected_error'>
> = {
  frontend: 'frontend_unreachable',
  login: 'login_failed',
  category: 'category_unavailable',
  image: 'image_unavailable',
  dzi: 'dzi_failed',
  tile: 'tile_failed',
}

function getComponentVersion(): string {
  if (process.env.SYNTHETIC_COMPONENT_VERSION?.trim()) {
    return process.env.SYNTHETIC_COMPONENT_VERSION.trim()
  }

  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version?.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function roundDuration(durationMs: number): number {
  return Math.max(0, Math.round(durationMs))
}

function classifyFailure(step: SyntheticStepName | null, error: unknown): SyntheticFailureCode {
  if (error instanceof errors.TimeoutError) {
    return 'timeout'
  }
  if (step !== null) {
    return STEP_FAILURE_CODES[step]
  }
  return 'unexpected_error'
}

export class SyntheticJourneyRecorder {
  private readonly startedAt = new Date()
  private readonly componentVersion = getComponentVersion()
  private readonly steps: SyntheticJourneyStep[] = []
  private failureCode: SyntheticFailureCode | null = null

  get version(): string {
    return this.componentVersion
  }

  async recordStep<T>(name: SyntheticStepName, body: () => Promise<T>): Promise<T> {
    const stepStartedAt = performance.now()
    try {
      const result = await body()
      this.steps.push({
        name,
        success: true,
        duration_ms: roundDuration(performance.now() - stepStartedAt),
      })
      return result
    } catch (error) {
      this.steps.push({
        name,
        success: false,
        duration_ms: roundDuration(performance.now() - stepStartedAt),
      })
      this.failureCode = this.failureCode ?? classifyFailure(name, error)
      throw error
    }
  }

  markUnexpectedFailure(error: unknown): void {
    if (this.steps.length === 0) {
      this.steps.push({
        name: 'frontend',
        success: false,
        duration_ms: roundDuration(Date.now() - this.startedAt.getTime()),
      })
    }
    this.failureCode = this.failureCode ?? classifyFailure(null, error)
  }

  buildPayload(success: boolean): SyntheticJourneyResultPayload {
    const completedAt = new Date()
    return {
      event_version: 1,
      started_at: this.startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      success,
      duration_ms: roundDuration(completedAt.getTime() - this.startedAt.getTime()),
      failure_code: success ? null : (this.failureCode ?? 'unexpected_error'),
      component_version: this.componentVersion,
      steps: this.steps,
    }
  }

  async submit(request: APIRequestContext, success: boolean): Promise<void> {
    const payload = this.buildPayload(success)
    const response = await request.post('/api/telemetry/synthetic-result', {
      data: payload,
      failOnStatusCode: false,
    })

    if (!response.ok()) {
      const body = await response.text()
      throw new Error(
        `Synthetic result submission failed: ${response.status()} ${response.statusText()} ${body}`,
      )
    }

    console.log(
      `[synthetic] authoritative result accepted: ${success ? 'success' : payload.failure_code} (${payload.duration_ms}ms, version ${payload.component_version})`,
    )
  }
}

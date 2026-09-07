/**
 * Shared, dependency-free client synthetic-mode flag.
 *
 * This module is imported by both api.ts (to set the X-Client-Synthetic request
 * header on state-changing requests) and observability.ts (to mark emitted
 * telemetry events as synthetic). It deliberately has no imports from api.ts or
 * observability.ts to avoid circular dependencies.
 */

let syntheticMode = false

export function setClientSyntheticMode(enabled: boolean): void {
  syntheticMode = enabled
}

export function getClientSyntheticMode(): boolean {
  return syntheticMode
}

export function getStoredUserScope(): string {
  try {
    const stored = localStorage.getItem('hriv_user')
    if (!stored) return 'anonymous'
    const parsed = JSON.parse(stored) as { id?: number | string }
    return parsed.id != null ? String(parsed.id) : 'anonymous'
  } catch {
    return 'anonymous'
  }
}

export function matchesTextFilter(value: string, filter: string): boolean {
  const terms = filter
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0)

  if (terms.length === 0) return true

  const normalizedValue = value.toLowerCase()
  return terms.some((term) => normalizedValue.includes(term))
}

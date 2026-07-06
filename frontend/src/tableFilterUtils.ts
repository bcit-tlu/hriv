function splitFilterTerms(filter: string): string[] {
  return filter
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0)
}

export function hasFilterTerms(filter: string): boolean {
  return splitFilterTerms(filter).length > 0
}

export function formatFilterTerms(filter: string): string {
  return filter
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .join(', ')
}

export function matchesTextFilter(value: string, filter: string): boolean {
  const terms = splitFilterTerms(filter)

  if (terms.length === 0) return true

  const normalizedValue = value.toLowerCase()
  return terms.some((term) => normalizedValue.includes(term))
}

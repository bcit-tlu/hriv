function splitFilterTerms(filter: string): string[] {
  const terms = filter
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0)

  const seen = new Set<string>()
  const deduped: string[] = []
  for (const term of terms) {
    const normalized = term.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    deduped.push(term)
  }
  return deduped
}

export function hasFilterTerms(filter: string): boolean {
  return splitFilterTerms(filter).length > 0
}

export function getFilterTerms(filter: string): string[] {
  return splitFilterTerms(filter)
}

export function matchesTextFilter(value: string, filter: string): boolean {
  const terms = splitFilterTerms(filter)

  if (terms.length === 0) return true

  const normalizedValue = value.toLowerCase()
  return terms.every((term) => normalizedValue.includes(term.toLowerCase()))
}

export function removeFilterTerm(filter: string, term: string): string {
  const normalizedTerm = term.trim().toLowerCase()
  return filter
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.toLowerCase() !== normalizedTerm)
    .join(', ')
}

/**
 * Tokenize a search query into matchable clauses.
 *
 * Whitespace separates terms; "double quotes" (straight or smart) group a
 * multi-word phrase into a single clause. An unclosed quote treats the rest
 * of the input as the phrase; empty quotes contribute nothing. Returned
 * clauses are lowercase — matching is a case-insensitive substring union:
 * a result matches when ANY clause appears in a searchable field.
 */
export function parseSearchQuery(query: string): string[] {
  const normalized = query.replace(/[“”]/g, '"').toLowerCase()
  const clauses: string[] = []
  let current = ''
  let inPhrase = false

  const flush = () => {
    const clause = current.replace(/\s+/g, ' ').trim()
    if (clause) clauses.push(clause)
    current = ''
  }

  for (const ch of normalized) {
    if (ch === '"') {
      flush()
      inPhrase = !inPhrase
    } else if (inPhrase) {
      current += ch
    } else if (/\s/.test(ch)) {
      flush()
    } else {
      current += ch
    }
  }
  flush() // an unclosed quote still yields the accumulated phrase
  return clauses
}

import { describe, it, expect } from 'vitest'
import { formatFileSize } from '../src/formatUtils'

describe('formatFileSize', () => {
  it('returns bytes for values below 1 KB', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('returns KB for values below 1 MB', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB')
  })

  it('returns MB for values below 1 GB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(5.5 * 1024 * 1024)).toBe('5.5 MB')
    expect(formatFileSize(1024 * 1024 * 1024 - 1)).toBe('1024.0 MB')
  })

  it('returns GB for values at or above 1 GB', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
  })
})

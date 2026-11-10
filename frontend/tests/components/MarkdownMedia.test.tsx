import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MarkdownImage, MediaPlaceholder } from '../../src/components/MarkdownMedia'

describe('MediaPlaceholder', () => {
  it('renders the alt text with an accessible image role', () => {
    render(<MediaPlaceholder alt="Slide" fallback="Image unavailable" />)
    expect(screen.getByRole('img', { name: 'Slide' })).toHaveClass('md-media-missing')
  })

  it('falls back to the generic label when alt is empty', () => {
    render(<MediaPlaceholder alt="" fallback="Image unavailable" />)
    expect(screen.getByRole('img', { name: 'Image unavailable' })).toBeInTheDocument()
  })
})

describe('MarkdownImage', () => {
  it('renders a lazy image and an optional caption', () => {
    const { container, rerender } = render(
      <MarkdownImage src="https://cdn.example/a.png" alt="Alt" />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://cdn.example/a.png')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(container.querySelector('figcaption')).toBeNull()
    rerender(<MarkdownImage src="https://cdn.example/a.png" alt="Alt" caption />)
    expect(container.querySelector('figcaption')).toHaveTextContent('Alt')
  })

  it('swaps to the placeholder on error and retries with a new source', () => {
    const { container, rerender } = render(
      <MarkdownImage src="https://cdn.example/missing.png" alt="Gone" caption />,
    )
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('figcaption')).toBeNull()
    expect(screen.getByRole('img', { name: 'Gone' })).toHaveClass('md-media-missing')
    rerender(<MarkdownImage src="https://cdn.example/present.png" alt="Gone" caption />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example/present.png',
    )
  })
})

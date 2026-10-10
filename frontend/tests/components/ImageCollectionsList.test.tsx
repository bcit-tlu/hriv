import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageCollectionsList from '../../src/components/ImageCollectionsList'

const href = (id: number) => `?collection=${id}`
const toCollections = (names: string[]) => names.map((name, i) => ({ id: i + 1, name }))

describe('ImageCollectionsList (#1586)', () => {
  it('renders nothing when there are no collections', () => {
    const { container } = render(
      <ImageCollectionsList collections={[]} onOpenCollection={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('uses the singular label for a single collection', () => {
    render(
      <ImageCollectionsList
        collections={[{ id: 7, name: 'Skull comparison' }]}
        hrefForCollection={href}
        onOpenCollection={() => {}}
      />,
    )
    expect(screen.getByText('Collection:')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Skull comparison' })).toBeInTheDocument()
  })

  it('uses the plural label for multiple collections', () => {
    render(
      <ImageCollectionsList
        collections={toCollections(['One', 'Two'])}
        hrefForCollection={href}
        onOpenCollection={() => {}}
      />,
    )
    expect(screen.getByText('Collections:')).toBeInTheDocument()
  })

  it('renders each name as a link to its collection', () => {
    render(
      <ImageCollectionsList
        collections={[{ id: 42, name: 'Teaching set A' }]}
        hrefForCollection={href}
        onOpenCollection={() => {}}
      />,
    )
    expect(screen.getByRole('link', { name: 'Teaching set A' })).toHaveAttribute(
      'href',
      '?collection=42',
    )
  })

  it('calls onOpenCollection with the id on a plain click (in-app navigation)', async () => {
    const user = userEvent.setup()
    const onOpenCollection = vi.fn()
    render(
      <ImageCollectionsList
        collections={[{ id: 99, name: 'Midterm review' }]}
        hrefForCollection={href}
        onOpenCollection={onOpenCollection}
      />,
    )
    await user.click(screen.getByRole('link', { name: 'Midterm review' }))
    expect(onOpenCollection).toHaveBeenCalledWith(99)
  })

  it('falls back to button-style links when no href builder is given, still opening on click', async () => {
    const user = userEvent.setup()
    const onOpenCollection = vi.fn()
    render(
      <ImageCollectionsList
        collections={[{ id: 5, name: 'Archive 2026' }]}
        onOpenCollection={onOpenCollection}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Archive 2026' }))
    expect(onOpenCollection).toHaveBeenCalledWith(5)
  })

  it('shows all names with no "more" affordance when at or below the limit', () => {
    const { container } = render(
      <ImageCollectionsList
        collections={toCollections(['One', 'Two', 'Three'])}
        hrefForCollection={href}
        onOpenCollection={() => {}}
      />,
    )
    expect(container.textContent).toContain('One, Two, Three')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  it('truncates to the limit and reveals the rest when "more" is clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ImageCollectionsList
        collections={toCollections(['One', 'Two', 'Three', 'Four', 'Five'])}
        hrefForCollection={href}
        onOpenCollection={() => {}}
      />,
    )

    // Only the first three are shown, behind a "2 more" affordance.
    expect(container.textContent).toContain('One, Two, Three')
    expect(container.textContent).not.toContain('Four')
    await user.click(screen.getByRole('button', { name: '2 more' }))

    // After expanding, all names show as links and the affordance is gone.
    expect(container.textContent).toContain('One, Two, Three, Four, Five')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(5)
  })

  it('honors a custom limit', () => {
    const { container } = render(
      <ImageCollectionsList
        collections={toCollections(['One', 'Two', 'Three'])}
        hrefForCollection={href}
        limit={1}
        onOpenCollection={() => {}}
      />,
    )
    expect(container.textContent).toContain('One')
    expect(container.textContent).not.toContain('Two')
    expect(screen.getByRole('button', { name: '2 more' })).toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageCollectionsList from '../../src/components/ImageCollectionsList'

describe('ImageCollectionsList (#1586)', () => {
  it('renders nothing when there are no collections', () => {
    const { container } = render(<ImageCollectionsList names={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uses the singular label for a single collection', () => {
    render(<ImageCollectionsList names={['Skull comparison']} />)
    expect(screen.getByText('Collection:')).toBeInTheDocument()
    expect(screen.getByText(/Skull comparison/)).toBeInTheDocument()
  })

  it('uses the plural label for multiple collections', () => {
    render(<ImageCollectionsList names={['One', 'Two']} />)
    expect(screen.getByText('Collections:')).toBeInTheDocument()
  })

  it('shows all names with no "more" affordance when at or below the limit', () => {
    const { container } = render(<ImageCollectionsList names={['One', 'Two', 'Three']} />)
    expect(container.textContent).toContain('One, Two, Three')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('truncates to the limit and reveals the rest when "more" is clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ImageCollectionsList names={['One', 'Two', 'Three', 'Four', 'Five']} />,
    )

    // Only the first three are shown, behind a "2 more" affordance.
    expect(container.textContent).toContain('One, Two, Three')
    expect(container.textContent).not.toContain('Four')
    const moreButton = screen.getByRole('button', { name: '2 more' })

    await user.click(moreButton)

    // After expanding, all names show and the affordance is gone.
    expect(container.textContent).toContain('One, Two, Three, Four, Five')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('honors a custom limit', () => {
    const { container } = render(<ImageCollectionsList limit={1} names={['One', 'Two', 'Three']} />)
    expect(container.textContent).toContain('One')
    expect(container.textContent).not.toContain('Two')
    expect(screen.getByRole('button', { name: '2 more' })).toBeInTheDocument()
  })
})

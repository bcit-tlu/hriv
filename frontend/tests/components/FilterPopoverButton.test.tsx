import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterPopoverButton from '../../src/components/FilterPopoverButton'

describe('FilterPopoverButton', () => {
  it('opens and closes the menu panel from the trigger button', async () => {
    const user = userEvent.setup()

    render(
      <FilterPopoverButton label="Program">
        <div>Program options</div>
      </FilterPopoverButton>,
    )

    const trigger = screen.getByRole('button', { name: 'Program' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')

    await user.click(trigger)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('Program options')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.click(trigger)
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('shows the active-count badge when a filter is applied', () => {
    render(
      <FilterPopoverButton label="Program" activeCount={2}>
        <div>Program options</div>
      </FilterPopoverButton>,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
  })
})

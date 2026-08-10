import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterTextPanel from '../../src/components/FilterTextPanel'

describe('FilterTextPanel', () => {
  it('renders the configured input and reports text changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    function Wrapper() {
      const [value, setValue] = useState('')
      return (
        <FilterTextPanel
          value={value}
          onChange={(nextValue) => {
            onChange(nextValue)
            setValue(nextValue)
          }}
          placeholder="Filter by name"
          ariaLabel="Name"
          helperText="Separate terms with commas"
          width={220}
        />
      )
    }

    render(<Wrapper />)

    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveAttribute('placeholder', 'Filter by name')
    expect(screen.getByText('Separate terms with commas')).toBeInTheDocument()

    await user.type(input, 'Mira')

    expect(input).toHaveValue('Mira')
    expect(onChange).toHaveBeenLastCalledWith('Mira')
  })
})

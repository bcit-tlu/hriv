import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterOptionPanel from '../../src/components/FilterOptionPanel'

const options = [
  { value: 'clinical-genetics', label: 'Clinical Genetics' },
  { value: 'digital-design', label: 'Digital Design' },
] as const

describe('FilterOptionPanel', () => {
  it('toggles checkbox menu items for multi-select filters', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <FilterOptionPanel
        options={options}
        selectedValues={['clinical-genetics']}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Digital Design' }))

    expect(onChange).toHaveBeenCalledWith(['clinical-genetics', 'digital-design'])
  })

  it('uses radio menu items for single-select filters', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <FilterOptionPanel
        options={options}
        selectedValues={[]}
        onChange={onChange}
        multiple={false}
      />,
    )

    await user.click(screen.getByRole('menuitemradio', { name: 'Clinical Genetics' }))

    expect(onChange).toHaveBeenCalledWith(['clinical-genetics'])
  })

  it('supports keyboard activation and arrow-key focus movement', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<FilterOptionPanel options={options} selectedValues={[]} onChange={onChange} />)

    const firstOption = screen.getByRole('menuitemcheckbox', { name: 'Clinical Genetics' })
    const secondOption = screen.getByRole('menuitemcheckbox', { name: 'Digital Design' })

    firstOption.focus()
    expect(firstOption).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(secondOption).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith(['digital-design'])
  })

  it('filters options by the search query and shows the empty label when needed', async () => {
    const user = userEvent.setup()

    render(
      <FilterOptionPanel
        options={options}
        selectedValues={[]}
        onChange={vi.fn()}
        searchPlaceholder="Select programs"
        emptyLabel="No matching programs"
      />,
    )

    await user.type(screen.getByRole('textbox', { name: 'Select programs' }), 'nursing')

    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Clinical Genetics' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('No matching programs')).toBeInTheDocument()
  })
})

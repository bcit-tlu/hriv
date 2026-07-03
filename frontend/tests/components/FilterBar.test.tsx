import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import FilterBar from '../../src/components/FilterBar'

describe('FilterBar', () => {
  it('renders the filter heading, controls, and aligned summary content', () => {
    render(
      <FilterBar
        clearAction={<button type="button">Clear all</button>}
        actions={<button type="button">Choose columns</button>}
        summary={<span>Program: Clinical Genetics</span>}
        summaryActions={<span>1 of 4 people</span>}
      >
        <button type="button">Name</button>
        <button type="button">Program</button>
      </FilterBar>,
    )

    const region = screen.getByRole('region', { name: 'Filter by' })
    expect(within(region).getAllByText('FILTER BY:')).toHaveLength(2)
    expect(within(region).getByRole('button', { name: 'Name' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Program' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Clear all' })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Choose columns' })).toBeInTheDocument()
    expect(within(region).getByText('Program: Clinical Genetics')).toBeInTheDocument()
    expect(within(region).getByText('1 of 4 people')).toBeInTheDocument()
  })
})

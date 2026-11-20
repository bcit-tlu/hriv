import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import MenuList from '@mui/material/MenuList'
import AboutMenuItems from '../../src/components/AboutMenuItems'

function renderItems(props: Partial<React.ComponentProps<typeof AboutMenuItems>> = {}) {
  const onNavigate = vi.fn()
  const onOpenGuide = vi.fn()
  render(
    <MenuList>
      <AboutMenuItems
        frontendVersion="1.2.3"
        backendVersion="4.5.6"
        backupVersion={null}
        onNavigate={onNavigate}
        onOpenGuide={onOpenGuide}
        {...props}
      />
    </MenuList>,
  )
  return { onNavigate, onOpenGuide }
}

describe('AboutMenuItems', () => {
  it('Documentation closes the popover and opens the guide', () => {
    const { onNavigate, onOpenGuide } = renderItems()
    fireEvent.click(screen.getByText('Documentation'))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onOpenGuide).toHaveBeenCalledTimes(1)
  })

  it('hides Documentation when the viewer cannot open the guide', () => {
    renderItems({ onOpenGuide: undefined })
    expect(screen.queryByText('Documentation')).not.toBeInTheDocument()
    expect(screen.getByText('About')).toBeInTheDocument()
  })

  it('About keeps the popover open while the dialog shows, then closes both', () => {
    const { onNavigate } = renderItems()
    fireEvent.click(screen.getByText('About'))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('About HRIV')
    expect(screen.getByRole('dialog')).toHaveTextContent('1.2.3')
    expect(screen.getByRole('dialog')).toHaveTextContent('4.5.6')
    expect(screen.getByRole('dialog')).toHaveTextContent('...')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})

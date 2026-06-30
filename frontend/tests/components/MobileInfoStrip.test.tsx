import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import MobileInfoStrip from '../../src/components/MobileInfoStrip'

function renderStrip(ui: React.ReactElement) {
  return render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>)
}

describe('MobileInfoStrip', () => {
  it('shows the label and preview while collapsed, hiding the body', () => {
    renderStrip(
      <MobileInfoStrip label="Note" icon={<span />} preview="A short preview">
        <p>Full note body</p>
      </MobileInfoStrip>,
    )
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByText('A short preview')).toBeInTheDocument()
    expect(screen.queryByText('Full note body')).not.toBeInTheDocument()
  })

  it('expands to reveal the body and hides the preview on toggle', () => {
    renderStrip(
      <MobileInfoStrip label="Note" icon={<span />} preview="preview text">
        <p>Full note body</p>
      </MobileInfoStrip>,
    )
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Full note body')).toBeInTheDocument()
    expect(screen.queryByText('preview text')).not.toBeInTheDocument()
  })

  it('starts expanded when defaultOpen is set', () => {
    renderStrip(
      <MobileInfoStrip label="Details" icon={<span />} defaultOpen>
        <p>Visible immediately</p>
      </MobileInfoStrip>,
    )
    expect(screen.getByText('Visible immediately')).toBeInTheDocument()
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
  })
})

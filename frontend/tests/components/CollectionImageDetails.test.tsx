/**
 * Tests for CollectionImageDetails (#1862) — the provider that carries the
 * image-details trigger/drawer pair across the viewer's two mount slots so
 * the collection viewers don't prop-drill the shared state.
 *
 * Rendered standalone here (no ImageViewer): the trigger and drawer slots
 * are siblings, which is all the pairing contract needs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import * as api from '../../src/api'
import type { ImageItem } from '../../src/types'
import { makeImage } from '../helpers/fixtures'
import {
  CollectionImageDetails,
  CollectionImageDetailsDrawer,
  CollectionImageDetailsTrigger,
  type CollectionImageDetailsProps,
} from '../../src/components/CollectionImageDetails'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return { ...actual, fetchImageSourceInfo: vi.fn() }
})
const fetchImageSourceInfoMock = vi.mocked(api.fetchImageSourceInfo)

const IMAGE: ImageItem = makeImage({
  id: 501,
  name: 'Skull — lateral',
  copyright: 'CC-BY-4.0',
  width: 2048,
  height: 1536,
})

function Pane({
  image = IMAGE,
  children,
  ...rest
}: Partial<CollectionImageDetailsProps> & { image?: ImageItem; children?: ReactNode }) {
  return (
    <CollectionImageDetails image={image} programNames={[]} groupNames={[]} {...rest}>
      {children ?? (
        <>
          <CollectionImageDetailsTrigger />
          <CollectionImageDetailsDrawer />
        </>
      )}
    </CollectionImageDetails>
  )
}

beforeEach(() => {
  fetchImageSourceInfoMock.mockReset()
})

describe('CollectionImageDetails', () => {
  it('opens and closes the paired drawer through the trigger', async () => {
    fetchImageSourceInfoMock.mockResolvedValue({
      originalFilename: null,
      fileType: null,
      uploadedByName: null,
    })
    render(<Pane />)
    const trigger = screen.getByRole('button', { name: 'Image details' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('heading', { name: 'Image details' })).toBeInTheDocument()
    expect(screen.getByText('Copyright:')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close image details' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // The Slide unmounts at the end of its exit transition.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Image details' })).not.toBeInTheDocument(),
    )
  })

  it('fetches source info lazily on first open', async () => {
    fetchImageSourceInfoMock.mockResolvedValue({
      originalFilename: 'scan.tif',
      fileType: 'TIF',
      uploadedByName: 'Dr. Who',
    })
    render(<Pane />)
    expect(fetchImageSourceInfoMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Image details' }))
    expect(fetchImageSourceInfoMock).toHaveBeenCalledWith(501)
    expect(await screen.findByText('Original file:')).toBeInTheDocument()
  })

  it('disabling closes an open drawer and it stays closed after re-enabling', async () => {
    fetchImageSourceInfoMock.mockResolvedValue({
      originalFilename: null,
      fileType: null,
      uploadedByName: null,
    })
    const { rerender } = render(<Pane />)
    const trigger = screen.getByRole('button', { name: 'Image details' })
    fireEvent.click(trigger)
    await screen.findByRole('heading', { name: 'Image details' })

    rerender(<Pane disabled />)
    expect(trigger).toBeDisabled()
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Image details' })).not.toBeInTheDocument(),
    )

    // Re-enabling does not resurrect the drawer — matches the App's
    // onCanvasEditModeChange contract.
    rerender(<Pane />)
    expect(trigger).toBeEnabled()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('heading', { name: 'Image details' })).not.toBeInTheDocument()
  })

  it('gives each instance unique drawer ids and member-qualified landmarks', async () => {
    fetchImageSourceInfoMock.mockResolvedValue({
      originalFilename: null,
      fileType: null,
      uploadedByName: null,
    })
    render(
      <>
        <Pane image={makeImage({ id: 501, name: 'Skull' })} />
        <Pane image={makeImage({ id: 502, name: 'Skull' })} />
      </>,
    )
    const triggers = screen.getAllByRole('button', { name: 'Image details' })
    expect(triggers).toHaveLength(2)
    expect(triggers[0].getAttribute('aria-controls')).not.toBe(
      triggers[1].getAttribute('aria-controls'),
    )

    // Two members sharing a name still produce distinguishable landmarks —
    // the id discriminates (aria-label on the <aside>).
    fireEvent.click(triggers[0])
    fireEvent.click(triggers[1])
    const asides = await screen.findAllByRole('complementary')
    expect(asides).toHaveLength(2)
    const names = asides.map((a) => a.getAttribute('aria-label'))
    expect(names).toEqual(
      expect.arrayContaining(['Image details — Skull (501)', 'Image details — Skull (502)']),
    )
    expect(new Set(names).size).toBe(2)
    // The drawer ids resolve the triggers' aria-controls.
    for (const trigger of triggers) {
      const target = document.getElementById(trigger.getAttribute('aria-controls')!)
      expect(target).not.toBeNull()
    }
  })

  it('keeps open state and source-info fetches independent per instance', async () => {
    fetchImageSourceInfoMock.mockResolvedValue({
      originalFilename: null,
      fileType: null,
      uploadedByName: null,
    })
    render(
      <>
        <Pane image={makeImage({ id: 501, name: 'One' })} />
        <Pane image={makeImage({ id: 502, name: 'Two' })} />
      </>,
    )
    const [first, second] = screen.getAllByRole('button', { name: 'Image details' })
    fireEvent.click(first)
    await screen.findAllByRole('complementary')
    expect(second).toHaveAttribute('aria-expanded', 'false')
    expect(fetchImageSourceInfoMock).toHaveBeenCalledTimes(1)
    expect(fetchImageSourceInfoMock).toHaveBeenCalledWith(501)

    fireEvent.click(second)
    await screen.findAllByRole('complementary')
    expect(fetchImageSourceInfoMock).toHaveBeenCalledWith(502)
    expect(fetchImageSourceInfoMock).toHaveBeenCalledTimes(2)
  })

  it('renders trigger and drawer as no-ops outside a provider', () => {
    render(
      <div data-testid="bare">
        <CollectionImageDetailsTrigger />
        <CollectionImageDetailsDrawer />
      </div>,
    )
    const bare = screen.getByTestId('bare')
    expect(within(bare).queryByRole('button')).not.toBeInTheDocument()
    expect(bare).toBeEmptyDOMElement()
  })
})

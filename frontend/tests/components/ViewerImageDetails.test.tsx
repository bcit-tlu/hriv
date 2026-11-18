import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import ViewerImageDetails from '../../src/components/ViewerImageDetails'
import { fetchImageSourceInfo } from '../../src/api'
import { makeImage } from '../helpers/fixtures'

vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/api')>()),
  fetchImageSourceInfo: vi.fn(),
}))
beforeEach(() => {
  vi.mocked(fetchImageSourceInfo).mockReset()
})
const image = makeImage({ id: 42, copyright: 'Educational specimen' })
it('loads the original source alongside shared details fields', async () => {
  vi.mocked(fetchImageSourceInfo).mockResolvedValue({
    originalFilename: 'scan.tif',
    fileType: 'TIF',
    uploadedByName: 'Alex',
  })
  render(<ViewerImageDetails image={image} programNames={['Histology']} groupNames={[]} />)
  expect(await screen.findByText('scan.tif')).toBeVisible()
  expect(fetchImageSourceInfo).toHaveBeenCalledWith(42)
  expect(screen.getByText('Educational specimen')).toBeVisible()
})
it('renders image metadata when source information is empty', async () => {
  vi.mocked(fetchImageSourceInfo).mockResolvedValue({
    originalFilename: null,
    fileType: null,
    uploadedByName: null,
  })
  render(<ViewerImageDetails image={image} programNames={[]} groupNames={[]} />)
  await waitFor(() => expect(fetchImageSourceInfo).toHaveBeenCalledOnce())
  expect(screen.getByText('Educational specimen')).toBeVisible()
  expect(screen.queryByText('Original file:')).toBeNull()
})
it('retains metadata if source information cannot be loaded', async () => {
  vi.mocked(fetchImageSourceInfo).mockRejectedValue(new Error('offline'))
  render(<ViewerImageDetails image={image} programNames={[]} groupNames={[]} />)
  await waitFor(() => expect(fetchImageSourceInfo).toHaveBeenCalledOnce())
  expect(screen.getByText('Educational specimen')).toBeVisible()
})

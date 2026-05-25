import { describe, it, expect } from 'vitest'
import { isImageFile, isZipFile, isAcceptedFile } from '../src/fileUtils'

function makeFile(name: string, type: string): File {
  return new File([''], name, { type })
}

describe('isImageFile', () => {
  it('accepts known image MIME types', () => {
    expect(isImageFile(makeFile('a.jpg', 'image/jpeg'))).toBe(true)
    expect(isImageFile(makeFile('b.png', 'image/png'))).toBe(true)
    expect(isImageFile(makeFile('c.tiff', 'image/tiff'))).toBe(true)
    expect(isImageFile(makeFile('d.gif', 'image/gif'))).toBe(true)
    expect(isImageFile(makeFile('e.webp', 'image/webp'))).toBe(true)
  })

  it('accepts known image extensions even without MIME type', () => {
    expect(isImageFile(makeFile('slide.svs', ''))).toBe(true)
    expect(isImageFile(makeFile('scan.tif', ''))).toBe(true)
    expect(isImageFile(makeFile('photo.JPEG', ''))).toBe(true)
  })

  it('rejects non-image files', () => {
    expect(isImageFile(makeFile('doc.pdf', 'application/pdf'))).toBe(false)
    expect(isImageFile(makeFile('data.csv', 'text/csv'))).toBe(false)
    expect(isImageFile(makeFile('pic.bmp', 'image/bmp'))).toBe(false)
  })
})

describe('isZipFile', () => {
  it('accepts zip MIME types', () => {
    expect(isZipFile(makeFile('archive.zip', 'application/zip'))).toBe(true)
    expect(isZipFile(makeFile('archive.zip', 'application/x-zip-compressed'))).toBe(true)
  })

  it('accepts .zip extension without MIME type', () => {
    expect(isZipFile(makeFile('bulk.ZIP', ''))).toBe(true)
  })

  it('rejects non-zip files', () => {
    expect(isZipFile(makeFile('archive.tar.gz', 'application/gzip'))).toBe(false)
    expect(isZipFile(makeFile('photo.png', 'image/png'))).toBe(false)
  })
})

describe('isAcceptedFile', () => {
  it('accepts images', () => {
    expect(isAcceptedFile(makeFile('photo.png', 'image/png'))).toBe(true)
  })

  it('accepts zip files', () => {
    expect(isAcceptedFile(makeFile('bulk.zip', 'application/zip'))).toBe(true)
  })

  it('rejects unsupported types', () => {
    expect(isAcceptedFile(makeFile('doc.pdf', 'application/pdf'))).toBe(false)
    expect(isAcceptedFile(makeFile('readme.txt', 'text/plain'))).toBe(false)
  })
})

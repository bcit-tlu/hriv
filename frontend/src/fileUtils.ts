/** Recognised image MIME types for drag-and-drop validation. Must stay
 * in lock-step with ``backend/app/image_validation.py::IMAGE_MIME_TYPES``. */
const IMAGE_MIME_TYPES = new Set<string>([
  'image/jpeg', 'image/png', 'image/tiff', 'image/gif', 'image/webp',
])

/** Recognised image extensions for drag-and-drop validation. */
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.tif', '.tiff', '.svs',
])

export function isImageFile(file: File): boolean {
  if (IMAGE_MIME_TYPES.has(file.type)) return true
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

export function isZipFile(file: File): boolean {
  if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed') return true
  return file.name.toLowerCase().endsWith('.zip')
}

export function isAcceptedFile(file: File): boolean {
  return isImageFile(file) || isZipFile(file)
}

import { useState, useCallback, useMemo } from 'react'
import {
  updateImage as apiUpdateImage,
  deleteImage as apiDeleteImage,
  replaceImage as apiReplaceImage,
  userMessage,
} from './api'
import type { ApiImage } from './api'
import type { ImageFormData, ReplaceImageData } from './components/EditImageModal'
import type { Category, ImageItem } from './types'
import { findCategoryPath, findImageInTree, updateImageInTree } from './treeUtils'

export interface UseImageActionsDeps {
  categories: Category[]
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>
  uncategorizedImages: ImageItem[]
  setUncategorizedImages: React.Dispatch<React.SetStateAction<ImageItem[]>>
  selectedImage: ImageItem | null
  setSelectedImage: React.Dispatch<React.SetStateAction<ImageItem | null>>
  setPath: React.Dispatch<React.SetStateAction<Category[]>>
  loadCategories: () => Promise<void>
  loadUncategorizedImages: (opts?: { signal?: AbortSignal }) => Promise<void>
  refreshCategories: () => Promise<Category[]>
  setErrorSnack: React.Dispatch<React.SetStateAction<string | null>>
  clearImage: () => void
  startReplaceUpload: (
    file: File,
    context: 'viewer' | 'browse',
  ) => { uploadId: number; abort: AbortController }
  trackReplaceProgress: (uploadId: number, fraction: number) => void
  transitionReplaceToProcessing: (uploadId: number, sourceImageId: number) => void
  removeReplaceUpload: (uploadId: number) => void
  failReplaceUpload: (uploadId: number, message: string) => void
}

export function useImageActions(deps: UseImageActionsDeps) {
  const {
    categories,
    setCategories,
    uncategorizedImages,
    setUncategorizedImages,
    selectedImage,
    setSelectedImage,
    setPath,
    loadCategories,
    loadUncategorizedImages,
    refreshCategories,
    setErrorSnack,
    clearImage,
    startReplaceUpload,
    trackReplaceProgress,
    transitionReplaceToProcessing,
    removeReplaceUpload,
    failReplaceUpload,
  } = deps

  const [imageEditOpen, setImageEditOpen] = useState(false)
  const [browseEditImage, setBrowseEditImage] = useState<ImageItem | null>(null)

  const patchLocalImage = useCallback(
    (imageId: number, updater: (image: ImageItem) => ImageItem) => {
      setCategories((prev) => updateImageInTree(prev, imageId, updater))
      setUncategorizedImages((prev) =>
        prev.map((image) => (image.id === imageId ? updater(image) : image)),
      )
      setSelectedImage((prev) => (prev && prev.id === imageId ? updater(prev) : prev))
    },
    [setCategories, setSelectedImage, setUncategorizedImages],
  )

  const toggleImageVisibility = useCallback(
    async (imageId: number) => {
      const found = findImageInTree(categories, imageId)
      const img =
        found?.image ??
        uncategorizedImages.find((i) => i.id === imageId) ??
        (selectedImage?.id === imageId ? selectedImage : null)
      if (!img) return

      const nextActive = !img.active
      patchLocalImage(imageId, (image) => ({
        ...image,
        active: nextActive,
      }))
      try {
        const updated = await apiUpdateImage(imageId, { active: nextActive }, img.version)
        patchLocalImage(imageId, (image) => ({
          ...image,
          active: updated.active,
          version: updated.version,
          updatedAt: updated.updated_at,
        }))
      } catch (err) {
        patchLocalImage(imageId, (image) => ({
          ...image,
          active: img.active,
          version: img.version,
        }))
        console.error('Failed to toggle image visibility', err)
        setErrorSnack(userMessage(err, 'Failed to toggle image visibility.'))
        throw err
      }
    },
    [categories, uncategorizedImages, selectedImage, patchLocalImage, setErrorSnack],
  )

  const selectedApiImage: ApiImage | null = useMemo(
    () =>
      selectedImage
        ? {
            id: selectedImage.id,
            name: selectedImage.name,
            thumb: selectedImage.thumb,
            tile_sources: selectedImage.tileSources,
            category_id: selectedImage.categoryId ?? null,
            copyright: selectedImage.copyright ?? null,
            note: selectedImage.note ?? null,
            active: selectedImage.active,
            sort_order: selectedImage.sortOrder,
            version: selectedImage.version,
            metadata_extra: selectedImage.metadataExtra ?? null,
            width: selectedImage.width ?? null,
            height: selectedImage.height ?? null,
            file_size: selectedImage.fileSize ?? null,
            created_at: selectedImage.createdAt ?? '',
            updated_at: selectedImage.updatedAt ?? '',
          }
        : null,
    [selectedImage],
  )

  const browseApiImage: ApiImage | null = useMemo(
    () =>
      browseEditImage
        ? {
            id: browseEditImage.id,
            name: browseEditImage.name,
            thumb: browseEditImage.thumb,
            tile_sources: browseEditImage.tileSources,
            category_id: browseEditImage.categoryId ?? null,
            copyright: browseEditImage.copyright ?? null,
            note: browseEditImage.note ?? null,
            active: browseEditImage.active,
            sort_order: browseEditImage.sortOrder,
            version: browseEditImage.version,
            metadata_extra: browseEditImage.metadataExtra ?? null,
            width: browseEditImage.width ?? null,
            height: browseEditImage.height ?? null,
            file_size: browseEditImage.fileSize ?? null,
            created_at: browseEditImage.createdAt ?? '',
            updated_at: browseEditImage.updatedAt ?? '',
          }
        : null,
    [browseEditImage],
  )

  const handleSaveBrowseImage = useCallback(
    async (data: ImageFormData) => {
      if (!browseEditImage) return
      try {
        await apiUpdateImage(browseEditImage.id, data)
        setBrowseEditImage(null)
        await loadCategories()
        loadUncategorizedImages()
      } catch (err) {
        console.error('Failed to update image', err)
        setErrorSnack(userMessage(err, 'Failed to update image.'))
      }
    },
    [browseEditImage, loadCategories, loadUncategorizedImages, setErrorSnack],
  )

  const handleSaveViewerImage = useCallback(
    async (data: ImageFormData) => {
      if (!selectedImage) return
      try {
        const updated = await apiUpdateImage(selectedImage.id, data)
        setSelectedImage({
          id: updated.id,
          name: updated.name,
          thumb: updated.thumb,
          tileSources: updated.tile_sources,
          categoryId: updated.category_id,
          copyright: updated.copyright,
          note: updated.note,
          active: updated.active,
          sortOrder: updated.sort_order,
          version: updated.version,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
          metadataExtra: updated.metadata_extra,
          width: updated.width,
          height: updated.height,
          fileSize: updated.file_size,
        })
        setImageEditOpen(false)
        const freshTree = await refreshCategories()
        if (updated.category_id != null) {
          const newPath = findCategoryPath(freshTree, updated.category_id)
          setPath(newPath ?? [])
        } else {
          setPath([])
        }
        loadUncategorizedImages()
      } catch (err) {
        console.error('Failed to update image', err)
        setErrorSnack(userMessage(err, 'Failed to update image.'))
      }
    },
    [
      selectedImage,
      refreshCategories,
      loadUncategorizedImages,
      setSelectedImage,
      setPath,
      setErrorSnack,
    ],
  )

  const handleReplaceViewerImage = useCallback(
    async ({ file, formData }: ReplaceImageData) => {
      if (!selectedImage) return

      const prevImage = selectedImage

      setSelectedImage((prev) =>
        prev
          ? {
              ...prev,
              name: formData.name ?? prev.name,
              categoryId:
                formData.category_id !== undefined ? formData.category_id : prev.categoryId,
              copyright: formData.copyright !== undefined ? formData.copyright : prev.copyright,
              note: formData.note !== undefined ? formData.note : prev.note,
              active: formData.active !== undefined ? formData.active : prev.active,
            }
          : prev,
      )

      const { uploadId, abort } = startReplaceUpload(file, 'viewer')

      apiReplaceImage(
        selectedImage.id,
        file,
        (fraction) => {
          trackReplaceProgress(uploadId, fraction)
        },
        abort.signal,
        formData,
      )
        .then((result) => {
          transitionReplaceToProcessing(uploadId, result.id)
          setImageEditOpen(false)
          loadCategories()
          loadUncategorizedImages()
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            removeReplaceUpload(uploadId)
            setSelectedImage((prev) => (prev?.id === prevImage.id ? prevImage : prev))
            setImageEditOpen(false)
            return
          }
          setSelectedImage((prev) => (prev?.id === prevImage.id ? prevImage : prev))
          failReplaceUpload(uploadId, userMessage(err, 'Failed to upload replacement image'))
          setImageEditOpen(false)
        })
    },
    [
      selectedImage,
      loadCategories,
      loadUncategorizedImages,
      startReplaceUpload,
      trackReplaceProgress,
      transitionReplaceToProcessing,
      removeReplaceUpload,
      failReplaceUpload,
      setSelectedImage,
    ],
  )

  const handleReplaceBrowseImage = useCallback(
    async ({ file, formData }: ReplaceImageData) => {
      if (!browseEditImage) return

      const { uploadId, abort } = startReplaceUpload(file, 'browse')

      apiReplaceImage(
        browseEditImage.id,
        file,
        (fraction) => {
          trackReplaceProgress(uploadId, fraction)
        },
        abort.signal,
        formData,
      )
        .then((result) => {
          transitionReplaceToProcessing(uploadId, result.id)
          setBrowseEditImage(null)
          loadCategories()
          loadUncategorizedImages()
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            removeReplaceUpload(uploadId)
            setBrowseEditImage(null)
            return
          }
          failReplaceUpload(uploadId, userMessage(err, 'Failed to upload replacement image'))
          setBrowseEditImage(null)
        })
    },
    [
      browseEditImage,
      loadCategories,
      loadUncategorizedImages,
      startReplaceUpload,
      trackReplaceProgress,
      transitionReplaceToProcessing,
      removeReplaceUpload,
      failReplaceUpload,
    ],
  )

  const handleDeleteViewerImage = useCallback(async () => {
    if (!selectedImage) return
    await apiDeleteImage(selectedImage.id)
    setImageEditOpen(false)
    clearImage()
    await loadCategories()
    loadUncategorizedImages()
  }, [selectedImage, clearImage, loadCategories, loadUncategorizedImages])

  const handleDeleteBrowseImage = useCallback(async () => {
    if (!browseEditImage) return
    await apiDeleteImage(browseEditImage.id)
    setBrowseEditImage(null)
    await loadCategories()
    loadUncategorizedImages()
  }, [browseEditImage, loadCategories, loadUncategorizedImages])

  return {
    imageEditOpen,
    setImageEditOpen,
    browseEditImage,
    setBrowseEditImage,
    selectedApiImage,
    browseApiImage,
    toggleImageVisibility,
    handleSaveBrowseImage,
    handleSaveViewerImage,
    handleReplaceViewerImage,
    handleReplaceBrowseImage,
    handleDeleteViewerImage,
    handleDeleteBrowseImage,
  }
}

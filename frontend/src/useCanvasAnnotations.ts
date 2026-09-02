import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { CanvasAnnotation } from './components/CanvasOverlay'
import { updateImage, userMessage } from './api'
import type { ImageItem } from './types'

/** Dependencies injected by the host component. */
export interface UseCanvasAnnotationsDeps {
  selectedImage: ImageItem | null
  loadCategories: () => Promise<boolean>
  loadUncategorizedImages: (opts?: { signal?: AbortSignal }) => Promise<boolean>
  setErrorSnack: React.Dispatch<React.SetStateAction<string | null>>
}

function annotationsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): CanvasAnnotation[] {
  const annotations = metadata?.canvas_annotations
  return Array.isArray(annotations) ? (annotations as CanvasAnnotation[]) : []
}

function annotationsEqual(left: CanvasAnnotation[], right: CanvasAnnotation[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Manages one local canvas edit draft and its explicit persistence operation.
 *
 * Canvas edits are intentionally not autosaved.  The only write is the
 * explicit Save & Exit action in CanvasOverlay.
 */
export function useCanvasAnnotations(deps: UseCanvasAnnotationsDeps) {
  const { selectedImage, loadCategories, loadUncategorizedImages, setErrorSnack } = deps

  const latestVersionRef = useRef<number>(selectedImage?.version ?? 0)
  const latestMetadataRef = useRef<Record<string, unknown> | null | undefined>(
    selectedImage?.metadataExtra,
  )
  const initialAnnotations = annotationsFromMetadata(selectedImage?.metadataExtra)
  const entrySnapshotRef = useRef<CanvasAnnotation[]>(initialAnnotations)
  const draftAnnotationsRef = useRef<CanvasAnnotation[]>(initialAnnotations)
  const selectedImageIdRef = useRef<number | null>(selectedImage?.id ?? null)
  const selectedImageVersionRef = useRef<number | null>(selectedImage?.version ?? null)
  const draftRevisionRef = useRef(0)
  const savingRef = useRef(false)

  const [localCanvasAnnotations, setLocalCanvasAnnotations] = useState<CanvasAnnotation[] | null>(
    null,
  )
  const [canvasDraftDirty, setCanvasDraftDirty] = useState(false)
  const [canvasSaving, setCanvasSaving] = useState(false)

  const serverCanvasAnnotations = useMemo(
    () => annotationsFromMetadata(selectedImage?.metadataExtra),
    [selectedImage?.metadataExtra],
  )

  // A new image starts a new edit session. Same-image refreshes preserve an
  // active draft, while clean refreshes become the new authoritative baseline.
  useEffect(() => {
    const imageId = selectedImage?.id ?? null
    const version = selectedImage?.version ?? null
    const isNewImage = imageId !== selectedImageIdRef.current
    if (isNewImage) {
      selectedImageIdRef.current = imageId
      selectedImageVersionRef.current = version
      const annotations = annotationsFromMetadata(selectedImage?.metadataExtra)
      entrySnapshotRef.current = annotations
      draftAnnotationsRef.current = annotations
      setLocalCanvasAnnotations(null)
      setCanvasDraftDirty(false)
    } else if (
      !canvasDraftDirty &&
      selectedImage &&
      version !== selectedImageVersionRef.current &&
      (version ?? 0) >= latestVersionRef.current
    ) {
      selectedImageVersionRef.current = version
      const annotations = annotationsFromMetadata(selectedImage.metadataExtra)
      entrySnapshotRef.current = annotations
      draftAnnotationsRef.current = annotations
      setLocalCanvasAnnotations(null)
    }

    if (isNewImage || (version ?? 0) >= latestVersionRef.current) {
      latestVersionRef.current = version ?? 0
      latestMetadataRef.current = selectedImage?.metadataExtra
    }
  }, [canvasDraftDirty, selectedImage])

  const handleCanvasAnnotationsChange = useCallback((annotations: CanvasAnnotation[]) => {
    draftRevisionRef.current += 1
    draftAnnotationsRef.current = annotations
    setLocalCanvasAnnotations(annotations)
    setCanvasDraftDirty(!annotationsEqual(annotations, entrySnapshotRef.current))
  }, [])

  const saveCanvasAnnotations = useCallback(
    async (annotations: CanvasAnnotation[]): Promise<boolean> => {
      if (!selectedImage || savingRef.current) return false

      const targetImageId = selectedImage.id
      const savedRevision = draftRevisionRef.current
      savingRef.current = true
      setCanvasSaving(true)
      try {
        const updated = await updateImage(targetImageId, {
          metadata_extra_merge: {
            canvas_annotations: annotations.length > 0 ? annotations : null,
          },
        })
        if (selectedImageIdRef.current !== targetImageId) return true
        latestVersionRef.current = updated.version
        selectedImageVersionRef.current = updated.version
        latestMetadataRef.current = updated.metadata_extra ?? {}
        entrySnapshotRef.current = annotations
        if (draftRevisionRef.current === savedRevision) {
          draftAnnotationsRef.current = annotations
          setLocalCanvasAnnotations(annotations)
          setCanvasDraftDirty(false)
        } else {
          setCanvasDraftDirty(!annotationsEqual(draftAnnotationsRef.current, annotations))
        }
        void loadCategories()
        void loadUncategorizedImages()
        return true
      } catch (err) {
        console.error('Failed to save canvas annotations', err)
        setErrorSnack(userMessage(err, 'Failed to save annotations.'))
        return false
      } finally {
        savingRef.current = false
        setCanvasSaving(false)
      }
    },
    [loadCategories, loadUncategorizedImages, selectedImage, setErrorSnack],
  )

  const discardCanvasAnnotations = useCallback(() => {
    const snapshot = entrySnapshotRef.current
    draftAnnotationsRef.current = snapshot
    setLocalCanvasAnnotations(snapshot)
    setCanvasDraftDirty(false)
  }, [])

  return {
    /** Local annotations, including the active unsaved draft. */
    localCanvasAnnotations,
    /** Authoritative annotations from selected image metadata. */
    canvasAnnotations: serverCanvasAnnotations,
    /** Updates the local draft; never performs network I/O. */
    handleCanvasAnnotationsChange,
    /** Persists exactly one explicit draft snapshot. */
    saveCanvasAnnotations,
    /** Restores the edit-session entry snapshot locally. */
    discardCanvasAnnotations,
    canvasDraftDirty,
    canvasSaving,
    /** Latest known version/metadata for other metadata operations. */
    latestVersionRef,
    latestMetadataRef,
  }
}

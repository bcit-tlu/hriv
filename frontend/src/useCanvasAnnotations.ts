import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { CanvasAnnotation } from './components/CanvasOverlay'
import { updateImage, userMessage } from './api'
import type { ImageItem } from './types'

interface CanvasSaveResult {
  success: boolean
  // True when updateImage completed, even if a subsequent refresh failed.
  persisted: boolean
  updated?: { version: number }
}

interface CanvasSaveState {
  inFlight: boolean
  inFlightPromise: Promise<CanvasSaveResult> | null
  pending: CanvasAnnotation[] | null
  lastSavedAnnotations: CanvasAnnotation[]
  version: number
  metadata: Record<string, unknown> | null | undefined
}

function annotationsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): CanvasAnnotation[] {
  const annotations = metadata?.canvas_annotations
  return Array.isArray(annotations) ? (annotations as CanvasAnnotation[]) : []
}

/** Dependencies injected by the host component. */
export interface UseCanvasAnnotationsDeps {
  selectedImage: ImageItem | null
  fetchImage: (imageId: number) => Promise<{
    version: number
    metadata_extra: Record<string, unknown> | null
  }>
  loadCategories: () => Promise<unknown>
  loadUncategorizedImages: (opts?: { signal?: AbortSignal }) => void
  setErrorSnack: React.Dispatch<React.SetStateAction<string | null>>
}

/**
 * Manages canvas annotation state, debounced persistence, and version tracking.
 *
 * `latestVersionRef` and `latestMetadataRef` are exposed so that callers that
 * perform other metadata-modifying operations (lock/clear overlays) can read
 * and update the authoritative version without triggering a viewer remount.
 */
export function useCanvasAnnotations(deps: UseCanvasAnnotationsDeps) {
  const { selectedImage, fetchImage, loadCategories, loadUncategorizedImages, setErrorSnack } = deps

  // --- Refs ---

  // Track the latest known image version independently from selectedImage
  // to avoid stale-version 409s when clearing overlays after locking
  // (lock intentionally does NOT update selectedImage to avoid viewer remount).
  const latestVersionRef = useRef<number>(0)
  // Track the latest known metadata independently from selectedImage so that
  // successive metadata-modifying operations (lock, canvas annotations, clear)
  // don't clobber each other's fields.  Initialised from selectedImage and
  // updated after every successful PATCH.
  // undefined = not yet initialised (use selectedImage); null/object = latest known server state
  const latestMetadataRef = useRef<Record<string, unknown> | null | undefined>(undefined)
  // Save coordination must remain isolated per image because users can switch
  // images while prior saves and cancellation rollbacks are still in flight.
  const canvasSaveStatesRef = useRef(new Map<number, CanvasSaveState>())
  const canvasSaveTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  // While cancellation awaits an in-flight save or rollback, ignore new
  // canvas events for that image so they cannot be replayed after cancellation.
  const canvasCancellationImageIdsRef = useRef(new Set<number>())
  /** Always-current annotations last passed to handleCanvasAnnotationsChange.
   *  Used by flushCanvasAnnotations to avoid reading stale React state. */
  const latestCanvasAnnotationsRef = useRef<CanvasAnnotation[] | null>(null)
  // A rejected updateImage request has an indeterminate server outcome: the
  // PATCH may have committed even though its response did not reach the client.
  const uncertainCanvasSaveImageIdsRef = useRef(new Set<number>())
  // Stable ref for the save function so the callback can flush queued saves
  // without a self-reference (which the React Compiler cannot memoize).
  const saveCanvasAnnotationsRef = useRef<
    (
      annotations: CanvasAnnotation[],
      targetImage?: ImageItem | null,
      versionOverride?: number,
    ) => Promise<CanvasSaveResult>
  >(async () => ({ success: true, persisted: true }))
  const startCanvasSaveRef = useRef<
    (
      annotations: CanvasAnnotation[],
      targetImage?: ImageItem | null,
      versionOverride?: number,
    ) => Promise<CanvasSaveResult>
  >(async () => ({ success: true, persisted: true }))

  const getCanvasSaveState = useCallback((image: ImageItem): CanvasSaveState => {
    const existing = canvasSaveStatesRef.current.get(image.id)
    if (existing) return existing
    const state: CanvasSaveState = {
      inFlight: false,
      inFlightPromise: null,
      pending: null,
      lastSavedAnnotations: annotationsFromMetadata(image.metadataExtra),
      version: image.version,
      metadata: undefined,
    }
    canvasSaveStatesRef.current.set(image.id, state)
    return state
  }, [])

  // --- State ---

  // Local override for canvas annotations so view mode reflects edits immediately
  // (selectedImage is intentionally NOT updated after saves to avoid viewer remount)
  const [localCanvasAnnotations, setLocalCanvasAnnotations] = useState<CanvasAnnotation[] | null>(
    null,
  )

  // Track selection synchronously so late saves can update only their own
  // state record and never the version/metadata exposed for another image.
  const prevSelectedImageIdRef = useRef<number | null>(null)
  const currentImageId = selectedImage?.id ?? null
  const currentImageVersion = selectedImage?.version ?? 0
  const currentImageMetadata = selectedImage?.metadataExtra
  if (currentImageId !== prevSelectedImageIdRef.current) {
    prevSelectedImageIdRef.current = currentImageId
    setLocalCanvasAnnotations(null)
  }

  const syncCurrentImageRefs = useCallback((imageId: number, state: CanvasSaveState) => {
    if (prevSelectedImageIdRef.current !== imageId) return
    latestVersionRef.current = state.version
    latestMetadataRef.current = state.metadata
  }, [])

  // --- Effects ---

  // Mirror the selected image's per-image state for other metadata operations.
  // In-flight work for other images deliberately remains intact.
  useEffect(() => {
    latestCanvasAnnotationsRef.current = null
    if (!selectedImage) {
      latestVersionRef.current = 0
      latestMetadataRef.current = undefined
      return
    }
    const state = getCanvasSaveState(selectedImage)
    if (selectedImage.version > state.version) {
      state.version = selectedImage.version
      state.metadata = selectedImage.metadataExtra ?? {}
    }
    syncCurrentImageRefs(selectedImage.id, state)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new image ID starts a save session; same-image refreshes are handled below
  }, [getCanvasSaveState, selectedImage?.id, syncCurrentImageRefs])

  // Same-image updates can carry a newer server version (for example, after
  // editing image details or completing image processing). Keep the CAS token
  // and authoritative metadata in sync without resetting the annotation save
  // session that may already be debouncing or in flight. The version guard
  // prevents a stale same-image refresh from replacing metadata returned by a
  // newer annotation save.
  useEffect(() => {
    if (currentImageId === null || !selectedImage) return
    const state = getCanvasSaveState(selectedImage)
    if (currentImageVersion <= state.version) return
    state.version = currentImageVersion
    state.metadata = currentImageMetadata ?? {}
    syncCurrentImageRefs(currentImageId, state)
  }, [
    currentImageId,
    currentImageMetadata,
    currentImageVersion,
    getCanvasSaveState,
    selectedImage,
    syncCurrentImageRefs,
  ])

  // --- Memos ---

  // Extract canvas annotations from the selected image's metadata
  const canvasAnnotations = useMemo((): CanvasAnnotation[] => {
    const meta = selectedImage?.metadataExtra
    if (!meta) return []
    const annotations = meta.canvas_annotations
    if (!Array.isArray(annotations)) return []
    return annotations as CanvasAnnotation[]
  }, [selectedImage])

  // --- Callbacks ---

  // Persist canvas annotations to server.  Called by the debounced handler below.
  const saveCanvasAnnotations = useCallback(
    async (
      annotations: CanvasAnnotation[],
      targetImage: ImageItem | null = selectedImage,
      versionOverride?: number,
    ): Promise<CanvasSaveResult> => {
      if (!targetImage) return { success: true, persisted: true }
      const targetImageId = targetImage.id
      const targetState = getCanvasSaveState(targetImage)
      targetState.inFlight = true
      let persisted = false
      let updated: Awaited<ReturnType<typeof updateImage>> | undefined
      try {
        const mergeValue = annotations.length > 0 ? annotations : null
        if (
          prevSelectedImageIdRef.current === targetImageId &&
          latestVersionRef.current > targetState.version
        ) {
          targetState.version = latestVersionRef.current
          targetState.metadata = latestMetadataRef.current
        }
        const currentVersion = versionOverride ?? targetState.version ?? targetImage.version
        updated = await updateImage(
          targetImageId,
          {
            metadata_extra_merge: {
              canvas_annotations: mergeValue,
            },
          },
          currentVersion,
        )
        // A successful PATCH must still be rolled back if a later category
        // refresh fails while cancellation is waiting for this save.
        persisted = true
        if (updated.version >= targetState.version) {
          targetState.version = updated.version
          targetState.metadata = updated.metadata_extra ?? {}
          targetState.lastSavedAnnotations = annotations
          syncCurrentImageRefs(targetImageId, targetState)
        }
        await loadCategories()
        loadUncategorizedImages()
        return { success: true, persisted: true, updated }
      } catch (err) {
        console.error('Failed to save canvas annotations', err)
        if (!persisted) uncertainCanvasSaveImageIdsRef.current.add(targetImageId)
        setErrorSnack(userMessage(err, 'Failed to save annotations.'))
        return { success: false, persisted, updated }
      } finally {
        targetState.inFlight = false
        if (targetState.pending !== null) {
          const queued = targetState.pending
          targetState.pending = null
          void startCanvasSaveRef.current(queued, targetImage)
        }
      }
    },
    [
      getCanvasSaveState,
      loadCategories,
      loadUncategorizedImages,
      selectedImage,
      setErrorSnack,
      syncCurrentImageRefs,
    ],
  )
  // eslint-disable-next-line react-hooks/refs -- must stay synchronous; read by in-flight save's finally block
  saveCanvasAnnotationsRef.current = saveCanvasAnnotations

  const startCanvasSave = useCallback(
    (
      annotations: CanvasAnnotation[],
      targetImage: ImageItem | null = selectedImage,
      versionOverride?: number,
    ) => {
      if (!targetImage) return saveCanvasAnnotationsRef.current(annotations)
      const targetState = getCanvasSaveState(targetImage)
      const promise = saveCanvasAnnotationsRef.current(annotations, targetImage, versionOverride)
      targetState.inFlightPromise = promise
      void promise.then(
        () => {
          if (targetState.inFlightPromise === promise) targetState.inFlightPromise = null
        },
        () => {
          if (targetState.inFlightPromise === promise) targetState.inFlightPromise = null
        },
      )
      return promise
    },
    [getCanvasSaveState, selectedImage],
  )
  // eslint-disable-next-line react-hooks/refs -- must stay synchronous; save finally starts queued work through this ref
  startCanvasSaveRef.current = startCanvasSave

  const clearCanvasSaveTimer = useCallback((imageId: number) => {
    const timer = canvasSaveTimersRef.current.get(imageId)
    if (!timer) return
    clearTimeout(timer)
    canvasSaveTimersRef.current.delete(imageId)
  }, [])

  // Save canvas annotations to image metadata_extra (debounced).
  // Rapid edits reset a 600ms timer; if a save is already in-flight the
  // latest data is queued and flushed when the current request completes.
  // Also eagerly updates local state so view mode reflects edits immediately.
  const handleCanvasAnnotationsChange = useCallback(
    (annotations: CanvasAnnotation[]) => {
      if (!selectedImage || canvasCancellationImageIdsRef.current.has(selectedImage.id)) return
      const targetImage = selectedImage
      const targetState = getCanvasSaveState(targetImage)
      setLocalCanvasAnnotations(annotations)
      latestCanvasAnnotationsRef.current = annotations
      clearCanvasSaveTimer(targetImage.id)
      if (targetState.inFlight) {
        // A save is in-flight for this image — queue the latest data.
        targetState.pending = annotations
        return
      }
      const timer = setTimeout(() => {
        canvasSaveTimersRef.current.delete(targetImage.id)
        void startCanvasSaveRef.current(annotations, targetImage)
      }, 600)
      canvasSaveTimersRef.current.set(targetImage.id, timer)
    },
    [clearCanvasSaveTimer, getCanvasSaveState, selectedImage],
  )

  // Flush any pending canvas annotation save immediately (bypass debounce).
  // Used by the "Done" button to ensure data is persisted before exiting edit mode,
  // and by lock/clear operations to avoid race conditions.
  const flushCanvasAnnotations = useCallback(async () => {
    if (!selectedImage) return
    const targetImage = selectedImage
    const targetState = getCanvasSaveState(targetImage)
    clearCanvasSaveTimer(targetImage.id)
    const pending = targetState.pending
    targetState.pending = null
    if (targetState.inFlight) {
      if (pending) targetState.pending = pending
      for (let i = 0; i < 30 && targetState.inFlight; i++) {
        await new Promise((r) => setTimeout(r, 100))
      }
      const stillPending = targetState.pending
      if (stillPending && !targetState.inFlight) {
        targetState.pending = null
        await startCanvasSave(stillPending, targetImage)
      }
      return
    }
    // Use the ref (always current) instead of localCanvasAnnotations state
    // which may be stale due to React's async state batching.
    const latest = latestCanvasAnnotationsRef.current
    if (pending) {
      await startCanvasSave(pending, targetImage)
    } else if (latest) {
      await startCanvasSave(latest, targetImage)
    }
  }, [clearCanvasSaveTimer, getCanvasSaveState, selectedImage, startCanvasSave])

  /**
   * Discard the current edit session.  Debounced and queued edits have not
   * reached the server yet, so they are dropped without a PATCH.  If an edit
   * already completed an autosave, persist the entry snapshot to restore the
   * server state before returning to view mode.
   */
  const cancelCanvasAnnotations = useCallback(
    async (snapshot: CanvasAnnotation[]): Promise<boolean> => {
      const targetImage = selectedImage
      if (!targetImage) return true
      if (canvasCancellationImageIdsRef.current.has(targetImage.id)) return false
      canvasCancellationImageIdsRef.current.add(targetImage.id)
      try {
        const targetState = getCanvasSaveState(targetImage)
        const inFlightPromise = targetState.inFlightPromise
        clearCanvasSaveTimer(targetImage.id)
        targetState.pending = null
        latestCanvasAnnotationsRef.current = null
        setLocalCanvasAnnotations(snapshot)

        if (inFlightPromise) {
          // The in-flight request cannot be aborted. Await it, then use its
          // returned version to roll back the original image explicitly. The
          // target image is captured so a later image switch cannot retarget the
          // rollback request.
          const result = await inFlightPromise
          if (!result.persisted) return false
          const rollback = await startCanvasSave(
            snapshot,
            targetImage,
            result.updated?.version ?? targetImage.version,
          )
          return rollback.success
        }

        if (uncertainCanvasSaveImageIdsRef.current.has(targetImage.id)) {
          // A rejected PATCH may have committed server-side. Re-read the image
          // before trusting the per-image saved snapshot or claiming success.
          let authoritativeImage
          try {
            authoritativeImage = await fetchImage(targetImage.id)
          } catch (err) {
            console.error('Failed to reconcile canvas annotations', err)
            setErrorSnack(userMessage(err, 'Failed to verify annotation cancellation.'))
            return false
          }
          const authoritativeAnnotations = Array.isArray(
            authoritativeImage.metadata_extra?.canvas_annotations,
          )
            ? (authoritativeImage.metadata_extra.canvas_annotations as CanvasAnnotation[])
            : []
          if (authoritativeImage.version >= targetState.version) {
            targetState.version = authoritativeImage.version
            targetState.metadata = authoritativeImage.metadata_extra ?? {}
            targetState.lastSavedAnnotations = authoritativeAnnotations
            // Synchronize only while this image is still selected. The fetch
            // can finish after navigation, and its older image data must not
            // replace the version or metadata currently tracked for another.
            syncCurrentImageRefs(targetImage.id, targetState)
          }
          if (JSON.stringify(authoritativeAnnotations) !== JSON.stringify(snapshot)) {
            const rollback = await startCanvasSave(
              snapshot,
              targetImage,
              authoritativeImage.version,
            )
            if (!rollback.success) return false
          }
          uncertainCanvasSaveImageIdsRef.current.delete(targetImage.id)
          return true
        }

        if (JSON.stringify(targetState.lastSavedAnnotations) === JSON.stringify(snapshot)) {
          return true
        }

        const rollback = await startCanvasSave(snapshot, targetImage)
        return rollback.success
      } finally {
        canvasCancellationImageIdsRef.current.delete(targetImage.id)
      }
    },
    [
      clearCanvasSaveTimer,
      fetchImage,
      getCanvasSaveState,
      selectedImage,
      setErrorSnack,
      startCanvasSave,
      syncCurrentImageRefs,
    ],
  )

  return {
    /** Local annotations (reflects edits immediately). Falls back to server data when null. */
    localCanvasAnnotations,
    /** Server-derived annotations from selectedImage metadata. */
    canvasAnnotations,
    /** Debounced change handler — call on every annotation edit. */
    handleCanvasAnnotationsChange,
    /** Flush any pending save immediately (bypass debounce). */
    flushCanvasAnnotations,
    /** Discard canvas edits, rolling back only edits already autosaved. */
    cancelCanvasAnnotations,
    /** Latest known image version (survives across metadata operations without viewer remount). */
    latestVersionRef,
    /** Latest known metadata (survives across metadata operations without viewer remount). */
    latestMetadataRef,
  }
}

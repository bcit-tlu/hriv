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
  // Debounce timer for canvas annotation saves to avoid 409 version conflicts
  const canvasSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canvasSaveInFlightRef = useRef(false)
  const pendingCanvasAnnotationsRef = useRef<CanvasAnnotation[] | null>(null)
  // While cancellation awaits an in-flight save or rollback, ignore new
  // canvas events so they cannot be queued and replayed after cancellation.
  const canvasCancellationInProgressRef = useRef(false)
  /** Always-current annotations last passed to handleCanvasAnnotationsChange.
   *  Used by flushCanvasAnnotations to avoid reading stale React state. */
  const latestCanvasAnnotationsRef = useRef<CanvasAnnotation[] | null>(null)
  // The last annotation set known to be persisted for this image.  Cancel can
  // discard a debounced local edit without writing anything, but must roll
  // back edits that already completed an autosave during the edit session.
  const lastSavedCanvasAnnotationsRef = useRef<CanvasAnnotation[] | null>(null)
  const canvasSaveInFlightPromiseRef = useRef<Promise<CanvasSaveResult> | null>(null)
  // Track which image ID the current in-flight save targets so stale completions
  // don't overwrite refs after an image change
  const saveTargetImageIdRef = useRef<number | null>(null)
  // Keep the in-flight target available to cancellation even after an image
  // change clears saveTargetImageIdRef to prevent stale queue flushes.
  const canvasSaveInFlightImageIdRef = useRef<number | null>(null)
  // A rejected updateImage request has an indeterminate server outcome: the
  // PATCH may have committed even though its response did not reach the client.
  const uncertainCanvasSaveImageIdsRef = useRef(new Set<number>())
  // Stable ref for the save function so the callback can flush queued saves
  // without a self-reference (which the React Compiler cannot memoize).
  const saveCanvasAnnotationsRef = useRef<
    (annotations: CanvasAnnotation[]) => Promise<CanvasSaveResult>
  >(async () => ({ success: true, persisted: true }))
  const startCanvasSaveRef = useRef<(annotations: CanvasAnnotation[]) => Promise<CanvasSaveResult>>(
    async () => ({ success: true, persisted: true }),
  )

  // --- State ---

  // Local override for canvas annotations so view mode reflects edits immediately
  // (selectedImage is intentionally NOT updated after saves to avoid viewer remount)
  const [localCanvasAnnotations, setLocalCanvasAnnotations] = useState<CanvasAnnotation[] | null>(
    null,
  )

  // Synchronously clear race-sensitive refs during render when the image
  // changes.  The useEffect below runs as a passive effect (deferred), so
  // there is a window between re-render and effect execution where an
  // in-flight save's `finally` block could read stale guard refs and flush
  // queued saves via `saveCanvasAnnotationsRef.current` — which already
  // points to the new closure (wrong image).  Clearing synchronously
  // eliminates that window.
  const prevSelectedImageIdRef = useRef<number | null>(null)
  const currentImageId = selectedImage?.id ?? null
  const currentImageVersion = selectedImage?.version ?? 0
  const currentImageMetadata = selectedImage?.metadataExtra
  if (currentImageId !== prevSelectedImageIdRef.current) {
    prevSelectedImageIdRef.current = currentImageId
    // eslint-disable-next-line react-hooks/refs -- synchronous clearing required to prevent race; see comment above
    pendingCanvasAnnotationsRef.current = null
    // eslint-disable-next-line react-hooks/refs -- synchronous clearing required to prevent race; see comment above
    saveTargetImageIdRef.current = null
    // eslint-disable-next-line react-hooks/refs -- synchronous clearing required to prevent race; see comment above
    canvasSaveInFlightRef.current = false
    setLocalCanvasAnnotations(null)
  }

  // --- Effects ---

  // Reset version and pending-save refs only when the selected image changes.
  // The selected image object can be refreshed in place (for example, when a
  // tile token is renewed) without changing its ID. Resetting on object
  // identity would abandon an in-flight CAS save and make the next edit reuse
  // the stale version, resulting in a 409 even though the first save worked.
  useEffect(() => {
    latestVersionRef.current = selectedImage?.version ?? 0
    latestMetadataRef.current = undefined // reset to 'uninitialised' so first read falls back to selectedImage
    // Clear any pending canvas annotation saves for the previous image
    if (canvasSaveTimerRef.current) {
      clearTimeout(canvasSaveTimerRef.current)
      canvasSaveTimerRef.current = null
    }
    pendingCanvasAnnotationsRef.current = null
    latestCanvasAnnotationsRef.current = null
    const savedAnnotations = selectedImage?.metadataExtra?.canvas_annotations
    lastSavedCanvasAnnotationsRef.current = Array.isArray(savedAnnotations)
      ? (savedAnnotations as CanvasAnnotation[])
      : []
    canvasSaveInFlightRef.current = false
    saveTargetImageIdRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedImage identity may change during a same-image refresh; only its ID starts a new save session
  }, [selectedImage?.id])

  // Same-image updates can carry a newer server version (for example, after
  // editing image details or completing image processing). Keep the CAS token
  // and authoritative metadata in sync without resetting the annotation save
  // session that may already be debouncing or in flight. The version guard
  // prevents a stale same-image refresh from replacing metadata returned by a
  // newer annotation save.
  useEffect(() => {
    if (currentImageId === null || currentImageVersion <= latestVersionRef.current) return
    latestVersionRef.current = currentImageVersion
    latestMetadataRef.current = currentImageMetadata ?? {}
  }, [currentImageId, currentImageVersion, currentImageMetadata])

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
      saveTargetImageIdRef.current = targetImageId
      canvasSaveInFlightImageIdRef.current = targetImageId
      canvasSaveInFlightRef.current = true
      let persisted = false
      let updated: Awaited<ReturnType<typeof updateImage>> | undefined
      try {
        const mergeValue = annotations.length > 0 ? annotations : null
        const currentVersion =
          versionOverride ??
          (targetImageId === selectedImage?.id
            ? latestVersionRef.current || targetImage.version
            : targetImage.version)
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
        // Only update shared refs if the image hasn't changed while we were saving
        if (
          saveTargetImageIdRef.current === targetImageId &&
          selectedImage?.id === targetImageId &&
          updated.version >= latestVersionRef.current
        ) {
          latestVersionRef.current = updated.version
          latestMetadataRef.current = updated.metadata_extra ?? {}
          lastSavedCanvasAnnotationsRef.current = annotations
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
        if (canvasSaveInFlightImageIdRef.current === targetImageId) {
          canvasSaveInFlightImageIdRef.current = null
        }
        // Only clear in-flight flag and flush queue if still targeting the same image
        if (saveTargetImageIdRef.current === targetImageId) {
          canvasSaveInFlightRef.current = false
          if (pendingCanvasAnnotationsRef.current !== null) {
            const queued = pendingCanvasAnnotationsRef.current
            pendingCanvasAnnotationsRef.current = null
            void startCanvasSaveRef.current(queued)
          }
        }
      }
    },
    [selectedImage, loadCategories, loadUncategorizedImages, setErrorSnack],
  )
  // eslint-disable-next-line react-hooks/refs -- must stay synchronous; read by in-flight save's finally block
  saveCanvasAnnotationsRef.current = saveCanvasAnnotations

  const startCanvasSave = useCallback((annotations: CanvasAnnotation[]) => {
    const promise = saveCanvasAnnotationsRef.current(annotations)
    canvasSaveInFlightPromiseRef.current = promise
    void promise.then(
      () => {
        if (canvasSaveInFlightPromiseRef.current === promise) {
          canvasSaveInFlightPromiseRef.current = null
        }
      },
      () => {
        if (canvasSaveInFlightPromiseRef.current === promise) {
          canvasSaveInFlightPromiseRef.current = null
        }
      },
    )
    return promise
  }, [])
  // eslint-disable-next-line react-hooks/refs -- must stay synchronous; save finally starts queued work through this ref
  startCanvasSaveRef.current = startCanvasSave

  // Save canvas annotations to image metadata_extra (debounced).
  // Rapid edits reset a 600ms timer; if a save is already in-flight the
  // latest data is queued and flushed when the current request completes.
  // Also eagerly updates local state so view mode reflects edits immediately.
  const handleCanvasAnnotationsChange = useCallback((annotations: CanvasAnnotation[]) => {
    if (canvasCancellationInProgressRef.current) return
    setLocalCanvasAnnotations(annotations)
    latestCanvasAnnotationsRef.current = annotations
    if (canvasSaveTimerRef.current) clearTimeout(canvasSaveTimerRef.current)
    if (canvasSaveInFlightRef.current) {
      // A save is in-flight — queue the latest data (replaces any prior queued data)
      pendingCanvasAnnotationsRef.current = annotations
      return
    }
    canvasSaveTimerRef.current = setTimeout(() => {
      canvasSaveTimerRef.current = null
      // Read through the ref so the debounce window never fires a stale closure
      void startCanvasSaveRef.current(annotations)
    }, 600)
  }, [])

  // Flush any pending canvas annotation save immediately (bypass debounce).
  // Used by the "Done" button to ensure data is persisted before exiting edit mode,
  // and by lock/clear operations to avoid race conditions.
  const flushCanvasAnnotations = useCallback(async () => {
    // Cancel any pending debounce timer
    if (canvasSaveTimerRef.current) {
      clearTimeout(canvasSaveTimerRef.current)
      canvasSaveTimerRef.current = null
    }
    // If there's queued data waiting behind an in-flight save, grab it
    const pending = pendingCanvasAnnotationsRef.current
    pendingCanvasAnnotationsRef.current = null
    // If a save is already in-flight we need to wait for it, then save queued data
    if (canvasSaveInFlightRef.current) {
      // Re-queue so the in-flight finally block picks it up
      if (pending) pendingCanvasAnnotationsRef.current = pending
      // Spin-wait (max ~3s) for the in-flight save to finish
      for (let i = 0; i < 30 && canvasSaveInFlightRef.current; i++) {
        await new Promise((r) => setTimeout(r, 100))
      }
      // After waiting, save any data the in-flight handler didn't pick up
      const stillPending = pendingCanvasAnnotationsRef.current
      if (stillPending && !canvasSaveInFlightRef.current) {
        pendingCanvasAnnotationsRef.current = null
        await startCanvasSave(stillPending)
      }
      return
    }
    // Use the ref (always current) instead of localCanvasAnnotations state
    // which may be stale due to React's async state batching.
    const latest = latestCanvasAnnotationsRef.current
    if (pending) {
      await startCanvasSave(pending)
    } else if (latest) {
      await startCanvasSave(latest)
    }
  }, [startCanvasSave])

  /**
   * Discard the current edit session.  Debounced and queued edits have not
   * reached the server yet, so they are dropped without a PATCH.  If an edit
   * already completed an autosave, persist the entry snapshot to restore the
   * server state before returning to view mode.
   */
  const cancelCanvasAnnotations = useCallback(
    async (snapshot: CanvasAnnotation[]): Promise<boolean> => {
      if (canvasCancellationInProgressRef.current) return false
      canvasCancellationInProgressRef.current = true
      try {
        const targetImage = selectedImage
        const inFlightImageId = canvasSaveInFlightImageIdRef.current
        const inFlightPromise = canvasSaveInFlightPromiseRef.current
        if (canvasSaveTimerRef.current) {
          clearTimeout(canvasSaveTimerRef.current)
          canvasSaveTimerRef.current = null
        }
        pendingCanvasAnnotationsRef.current = null
        latestCanvasAnnotationsRef.current = null
        setLocalCanvasAnnotations(snapshot)

        if (!targetImage) return true

        if (inFlightPromise && inFlightImageId === targetImage.id) {
          // The in-flight request cannot be aborted. Await it, then use its
          // returned version to roll back the original image explicitly. The
          // target image is captured so a later image switch cannot retarget the
          // rollback request.
          const result = await inFlightPromise
          if (!result.persisted) return false
          const rollback = await saveCanvasAnnotations(
            snapshot,
            targetImage,
            result.updated?.version ?? targetImage.version,
          )
          return rollback.success
        }

        if (uncertainCanvasSaveImageIdsRef.current.has(targetImage.id)) {
          // A rejected PATCH may have committed server-side. Re-read the image
          // before trusting lastSavedCanvasAnnotationsRef or claiming success.
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
          // Synchronize only while this image is still selected. The fetch can
          // finish after navigation, and its older image data must not replace
          // the version or metadata currently tracked for another image.
          if (
            prevSelectedImageIdRef.current === targetImage.id &&
            authoritativeImage.version >= latestVersionRef.current
          ) {
            latestVersionRef.current = authoritativeImage.version
            latestMetadataRef.current = authoritativeImage.metadata_extra ?? {}
            lastSavedCanvasAnnotationsRef.current = authoritativeAnnotations
          }
          if (JSON.stringify(authoritativeAnnotations) !== JSON.stringify(snapshot)) {
            const rollback = await saveCanvasAnnotations(
              snapshot,
              targetImage,
              authoritativeImage.version,
            )
            if (!rollback.success) return false
          }
          uncertainCanvasSaveImageIdsRef.current.delete(targetImage.id)
          return true
        }

        if (
          JSON.stringify(lastSavedCanvasAnnotationsRef.current ?? []) === JSON.stringify(snapshot)
        ) {
          return true
        }

        const rollback = await startCanvasSave(snapshot)
        return rollback.success
      } finally {
        canvasCancellationInProgressRef.current = false
      }
    },
    [fetchImage, saveCanvasAnnotations, selectedImage, setErrorSnack, startCanvasSave],
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

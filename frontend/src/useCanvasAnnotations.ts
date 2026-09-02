import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { CanvasAnnotation } from './components/CanvasOverlay'
import { ApiTransportError, updateImage, userMessage } from './api'
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
  reconciling: boolean
  reconciliationPromise: Promise<void> | null
  pending: CanvasAnnotation[] | null
  lastSavedAnnotations: CanvasAnnotation[]
  cancellationBaseline: CanvasAnnotation[] | null
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
  // HTTP responses, including 409 conflicts, definitively reject the PATCH.
  // Keep those edits blocked until the user refreshes and resolves the
  // conflict, rather than treating their server state as safe to overwrite.
  const conflictedCanvasSaveImageIdsRef = useRef(new Set<number>())
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
      reconciling: false,
      reconciliationPromise: null,
      pending: null,
      lastSavedAnnotations: annotationsFromMetadata(image.metadataExtra),
      cancellationBaseline: null,
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
  // Published only when a conflict-resolving refresh changes the active
  // CanvasOverlay edit-session cancellation baseline.
  const [canvasCancellationBaseline, setCanvasCancellationBaseline] = useState<{
    imageId: number
    annotations: CanvasAnnotation[]
  } | null>(null)

  // Track selection synchronously so late saves can update only their own
  // state record and never the version/metadata exposed for another image.
  const prevSelectedImageIdRef = useRef<number | null>(null)
  const currentImageId = selectedImage?.id ?? null
  const currentImageVersion = selectedImage?.version ?? 0
  if (currentImageId !== prevSelectedImageIdRef.current) {
    prevSelectedImageIdRef.current = currentImageId
    setLocalCanvasAnnotations(null)
  }

  const syncCurrentImageRefs = useCallback((imageId: number, state: CanvasSaveState) => {
    if (prevSelectedImageIdRef.current !== imageId) return
    latestVersionRef.current = state.version
    latestMetadataRef.current = state.metadata
  }, [])

  // A newer selected-image version is authoritative server data. Besides
  // advancing the CAS token, it resolves a prior definitive conflict and
  // replaces the saved annotation snapshot before new writes are allowed.
  const refreshCanvasSaveState = useCallback((image: ImageItem, state: CanvasSaveState) => {
    if (image.version <= state.version) return null
    const conflictResolved = conflictedCanvasSaveImageIdsRef.current.delete(image.id)
    state.version = image.version
    state.metadata = image.metadataExtra ?? {}
    state.lastSavedAnnotations = annotationsFromMetadata(image.metadataExtra)
    if (conflictResolved) state.cancellationBaseline = state.lastSavedAnnotations
    return { conflictResolved }
  }, [])

  // --- Effects ---

  const lastCleanedSelectionIdRef = useRef<number | null>(null)

  // Navigating away abandons edits which have not yet reached the server.
  // Do not interrupt a genuine request: cancellation and reconciliation still
  // need its result to keep the per-image version coherent.
  useEffect(() => {
    const previousImageId = lastCleanedSelectionIdRef.current
    if (previousImageId !== currentImageId && previousImageId !== null) {
      const timer = canvasSaveTimersRef.current.get(previousImageId)
      if (timer) clearTimeout(timer)
      canvasSaveTimersRef.current.delete(previousImageId)
      const previousState = canvasSaveStatesRef.current.get(previousImageId)
      if (previousState) {
        previousState.pending = null
        previousState.cancellationBaseline = null
      }
    }
    lastCleanedSelectionIdRef.current = currentImageId
  }, [currentImageId])

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
    const refresh = refreshCanvasSaveState(selectedImage, state)
    if (refresh?.conflictResolved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- newer authoritative data invalidates the conflicting local draft
      setLocalCanvasAnnotations(null)
      setCanvasCancellationBaseline({
        imageId: selectedImage.id,
        annotations: state.cancellationBaseline ?? [],
      })
    }
    syncCurrentImageRefs(selectedImage.id, state)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new image ID starts a save session; same-image refreshes are handled below
  }, [getCanvasSaveState, refreshCanvasSaveState, selectedImage?.id, syncCurrentImageRefs])

  // Same-image updates can carry a newer server version (for example, after
  // editing image details or completing image processing). Keep the CAS token
  // and authoritative metadata in sync without resetting the annotation save
  // session that may already be debouncing or in flight. The version guard
  // prevents a stale same-image refresh from replacing metadata returned by a
  // newer annotation save.
  useEffect(() => {
    if (currentImageId === null || !selectedImage) return
    const state = getCanvasSaveState(selectedImage)
    const refresh = refreshCanvasSaveState(selectedImage, state)
    if (!refresh) return
    if (refresh.conflictResolved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- newer authoritative data invalidates the conflicting local draft
      setLocalCanvasAnnotations(null)
      setCanvasCancellationBaseline({
        imageId: selectedImage.id,
        annotations: state.cancellationBaseline ?? [],
      })
    }
    syncCurrentImageRefs(currentImageId, state)
  }, [
    currentImageId,
    currentImageVersion,
    getCanvasSaveState,
    refreshCanvasSaveState,
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

  // A transport failure from updateImage is indeterminate: the server may
  // already have committed the PATCH. Before retrying an edit behind such a
  // request, re-read the image to obtain the server's CAS version.
  const reconcileCanvasSave = useCallback(
    (targetImage: ImageItem): Promise<void> => {
      const targetState = getCanvasSaveState(targetImage)
      if (targetState.reconciliationPromise) return targetState.reconciliationPromise

      targetState.reconciling = true
      const reconciliation = (async () => {
        try {
          const authoritativeImage = await fetchImage(targetImage.id)
          const authoritativeAnnotations = annotationsFromMetadata(
            authoritativeImage.metadata_extra,
          )
          if (authoritativeImage.version >= targetState.version) {
            targetState.version = authoritativeImage.version
            targetState.metadata = authoritativeImage.metadata_extra ?? {}
            targetState.lastSavedAnnotations = authoritativeAnnotations
            syncCurrentImageRefs(targetImage.id, targetState)
          }
          uncertainCanvasSaveImageIdsRef.current.delete(targetImage.id)

          // Cancellation or navigation may have discarded the queue while
          // the read was in flight. In that case there is nothing to retry.
          if (
            targetState.pending === null ||
            canvasCancellationImageIdsRef.current.has(targetImage.id) ||
            prevSelectedImageIdRef.current !== targetImage.id
          ) {
            return
          }
          const queued = targetState.pending
          targetState.pending = null
          void startCanvasSaveRef.current(queued, targetImage)
        } catch (err) {
          // The original request already reported its failure. Keep the
          // queued annotations and uncertain marker so a later edit, flush,
          // or cancellation can reconcile safely instead of retrying stale.
          console.error('Failed to reconcile queued canvas annotations', err)
        }
      })()
      targetState.reconciliationPromise = reconciliation
      void reconciliation.finally(() => {
        if (targetState.reconciliationPromise === reconciliation) {
          targetState.reconciling = false
          targetState.reconciliationPromise = null
        }
      })
      return reconciliation
    },
    [fetchImage, getCanvasSaveState, syncCurrentImageRefs],
  )

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
        conflictedCanvasSaveImageIdsRef.current.delete(targetImageId)
        return { success: true, persisted: true, updated }
      } catch (err) {
        console.error('Failed to save canvas annotations', err)
        if (!persisted) {
          if (err instanceof ApiTransportError) {
            uncertainCanvasSaveImageIdsRef.current.add(targetImageId)
          } else {
            conflictedCanvasSaveImageIdsRef.current.add(targetImageId)
          }
        }
        setErrorSnack(userMessage(err, 'Failed to save annotations.'))
        return { success: false, persisted, updated }
      } finally {
        targetState.inFlight = false
        if (
          targetState.pending !== null &&
          prevSelectedImageIdRef.current === targetImageId &&
          !canvasCancellationImageIdsRef.current.has(targetImageId)
        ) {
          if (persisted) {
            const queued = targetState.pending
            targetState.pending = null
            void startCanvasSaveRef.current(queued, targetImage)
          } else if (uncertainCanvasSaveImageIdsRef.current.has(targetImageId)) {
            void reconcileCanvasSave(targetImage)
          } else {
            // A definitive HTTP response proves this PATCH did not commit.
            // Discard trailing autosave work instead of retrying it against a
            // fetched version, which could overwrite the remote annotations.
            targetState.pending = null
          }
        } else if (targetState.pending !== null) {
          targetState.pending = null
        }
      }
    },
    [
      getCanvasSaveState,
      loadCategories,
      loadUncategorizedImages,
      reconcileCanvasSave,
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
      if (conflictedCanvasSaveImageIdsRef.current.has(targetImage.id)) {
        return Promise.resolve({ success: false, persisted: false })
      }
      if (uncertainCanvasSaveImageIdsRef.current.has(targetImage.id)) {
        // Preserve the newest local annotations while the authoritative read
        // resolves. This applies to every later save path, including a flush
        // with no previously queued edit.
        targetState.pending = annotations
        return reconcileCanvasSave(targetImage).then(
          () => targetState.inFlightPromise ?? { success: false, persisted: false },
        )
      }
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
    [getCanvasSaveState, reconcileCanvasSave, selectedImage],
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
      if (targetState.inFlight || targetState.reconciling) {
        // A save or recovery read is in-flight for this image — queue the
        // latest data until its version is safe to use.
        targetState.pending = annotations
        return
      }
      targetState.pending = null
      const timer = setTimeout(() => {
        canvasSaveTimersRef.current.delete(targetImage.id)
        if (
          prevSelectedImageIdRef.current !== targetImage.id ||
          canvasCancellationImageIdsRef.current.has(targetImage.id)
        ) {
          return
        }
        const currentState = getCanvasSaveState(targetImage)
        if (currentState.inFlight || currentState.reconciling) {
          currentState.pending = annotations
          return
        }
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
    const awaitActiveSave = async () => {
      while (true) {
        const active = targetState.inFlightPromise ?? targetState.reconciliationPromise
        if (!active) return
        await active
      }
    }
    const wasActive = targetState.inFlight || targetState.reconciling
    if (wasActive) {
      await awaitActiveSave()
      // An in-flight save which completed normally already persisted the
      // current edit. Only retry if it became indeterminate while we waited.
      if (!uncertainCanvasSaveImageIdsRef.current.has(targetImage.id)) return
    }
    // Use the ref (always current) instead of localCanvasAnnotations state
    // which may be stale due to React's async state batching.
    const latest = latestCanvasAnnotationsRef.current
    const annotations = latest ?? targetState.pending
    if (annotations) {
      targetState.pending = null
      await startCanvasSave(annotations, targetImage)
    }
    await awaitActiveSave()
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
        const cancellationSnapshot = targetState.cancellationBaseline ?? snapshot
        const inFlightPromise = targetState.inFlightPromise
        const reconciliationPromise = targetState.reconciliationPromise
        clearCanvasSaveTimer(targetImage.id)
        targetState.pending = null
        latestCanvasAnnotationsRef.current = null
        setLocalCanvasAnnotations(cancellationSnapshot)

        if (inFlightPromise) {
          // The in-flight request cannot be aborted. Await it, then use its
          // returned version to roll back the original image explicitly. The
          // target image is captured so a later image switch cannot retarget the
          // rollback request.
          const result = await inFlightPromise
          if (!result.persisted) return false
          const rollback = await startCanvasSave(
            cancellationSnapshot,
            targetImage,
            result.updated?.version ?? targetImage.version,
          )
          return rollback.success
        }

        if (reconciliationPromise) await reconciliationPromise

        if (conflictedCanvasSaveImageIdsRef.current.has(targetImage.id)) {
          return false
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
          // The authoritative read removes the ambiguity even if a rollback
          // is still needed, so the rollback itself can use its known version.
          uncertainCanvasSaveImageIdsRef.current.delete(targetImage.id)
          if (JSON.stringify(authoritativeAnnotations) !== JSON.stringify(cancellationSnapshot)) {
            const rollback = await startCanvasSave(
              cancellationSnapshot,
              targetImage,
              authoritativeImage.version,
            )
            if (!rollback.success) return false
          }
          return true
        }

        if (
          JSON.stringify(targetState.lastSavedAnnotations) === JSON.stringify(cancellationSnapshot)
        ) {
          return true
        }

        const rollback = await startCanvasSave(cancellationSnapshot, targetImage)
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

  const resetCanvasCancellationBaseline = useCallback(() => {
    if (!selectedImage) return
    getCanvasSaveState(selectedImage).cancellationBaseline = null
    setCanvasCancellationBaseline((current) =>
      current?.imageId === selectedImage.id ? null : current,
    )
  }, [getCanvasSaveState, selectedImage])

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
    /** Conflict-resolving baseline for the active CanvasOverlay edit session. */
    canvasCancellationBaseline,
    /** Clear the edit-session baseline after the canvas exits edit mode. */
    resetCanvasCancellationBaseline,
    /** Latest known image version (survives across metadata operations without viewer remount). */
    latestVersionRef,
    /** Latest known metadata (survives across metadata operations without viewer remount). */
    latestMetadataRef,
  }
}

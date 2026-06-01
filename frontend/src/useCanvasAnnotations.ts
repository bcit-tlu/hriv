import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { CanvasAnnotation } from "./components/CanvasOverlay";
import { updateImage, userMessage } from "./api";
import type { ImageItem } from "./types";

/** Dependencies injected by the host component. */
export interface UseCanvasAnnotationsDeps {
    selectedImage: ImageItem | null;
    loadCategories: () => Promise<void>;
    loadUncategorizedImages: (opts?: { signal?: AbortSignal }) => void;
    setErrorSnack: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * Manages canvas annotation state, debounced persistence, and version tracking.
 *
 * `latestVersionRef` and `latestMetadataRef` are exposed so that callers that
 * perform other metadata-modifying operations (lock/clear overlays) can read
 * and update the authoritative version without triggering a viewer remount.
 */
export function useCanvasAnnotations(deps: UseCanvasAnnotationsDeps) {
    const { selectedImage, loadCategories, loadUncategorizedImages, setErrorSnack } = deps;

    // --- Refs ---

    // Track the latest known image version independently from selectedImage
    // to avoid stale-version 409s when clearing overlays after locking
    // (lock intentionally does NOT update selectedImage to avoid viewer remount).
    const latestVersionRef = useRef<number>(0);
    // Track the latest known metadata independently from selectedImage so that
    // successive metadata-modifying operations (lock, canvas annotations, clear)
    // don't clobber each other's fields.  Initialised from selectedImage and
    // updated after every successful PATCH.
    // undefined = not yet initialised (use selectedImage); null/object = latest known server state
    const latestMetadataRef = useRef<
        Record<string, unknown> | null | undefined
    >(undefined);
    // Debounce timer for canvas annotation saves to avoid 409 version conflicts
    const canvasSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const canvasSaveInFlightRef = useRef(false);
    const pendingCanvasAnnotationsRef = useRef<CanvasAnnotation[] | null>(null);
    /** Always-current annotations last passed to handleCanvasAnnotationsChange.
     *  Used by flushCanvasAnnotations to avoid reading stale React state. */
    const latestCanvasAnnotationsRef = useRef<CanvasAnnotation[] | null>(null);
    // Track which image ID the current in-flight save targets so stale completions
    // don't overwrite refs after an image change
    const saveTargetImageIdRef = useRef<number | null>(null);

    // --- State ---

    // Local override for canvas annotations so view mode reflects edits immediately
    // (selectedImage is intentionally NOT updated after saves to avoid viewer remount)
    const [localCanvasAnnotations, setLocalCanvasAnnotations] = useState<
        CanvasAnnotation[] | null
    >(null);

    // --- Effects ---

    // Reset version ref when a different image is selected
    useEffect(() => {
        latestVersionRef.current = selectedImage?.version ?? 0;
        latestMetadataRef.current = undefined; // reset to 'uninitialised' so first read falls back to selectedImage
        setLocalCanvasAnnotations(null); // fall back to server-derived data for new image
        // Clear any pending canvas annotation saves for the previous image
        if (canvasSaveTimerRef.current) {
            clearTimeout(canvasSaveTimerRef.current);
            canvasSaveTimerRef.current = null;
        }
        pendingCanvasAnnotationsRef.current = null;
        latestCanvasAnnotationsRef.current = null;
        canvasSaveInFlightRef.current = false;
        saveTargetImageIdRef.current = null;
    }, [selectedImage]);

    // --- Memos ---

    // Extract canvas annotations from the selected image's metadata
    const canvasAnnotations = useMemo((): CanvasAnnotation[] => {
        const meta = selectedImage?.metadataExtra;
        if (!meta) return [];
        const annotations = meta.canvas_annotations;
        if (!Array.isArray(annotations)) return [];
        return annotations as CanvasAnnotation[];
    }, [selectedImage]);

    // --- Callbacks ---

    // Persist canvas annotations to server.  Called by the debounced handler below.
    const saveCanvasAnnotations = useCallback(
        async (annotations: CanvasAnnotation[]) => {
            if (!selectedImage) return;
            const targetImageId = selectedImage.id;
            saveTargetImageIdRef.current = targetImageId;
            canvasSaveInFlightRef.current = true;
            try {
                const mergeValue =
                    annotations.length > 0 ? annotations : null;
                const currentVersion =
                    latestVersionRef.current || selectedImage.version;
                const updated = await updateImage(
                    selectedImage.id,
                    {
                        metadata_extra_merge: {
                            canvas_annotations: mergeValue,
                        },
                    },
                    currentVersion,
                );
                // Only update shared refs if the image hasn't changed while we were saving
                if (saveTargetImageIdRef.current === targetImageId) {
                    latestVersionRef.current = updated.version;
                    latestMetadataRef.current = updated.metadata_extra ?? {};
                }
                await loadCategories();
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to save canvas annotations", err);
                setErrorSnack(userMessage(err, "Failed to save annotations."));
            } finally {
                // Only clear in-flight flag and flush queue if still targeting the same image
                if (saveTargetImageIdRef.current === targetImageId) {
                    canvasSaveInFlightRef.current = false;
                    if (pendingCanvasAnnotationsRef.current !== null) {
                        const queued = pendingCanvasAnnotationsRef.current;
                        pendingCanvasAnnotationsRef.current = null;
                        void saveCanvasAnnotations(queued);
                    }
                }
            }
        },
        [selectedImage, loadCategories, loadUncategorizedImages, setErrorSnack],
    );

    // Save canvas annotations to image metadata_extra (debounced).
    // Rapid edits reset a 600ms timer; if a save is already in-flight the
    // latest data is queued and flushed when the current request completes.
    // Also eagerly updates local state so view mode reflects edits immediately.
    const handleCanvasAnnotationsChange = useCallback(
        (annotations: CanvasAnnotation[]) => {
            setLocalCanvasAnnotations(annotations);
            latestCanvasAnnotationsRef.current = annotations;
            if (canvasSaveTimerRef.current)
                clearTimeout(canvasSaveTimerRef.current);
            if (canvasSaveInFlightRef.current) {
                // A save is in-flight — queue the latest data (replaces any prior queued data)
                pendingCanvasAnnotationsRef.current = annotations;
                return;
            }
            canvasSaveTimerRef.current = setTimeout(() => {
                canvasSaveTimerRef.current = null;
                void saveCanvasAnnotations(annotations);
            }, 600);
        },
        [saveCanvasAnnotations],
    );

    // Flush any pending canvas annotation save immediately (bypass debounce).
    // Used by the "Done" button to ensure data is persisted before exiting edit mode,
    // and by lock/clear operations to avoid race conditions.
    const flushCanvasAnnotations = useCallback(async () => {
        // Cancel any pending debounce timer
        if (canvasSaveTimerRef.current) {
            clearTimeout(canvasSaveTimerRef.current);
            canvasSaveTimerRef.current = null;
        }
        // If there's queued data waiting behind an in-flight save, grab it
        const pending = pendingCanvasAnnotationsRef.current;
        pendingCanvasAnnotationsRef.current = null;
        // If a save is already in-flight we need to wait for it, then save queued data
        if (canvasSaveInFlightRef.current) {
            // Re-queue so the in-flight finally block picks it up
            if (pending) pendingCanvasAnnotationsRef.current = pending;
            // Spin-wait (max ~3s) for the in-flight save to finish
            for (let i = 0; i < 30 && canvasSaveInFlightRef.current; i++) {
                await new Promise((r) => setTimeout(r, 100));
            }
            // After waiting, save any data the in-flight handler didn't pick up
            const stillPending = pendingCanvasAnnotationsRef.current;
            if (stillPending && !canvasSaveInFlightRef.current) {
                pendingCanvasAnnotationsRef.current = null;
                await saveCanvasAnnotations(stillPending);
            }
            return;
        }
        // Use the ref (always current) instead of localCanvasAnnotations state
        // which may be stale due to React's async state batching.
        const latest = latestCanvasAnnotationsRef.current;
        if (pending) {
            await saveCanvasAnnotations(pending);
        } else if (latest) {
            await saveCanvasAnnotations(latest);
        }
    }, [saveCanvasAnnotations]);

    return {
        /** Local annotations (reflects edits immediately). Falls back to server data when null. */
        localCanvasAnnotations,
        /** Server-derived annotations from selectedImage metadata. */
        canvasAnnotations,
        /** Debounced change handler — call on every annotation edit. */
        handleCanvasAnnotationsChange,
        /** Flush any pending save immediately (bypass debounce). */
        flushCanvasAnnotations,
        /** Latest known image version (survives across metadata operations without viewer remount). */
        latestVersionRef,
        /** Latest known metadata (survives across metadata operations without viewer remount). */
        latestMetadataRef,
    };
}

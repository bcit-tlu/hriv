import { useCallback, useMemo } from "react";
import type { OverlayRect, MeasurementConfig } from "./components/imageViewerUtils";
import { updateImage, userMessage } from "./api";
import type { ImageItem } from "./types";

/** Dependencies injected by the host component. */
export interface UseOverlayPersistenceDeps {
    selectedImage: ImageItem | null;
    flushCanvasAnnotations: () => Promise<void>;
    latestVersionRef: React.MutableRefObject<number>;
    latestMetadataRef: React.MutableRefObject<
        Record<string, unknown> | null | undefined
    >;
    loadCategories: () => Promise<void>;
    loadUncategorizedImages: (opts?: { signal?: AbortSignal }) => void;
    setLockEngaged: React.Dispatch<React.SetStateAction<boolean>>;
    setErrorSnack: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * Manages overlay lock/unlock/clear persistence and measurement extraction.
 *
 * Uses `latestVersionRef` / `latestMetadataRef` from `useCanvasAnnotations`
 * to avoid stale-version 409s when successive metadata-modifying operations
 * (lock → canvas save → clear) race on the same image.
 */
export function useOverlayPersistence(deps: UseOverlayPersistenceDeps) {
    const {
        selectedImage,
        flushCanvasAnnotations,
        latestVersionRef,
        latestMetadataRef,
        loadCategories,
        loadUncategorizedImages,
        setLockEngaged,
        setErrorSnack,
    } = deps;

    const selectedImageMeasurement = useMemo(():
        | MeasurementConfig
        | undefined => {
        const meta = selectedImage?.metadataExtra;
        if (!meta) return undefined;
        const scale =
            typeof meta.measurement_scale === "number"
                ? meta.measurement_scale
                : undefined;
        const unit =
            typeof meta.measurement_unit === "string"
                ? meta.measurement_unit
                : undefined;
        if (!scale && !unit) return undefined;
        return { scale, unit };
    }, [selectedImage]);

    const handleLockOverlays = useCallback(
        async (rects: OverlayRect[]) => {
            if (!selectedImage) return;
            await flushCanvasAnnotations();
            try {
                const currentVersion =
                    latestVersionRef.current || selectedImage.version;
                const updated = await updateImage(
                    selectedImage.id,
                    { metadata_extra_merge: { locked_overlays: rects } },
                    currentVersion,
                );
                latestVersionRef.current = updated.version;
                latestMetadataRef.current = updated.metadata_extra ?? {};
                setLockEngaged(true);
                await loadCategories();
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to lock overlays", err);
                setErrorSnack(userMessage(err, "Failed to lock overlays."));
            }
        },
        [
            selectedImage,
            flushCanvasAnnotations,
            latestVersionRef,
            latestMetadataRef,
            loadCategories,
            loadUncategorizedImages,
            setLockEngaged,
            setErrorSnack,
        ],
    );

    const handleUnlockOverlays = useCallback(() => {
        setLockEngaged(false);
    }, [setLockEngaged]);

    const handleClearOverlays = useCallback(async () => {
        if (!selectedImage) return;
        await flushCanvasAnnotations();
        try {
            const currentVersion =
                latestVersionRef.current || selectedImage.version;
            const updated = await updateImage(
                selectedImage.id,
                { metadata_extra_merge: { locked_overlays: null } },
                currentVersion,
            );
            latestVersionRef.current = updated.version;
            latestMetadataRef.current = updated.metadata_extra ?? {};
            await loadCategories();
            loadUncategorizedImages();
        } catch (err) {
            console.error("Failed to clear locked overlays", err);
            setErrorSnack(userMessage(err, "Failed to clear locked overlays."));
        }
    }, [
        selectedImage,
        flushCanvasAnnotations,
        latestVersionRef,
        latestMetadataRef,
        loadCategories,
        loadUncategorizedImages,
        setErrorSnack,
    ]);

    return {
        selectedImageMeasurement,
        handleLockOverlays,
        handleUnlockOverlays,
        handleClearOverlays,
    };
}

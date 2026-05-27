import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { ViewportState, OverlayRect } from "./components/imageViewerUtils";
import { MAX_SHARE_OVERLAYS } from "./components/imageViewerUtils";
import { buildNavHistoryState } from "./useNavigationHistory";
import { findImageInTree, resolveCategoryPath } from "./treeUtils";
import type { Category, ImageItem } from "./types";

interface ParsedShareableUrl {
    imageId: number | null;
    viewport: ViewportState | undefined;
    overlays: OverlayRect[] | undefined;
    catIds: number[] | null;
}

/**
 * Parse shareable-link params from the current URL.
 * Extracted as a plain function so it can run synchronously during the
 * first render (via useRef initialisation), eliminating any dependency
 * on React effect execution order.
 */
function parseShareableUrlParams(): ParsedShareableUrl {
    const params = new URLSearchParams(window.location.search);
    let imageId: number | null = null;
    let viewport: ViewportState | undefined;
    let overlays: OverlayRect[] | undefined;
    let catIds: number[] | null = null;

    const imgId = params.get("image");
    if (imgId) {
        const parsedId = Number(imgId);
        if (!Number.isNaN(parsedId)) {
            imageId = parsedId;
            const z = params.get("zoom");
            const px = params.get("x");
            const py = params.get("y");
            if (z && px && py) {
                const zoom = parseFloat(z);
                const x = parseFloat(px);
                const y = parseFloat(py);
                if (
                    !Number.isNaN(zoom) &&
                    !Number.isNaN(x) &&
                    !Number.isNaN(y)
                ) {
                    const rot = params.get("rotation");
                    const rotation = rot ? parseFloat(rot) : undefined;
                    viewport = {
                        zoom,
                        x,
                        y,
                        rotation:
                            rotation && !Number.isNaN(rotation)
                                ? rotation
                                : undefined,
                    };
                }
            }
            const parsedOverlays: OverlayRect[] = [];
            for (let i = 0; i < MAX_SHARE_OVERLAYS; i++) {
                const ov = params.get(`ov${i}`);
                if (!ov) continue;
                const parts = ov.split(",").map(Number);
                if (
                    parts.length === 4 &&
                    parts.every((n) => !Number.isNaN(n))
                ) {
                    parsedOverlays.push({
                        x: parts[0],
                        y: parts[1],
                        w: parts[2],
                        h: parts[3],
                    });
                }
            }
            if (parsedOverlays.length > 0) {
                overlays = parsedOverlays;
            }
        }
    }
    if (!imgId) {
        const catStr = params.get("cat");
        if (catStr) {
            const ids = catStr
                .split(",")
                .map(Number)
                .filter((n) => !Number.isNaN(n));
            if (ids.length > 0) {
                catIds = ids;
            }
        }
    }
    return { imageId, viewport, overlays, catIds };
}

export interface UseShareableImageStateDeps {
    /** Currently selected image — changes trigger URL sync. */
    selectedImage: ImageItem | null;
    categories: Category[];
    categoriesLoading: boolean;
    uncategorizedImages: ImageItem[];
    uncategorizedLoaded: React.RefObject<boolean>;
    /** Active page — changes trigger URL sync (non-browse pages write `?page=`). */
    page: string;
    /** Current category path — changes trigger URL sync (`?cat=`). */
    path: Category[];
    setPath: React.Dispatch<React.SetStateAction<Category[]>>;
    setSelectedImage: React.Dispatch<React.SetStateAction<ImageItem | null>>;
    /**
     * When false, the hook skips the URL sync effect that writes page/path/
     * selectedImage/viewport/overlay state to `window.location`.
     * Defaults to true if omitted.
     */
    enableUrlSync?: boolean;
}

export interface UseShareableImageStateReturn {
    viewportState: ViewportState | undefined;
    setViewportState: React.Dispatch<React.SetStateAction<ViewportState | undefined>>;
    overlays: OverlayRect[];
    setOverlays: React.Dispatch<React.SetStateAction<OverlayRect[]>>;
    lockEngaged: boolean;
    setLockEngaged: React.Dispatch<React.SetStateAction<boolean>>;
    snackOpen: boolean;
    setSnackOpen: React.Dispatch<React.SetStateAction<boolean>>;
    initialViewport: ViewportState | undefined;
    initialOverlays: OverlayRect[];
    lockedOverlays: OverlayRect[] | undefined;
    hasLockedOverlays: boolean;
    handleViewportChange: (state: ViewportState) => void;
    handleOverlaysChange: (newOverlays: OverlayRect[]) => void;
    copyShareLink: () => void;
    clearImage: () => void;
    clearPending: () => void;
    pendingImageId: React.RefObject<number | null>;
}

export function useShareableImageState(
    deps: UseShareableImageStateDeps,
): UseShareableImageStateReturn {
    const {
        selectedImage,
        categories,
        categoriesLoading,
        uncategorizedImages,
        uncategorizedLoaded,
        page,
        path,
        setPath,
        setSelectedImage,
        enableUrlSync = true,
    } = deps;

    // Shareable-URL state
    const [viewportState, setViewportState] = useState<
        ViewportState | undefined
    >(undefined);
    const [overlays, setOverlays] = useState<OverlayRect[]>([]);
    const [lockEngaged, setLockEngaged] = useState(false);
    const [snackOpen, setSnackOpen] = useState(false);

    // Parse URL synchronously during the first render so that pending refs
    // are populated before any effects run.  This removes the implicit
    // dependency on effect execution order between this hook and App.tsx.
    const initialUrl = useRef(parseShareableUrlParams());
    const pendingImageId = useRef<number | null>(initialUrl.current.imageId);
    const pendingViewport = useRef<ViewportState | undefined>(
        initialUrl.current.viewport,
    );
    const pendingOverlays = useRef<OverlayRect[] | undefined>(
        initialUrl.current.overlays,
    );
    const pendingCatIds = useRef<number[] | null>(initialUrl.current.catIds);

    // Once categories are loaded, restore a pending shared-link image
    useEffect(() => {
        if (pendingImageId.current === null || categoriesLoading) return;
        const id = pendingImageId.current;

        // Check uncategorized images first
        const uncatImg = uncategorizedImages.find((img) => img.id === id);
        if (uncatImg) {
            pendingImageId.current = null;
            setSelectedImage(uncatImg);
            setViewportState(pendingViewport.current);
            pendingViewport.current = undefined;
            if (pendingOverlays.current) {
                setOverlays(pendingOverlays.current);
                pendingOverlays.current = undefined;
            }
            return;
        }

        const result = findImageInTree(categories, id);
        if (result) {
            pendingImageId.current = null;
            setPath(result.path);
            setSelectedImage(result.image);
            setViewportState(pendingViewport.current);
            pendingViewport.current = undefined;
            if (pendingOverlays.current) {
                setOverlays(pendingOverlays.current);
                pendingOverlays.current = undefined;
            }
        } else if (!categoriesLoading && uncategorizedLoaded.current) {
            // Both data sources have loaded — image doesn't exist.
            // Clear pending state and URL so URL sync can resume normally.
            pendingImageId.current = null;
            pendingViewport.current = undefined;
            pendingOverlays.current = undefined;
            window.history.replaceState(
                buildNavHistoryState("browse", [], null),
                "",
                window.location.pathname,
            );
        }
        // Otherwise keep pendingImageId so we retry on the next data update.
    }, [categories, uncategorizedImages, categoriesLoading, uncategorizedLoaded, setSelectedImage, setPath]);

    // Resolve pending category path from URL (when no image param is present)
    useEffect(() => {
        if (pendingCatIds.current === null || categoriesLoading) return;
        const ids = pendingCatIds.current;
        pendingCatIds.current = null;
        const resolved = resolveCategoryPath(categories, ids);
        if (resolved.length > 0) {
            setPath(resolved);
        }
    }, [categories, categoriesLoading, setPath]);

    // Keep URL search params in sync with the current view.
    // Skipped when enableUrlSync is false so consumers that only need the
    // state/memos without URL side-effects can opt out.
    useEffect(() => {
        if (!enableUrlSync) return;
        // Don't overwrite URL while a shared-link image is still pending resolution
        if (pendingImageId.current !== null) return;
        const params = new URLSearchParams();
        if (page !== "browse") {
            params.set("page", page);
        } else {
            if (path.length > 0) {
                params.set(
                    "cat",
                    path.map((c) => c.id).join(","),
                );
            }
            if (selectedImage) {
                params.set("image", String(selectedImage.id));
                if (viewportState) {
                    params.set("zoom", viewportState.zoom.toFixed(4));
                    params.set("x", viewportState.x.toFixed(6));
                    params.set("y", viewportState.y.toFixed(6));
                    if (viewportState.rotation) {
                        params.set(
                            "rotation",
                            viewportState.rotation.toFixed(1),
                        );
                    }
                }
                // Serialize overlay rectangles (up to MAX_SHARE_OVERLAYS)
                for (
                    let i = 0;
                    i < Math.min(overlays.length, MAX_SHARE_OVERLAYS);
                    i++
                ) {
                    const r = overlays[i];
                    params.set(
                        `ov${i}`,
                        [r.x, r.y, r.w, r.h]
                            .map((n) => n.toPrecision(8))
                            .join(","),
                    );
                }
            }
        }
        const qs = params.toString();
        const newUrl = qs
            ? `${window.location.pathname}?${qs}`
            : window.location.pathname;
        window.history.replaceState(
            buildNavHistoryState(
                page,
                path.map((c) => c.id),
                selectedImage?.id ?? null,
            ),
            "",
            newUrl,
        );
    }, [enableUrlSync, page, path, selectedImage, viewportState, overlays]);

    const handleViewportChange = useCallback((state: ViewportState) => {
        setViewportState(state);
    }, []);

    const handleOverlaysChange = useCallback((newOverlays: OverlayRect[]) => {
        setOverlays(newOverlays);
    }, []);

    // Memoize initialViewport so it stays referentially stable per image.
    // Keyed on image ID so metadata-only updates (e.g. measurement settings)
    // do not reset the viewport and re-create the OSD viewer.
    const initialViewport = useMemo(() => viewportState, [selectedImage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Derive locked overlays from the selected image's metadata.
    // Validates each entry has numeric x, y, w, h to guard against malformed JSONB data.
    const lockedOverlays = useMemo((): OverlayRect[] | undefined => {
        const meta = selectedImage?.metadataExtra;
        if (!meta) return undefined;
        const locked = meta.locked_overlays;
        if (!Array.isArray(locked) || locked.length === 0) return undefined;
        const valid = locked.filter(
            (entry): entry is OverlayRect =>
                entry != null &&
                typeof entry === "object" &&
                typeof (entry as Record<string, unknown>).x === "number" &&
                typeof (entry as Record<string, unknown>).y === "number" &&
                typeof (entry as Record<string, unknown>).w === "number" &&
                typeof (entry as Record<string, unknown>).h === "number",
        );
        return valid.length > 0 ? valid : undefined;
    }, [selectedImage]);

    const hasLockedOverlays =
        lockedOverlays !== undefined && lockedOverlays.length > 0;

    // Auto-engage lock when image has persisted overlays
    useEffect(() => {
        setLockEngaged(hasLockedOverlays);
    }, [hasLockedOverlays]);

    // Memoize initialOverlays: use locked overlays on initial load if no URL overlays.
    // Keyed on image ID so metadata-only updates do not re-create the viewer.
    const initialOverlays = useMemo(() => {
        if (
            lockedOverlays &&
            lockedOverlays.length > 0 &&
            overlays.length === 0
        ) {
            return lockedOverlays;
        }
        return overlays;
    }, [selectedImage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const copyShareLink = useCallback(() => {
        const url = window.location.href;
        const fallbackCopy = () => {
            const input = document.createElement("input");
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand("copy");
            document.body.removeChild(input);
            setSnackOpen(true);
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard
                .writeText(url)
                .then(() => {
                    setSnackOpen(true);
                })
                .catch(fallbackCopy);
        } else {
            fallbackCopy();
        }
    }, []);

    const clearImage = useCallback(() => {
        setSelectedImage(null);
        setViewportState(undefined);
        setOverlays([]);
    }, [setSelectedImage]);

    const clearPending = useCallback(() => {
        pendingImageId.current = null;
        pendingViewport.current = undefined;
        pendingOverlays.current = undefined;
        pendingCatIds.current = null;
    }, []);

    return {
        viewportState,
        setViewportState,
        overlays,
        setOverlays,
        lockEngaged,
        setLockEngaged,
        snackOpen,
        setSnackOpen,
        initialViewport,
        initialOverlays,
        lockedOverlays,
        hasLockedOverlays,
        handleViewportChange,
        handleOverlaysChange,
        copyShareLink,
        clearImage,
        clearPending,
        pendingImageId,
    };
}

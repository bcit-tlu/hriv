import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOverlayPersistence } from "../src/useOverlayPersistence";
import type { UseOverlayPersistenceDeps } from "../src/useOverlayPersistence";
import type { ImageItem } from "../src/types";
import type { OverlayRect } from "../src/components/imageViewerUtils";
import * as api from "../src/api";

vi.mock("../src/api", async () => {
    const actual = await vi.importActual<typeof api>("../src/api");
    return {
        ...actual,
        updateImage: vi.fn(),
    };
});

const mockUpdateImage = vi.mocked(api.updateImage);

function makeImage(
    id: number,
    overrides: Partial<ImageItem> = {},
): ImageItem {
    return {
        id,
        name: `img-${id}`,
        thumb: `/thumb/${id}.jpg`,
        tileSources: `/tiles/${id}`,
        active: true,
        sortOrder: 0,
        version: 1,
        ...overrides,
    };
}

function makeDeps(
    overrides: Partial<UseOverlayPersistenceDeps> = {},
): UseOverlayPersistenceDeps {
    return {
        selectedImage: null,
        flushCanvasAnnotations: vi.fn().mockResolvedValue(undefined),
        latestVersionRef: { current: 0 },
        latestMetadataRef: { current: undefined },
        loadCategories: vi.fn().mockResolvedValue(undefined),
        loadUncategorizedImages: vi.fn(),
        setLockEngaged: vi.fn(),
        setErrorSnack: vi.fn(),
        ...overrides,
    };
}

function makeRect(overrides: Partial<OverlayRect> = {}): OverlayRect {
    return { x: 0.1, y: 0.2, w: 0.3, h: 0.4, ...overrides };
}

describe("useOverlayPersistence", () => {
    beforeEach(() => {
        mockUpdateImage.mockReset();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("selectedImageMeasurement", () => {
        it("returns undefined when no image selected", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useOverlayPersistence(deps));
            expect(result.current.selectedImageMeasurement).toBeUndefined();
        });

        it("returns undefined when metadataExtra is null", () => {
            const image = makeImage(1, { metadataExtra: null });
            const deps = makeDeps({ selectedImage: image });
            const { result } = renderHook(() => useOverlayPersistence(deps));
            expect(result.current.selectedImageMeasurement).toBeUndefined();
        });

        it("returns undefined when no measurement fields present", () => {
            const image = makeImage(1, { metadataExtra: { other: "data" } });
            const deps = makeDeps({ selectedImage: image });
            const { result } = renderHook(() => useOverlayPersistence(deps));
            expect(result.current.selectedImageMeasurement).toBeUndefined();
        });

        it("extracts scale and unit from metadata", () => {
            const image = makeImage(1, {
                metadataExtra: { measurement_scale: 2.5, measurement_unit: "mm" },
            });
            const deps = makeDeps({ selectedImage: image });
            const { result } = renderHook(() => useOverlayPersistence(deps));
            expect(result.current.selectedImageMeasurement).toEqual({
                scale: 2.5,
                unit: "mm",
            });
        });

        it("extracts scale only when unit is missing", () => {
            const image = makeImage(1, {
                metadataExtra: { measurement_scale: 10 },
            });
            const deps = makeDeps({ selectedImage: image });
            const { result } = renderHook(() => useOverlayPersistence(deps));
            expect(result.current.selectedImageMeasurement).toEqual({
                scale: 10,
                unit: undefined,
            });
        });

        it("extracts unit only when scale is missing", () => {
            const image = makeImage(1, {
                metadataExtra: { measurement_unit: "um" },
            });
            const deps = makeDeps({ selectedImage: image });
            const { result } = renderHook(() => useOverlayPersistence(deps));
            expect(result.current.selectedImageMeasurement).toEqual({
                scale: undefined,
                unit: "um",
            });
        });
    });

    describe("handleLockOverlays", () => {
        it("flushes canvas annotations before persisting", async () => {
            const image = makeImage(1, { version: 3 });
            const flushCanvasAnnotations = vi.fn().mockResolvedValue(undefined);
            mockUpdateImage.mockResolvedValue({
                id: 1, name: "img-1", thumb: "/t", tile_sources: "/s",
                category_id: null, copyright: null, note: null, active: true, sort_order: 0,
                version: 4, metadata_extra: { locked_overlays: [makeRect()] },
                created_at: "2024-01-01", updated_at: "2024-01-01",
                width: null, height: null, file_size: null,
            });
            const latestVersionRef = { current: 3 };
            const latestMetadataRef: { current: Record<string, unknown> | null | undefined } = { current: undefined };
            const deps = makeDeps({
                selectedImage: image,
                flushCanvasAnnotations,
                latestVersionRef,
                latestMetadataRef,
            });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            await act(async () => {
                await result.current.handleLockOverlays([makeRect()]);
            });

            expect(flushCanvasAnnotations).toHaveBeenCalledOnce();
            expect(mockUpdateImage).toHaveBeenCalledOnce();
            expect(flushCanvasAnnotations.mock.invocationCallOrder[0])
                .toBeLessThan(mockUpdateImage.mock.invocationCallOrder[0]);
        });

        it("persists overlays and engages lock", async () => {
            const image = makeImage(1, { version: 5 });
            const rects = [makeRect({ x: 0.5 })];
            const latestVersionRef = { current: 5 };
            const latestMetadataRef: { current: Record<string, unknown> | null | undefined } = { current: undefined };
            const setLockEngaged = vi.fn();
            const loadCategories = vi.fn().mockResolvedValue(undefined);
            const loadUncategorizedImages = vi.fn();
            mockUpdateImage.mockResolvedValue({
                id: 1, name: "img-1", thumb: "/t", tile_sources: "/s",
                category_id: null, copyright: null, note: null, active: true, sort_order: 0,
                version: 6, metadata_extra: { locked_overlays: rects },
                created_at: "2024-01-01", updated_at: "2024-01-01",
                width: null, height: null, file_size: null,
            });
            const deps = makeDeps({
                selectedImage: image,
                latestVersionRef,
                latestMetadataRef,
                setLockEngaged,
                loadCategories,
                loadUncategorizedImages,
            });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            await act(async () => {
                await result.current.handleLockOverlays(rects);
            });

            expect(mockUpdateImage).toHaveBeenCalledWith(
                1,
                { metadata_extra_merge: { locked_overlays: rects } },
                5,
            );
            expect(latestVersionRef.current).toBe(6);
            expect(latestMetadataRef.current).toEqual({ locked_overlays: rects });
            expect(setLockEngaged).toHaveBeenCalledWith(true);
            expect(loadCategories).toHaveBeenCalled();
            expect(loadUncategorizedImages).toHaveBeenCalled();
        });

        it("is a no-op when no image is selected", async () => {
            const deps = makeDeps({ selectedImage: null });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            await act(async () => {
                await result.current.handleLockOverlays([makeRect()]);
            });

            expect(mockUpdateImage).not.toHaveBeenCalled();
        });

        it("calls setErrorSnack on failure", async () => {
            const image = makeImage(1);
            mockUpdateImage.mockRejectedValue(new Error("Network error"));
            const setErrorSnack = vi.fn();
            const deps = makeDeps({ selectedImage: image, setErrorSnack });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            await act(async () => {
                await result.current.handleLockOverlays([makeRect()]);
            });

            expect(setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("handleUnlockOverlays", () => {
        it("disengages lock without API call", () => {
            const setLockEngaged = vi.fn();
            const deps = makeDeps({ setLockEngaged });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            act(() => {
                result.current.handleUnlockOverlays();
            });

            expect(setLockEngaged).toHaveBeenCalledWith(false);
            expect(mockUpdateImage).not.toHaveBeenCalled();
        });
    });

    describe("handleClearOverlays", () => {
        it("flushes canvas annotations and clears overlays from metadata", async () => {
            const image = makeImage(1, { version: 7 });
            const flushCanvasAnnotations = vi.fn().mockResolvedValue(undefined);
            const latestVersionRef = { current: 7 };
            const latestMetadataRef: { current: Record<string, unknown> | null | undefined } = { current: undefined };
            const loadCategories = vi.fn().mockResolvedValue(undefined);
            const loadUncategorizedImages = vi.fn();
            mockUpdateImage.mockResolvedValue({
                id: 1, name: "img-1", thumb: "/t", tile_sources: "/s",
                category_id: null, copyright: null, note: null, active: true, sort_order: 0,
                version: 8, metadata_extra: {},
                created_at: "2024-01-01", updated_at: "2024-01-01",
                width: null, height: null, file_size: null,
            });
            const deps = makeDeps({
                selectedImage: image,
                flushCanvasAnnotations,
                latestVersionRef,
                latestMetadataRef,
                loadCategories,
                loadUncategorizedImages,
            });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            await act(async () => {
                await result.current.handleClearOverlays();
            });

            expect(flushCanvasAnnotations).toHaveBeenCalledOnce();
            expect(mockUpdateImage).toHaveBeenCalledWith(
                1,
                { metadata_extra_merge: { locked_overlays: null } },
                7,
            );
            expect(latestVersionRef.current).toBe(8);
            expect(latestMetadataRef.current).toEqual({});
            expect(loadCategories).toHaveBeenCalled();
            expect(loadUncategorizedImages).toHaveBeenCalled();
        });

        it("is a no-op when no image is selected", async () => {
            const deps = makeDeps({ selectedImage: null });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            await act(async () => {
                await result.current.handleClearOverlays();
            });

            expect(mockUpdateImage).not.toHaveBeenCalled();
        });

        it("calls setErrorSnack on failure", async () => {
            const image = makeImage(1);
            mockUpdateImage.mockRejectedValue(new Error("Server error"));
            const setErrorSnack = vi.fn();
            const deps = makeDeps({ selectedImage: image, setErrorSnack });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            await act(async () => {
                await result.current.handleClearOverlays();
            });

            expect(setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("version tracking across operations", () => {
        it("uses latestVersionRef for lock after a prior save updated it", async () => {
            const image = makeImage(1, { version: 1 });
            const latestVersionRef = { current: 5 };
            const latestMetadataRef: { current: Record<string, unknown> | null | undefined } = { current: {} };
            mockUpdateImage.mockResolvedValue({
                id: 1, name: "img-1", thumb: "/t", tile_sources: "/s",
                category_id: null, copyright: null, note: null, active: true, sort_order: 0,
                version: 6, metadata_extra: {},
                created_at: "2024-01-01", updated_at: "2024-01-01",
                width: null, height: null, file_size: null,
            });
            const deps = makeDeps({
                selectedImage: image,
                latestVersionRef,
                latestMetadataRef,
            });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            await act(async () => {
                await result.current.handleLockOverlays([makeRect()]);
            });

            expect(mockUpdateImage).toHaveBeenCalledWith(
                1,
                { metadata_extra_merge: { locked_overlays: [makeRect()] } },
                5,
            );
        });

        it("falls back to selectedImage.version when latestVersionRef is 0", async () => {
            const image = makeImage(1, { version: 3 });
            const latestVersionRef = { current: 0 };
            const latestMetadataRef: { current: Record<string, unknown> | null | undefined } = { current: undefined };
            mockUpdateImage.mockResolvedValue({
                id: 1, name: "img-1", thumb: "/t", tile_sources: "/s",
                category_id: null, copyright: null, note: null, active: true, sort_order: 0,
                version: 4, metadata_extra: {},
                created_at: "2024-01-01", updated_at: "2024-01-01",
                width: null, height: null, file_size: null,
            });
            const deps = makeDeps({
                selectedImage: image,
                latestVersionRef,
                latestMetadataRef,
            });
            const { result } = renderHook(() => useOverlayPersistence(deps));

            await act(async () => {
                await result.current.handleClearOverlays();
            });

            expect(mockUpdateImage).toHaveBeenCalledWith(
                1,
                { metadata_extra_merge: { locked_overlays: null } },
                3,
            );
        });
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useShareableImageState } from "../src/useShareableImageState";
import type { UseShareableImageStateDeps } from "../src/useShareableImageState";
import type { Category, ImageItem } from "../src/types";

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

function makeCategory(
    id: number,
    label: string,
    children: Category[] = [],
    images: ImageItem[] = [],
): Category {
    return {
        id,
        label,
        parentId: null,
        children,
        images,
        programIds: [],
    };
}

function makeDeps(overrides: Partial<UseShareableImageStateDeps> = {}): UseShareableImageStateDeps {
    return {
        selectedImage: null,
        categories: [],
        categoriesLoading: true,
        uncategorizedImages: [],
        uncategorizedLoaded: { current: false },
        page: "browse",
        path: [],
        setPath: vi.fn(),
        setSelectedImage: vi.fn(),
        ...overrides,
    };
}

describe("useShareableImageState", () => {
    let replaceStateSpy: ReturnType<typeof vi.spyOn>;
    let savedClipboard: Clipboard;
    let savedExecCommand: typeof document.execCommand | undefined;

    beforeEach(() => {
        replaceStateSpy = vi.spyOn(window.history, "replaceState");
        // Reset URL to clean state
        window.history.replaceState(null, "", "/");
        savedClipboard = navigator.clipboard;
        savedExecCommand = document.execCommand;
    });

    afterEach(() => {
        replaceStateSpy.mockRestore();
        Object.assign(navigator, { clipboard: savedClipboard });
        document.execCommand = savedExecCommand!;
    });

    describe("initial state", () => {
        it("starts with undefined viewport and empty overlays", () => {
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            expect(result.current.viewportState).toBeUndefined();
            expect(result.current.overlays).toEqual([]);
            expect(result.current.lockEngaged).toBe(false);
            expect(result.current.snackOpen).toBe(false);
        });
    });

    describe("handleViewportChange", () => {
        it("updates viewport state", () => {
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            act(() => {
                result.current.handleViewportChange({
                    zoom: 2.5,
                    x: 0.3,
                    y: 0.7,
                });
            });
            expect(result.current.viewportState).toEqual({
                zoom: 2.5,
                x: 0.3,
                y: 0.7,
            });
        });
    });

    describe("handleOverlaysChange", () => {
        it("updates overlays", () => {
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            const newOverlays = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }];
            act(() => {
                result.current.handleOverlaysChange(newOverlays);
            });
            expect(result.current.overlays).toEqual(newOverlays);
        });
    });

    describe("clearImage", () => {
        it("calls setSelectedImage(null) and resets viewport/overlays", () => {
            const setSelectedImage = vi.fn();
            const { result } = renderHook(() =>
                useShareableImageState(
                    makeDeps({ setSelectedImage }),
                ),
            );
            // Set some state first
            act(() => {
                result.current.handleViewportChange({
                    zoom: 3,
                    x: 0.5,
                    y: 0.5,
                });
                result.current.handleOverlaysChange([
                    { x: 0, y: 0, w: 1, h: 1 },
                ]);
            });
            act(() => {
                result.current.clearImage();
            });
            expect(setSelectedImage).toHaveBeenCalledWith(null);
            expect(result.current.viewportState).toBeUndefined();
            expect(result.current.overlays).toEqual([]);
        });
    });

    describe("copyShareLink", () => {
        it("sets snackOpen to true on success", async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator, {
                clipboard: { writeText },
            });
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            await act(async () => {
                result.current.copyShareLink();
                // Let the clipboard promise resolve
                await Promise.resolve();
            });
            expect(writeText).toHaveBeenCalled();
            expect(result.current.snackOpen).toBe(true);
        });

        it("uses fallback when clipboard API is unavailable", () => {
            Object.assign(navigator, { clipboard: undefined });
            // jsdom does not define execCommand — define it for this test
            document.execCommand = vi.fn().mockReturnValue(true);
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            act(() => {
                result.current.copyShareLink();
            });
            expect(document.execCommand).toHaveBeenCalledWith("copy");
            expect(result.current.snackOpen).toBe(true);
        });
    });

    describe("lockedOverlays", () => {
        it("returns undefined when no metadata", () => {
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            expect(result.current.lockedOverlays).toBeUndefined();
            expect(result.current.hasLockedOverlays).toBe(false);
        });

        it("derives locked overlays from selectedImage metadata", () => {
            const img = makeImage(1, {
                metadataExtra: {
                    locked_overlays: [
                        { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
                    ],
                },
            });
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps({ selectedImage: img })),
            );
            expect(result.current.lockedOverlays).toEqual([
                { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
            ]);
            expect(result.current.hasLockedOverlays).toBe(true);
        });

        it("filters out malformed overlay entries", () => {
            const img = makeImage(1, {
                metadataExtra: {
                    locked_overlays: [
                        { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
                        { x: "bad", y: 0.2, w: 0.3, h: 0.4 },
                        null,
                    ],
                },
            });
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps({ selectedImage: img })),
            );
            expect(result.current.lockedOverlays).toHaveLength(1);
        });

        it("returns undefined when locked_overlays is empty", () => {
            const img = makeImage(1, {
                metadataExtra: { locked_overlays: [] },
            });
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps({ selectedImage: img })),
            );
            expect(result.current.lockedOverlays).toBeUndefined();
        });
    });

    describe("lock auto-engage", () => {
        it("engages lock when image has locked overlays", () => {
            const img = makeImage(1, {
                metadataExtra: {
                    locked_overlays: [{ x: 0, y: 0, w: 1, h: 1 }],
                },
            });
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps({ selectedImage: img })),
            );
            expect(result.current.lockEngaged).toBe(true);
        });

        it("disengages lock when image has no locked overlays", () => {
            const img = makeImage(1, { metadataExtra: {} });
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps({ selectedImage: img })),
            );
            expect(result.current.lockEngaged).toBe(false);
        });
    });

    describe("URL parsing on mount", () => {
        it("parses image ID and viewport from URL", () => {
            window.history.replaceState(
                null,
                "",
                "/?image=42&zoom=2.5&x=0.3&y=0.7",
            );
            const setSelectedImage = vi.fn();
            const img = makeImage(42);
            const cat = makeCategory(1, "Root", [], [img]);
            const { result } = renderHook(() =>
                useShareableImageState(
                    makeDeps({
                        setSelectedImage,
                        categories: [cat],
                        categoriesLoading: false,
                    }),
                ),
            );
            expect(result.current.pendingImageId.current).toBeNull();
            expect(setSelectedImage).toHaveBeenCalledWith(img);
        });

        it("parses overlay rectangles from URL", () => {
            window.history.replaceState(
                null,
                "",
                "/?image=42&ov0=0.1,0.2,0.3,0.4",
            );
            const setSelectedImage = vi.fn();
            const img = makeImage(42);
            const cat = makeCategory(1, "Root", [], [img]);
            const { result } = renderHook(() =>
                useShareableImageState(
                    makeDeps({
                        setSelectedImage,
                        categories: [cat],
                        categoriesLoading: false,
                    }),
                ),
            );
            expect(result.current.overlays).toEqual([
                { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
            ]);
        });

        it("parses category path from URL when no image param", () => {
            window.history.replaceState(null, "", "/?cat=1,2");
            const setPath = vi.fn();
            const child = makeCategory(2, "Child");
            const root = makeCategory(1, "Root", [child]);
            renderHook(() =>
                useShareableImageState(
                    makeDeps({
                        setPath,
                        categories: [root],
                        categoriesLoading: false,
                    }),
                ),
            );
            expect(setPath).toHaveBeenCalledWith([root, child]);
        });
    });

    describe("pending image resolution", () => {
        it("resolves image from uncategorized when categories load", () => {
            window.history.replaceState(null, "", "/?image=5");
            const setSelectedImage = vi.fn();
            const img = makeImage(5);
            renderHook(() =>
                useShareableImageState(
                    makeDeps({
                        setSelectedImage,
                        uncategorizedImages: [img],
                        uncategorizedLoaded: { current: true },
                        categoriesLoading: false,
                    }),
                ),
            );
            expect(setSelectedImage).toHaveBeenCalledWith(img);
        });

        it("clears pending state when image not found in any source", () => {
            window.history.replaceState(null, "", "/?image=999");
            const setSelectedImage = vi.fn();
            const { result } = renderHook(() =>
                useShareableImageState(
                    makeDeps({
                        setSelectedImage,
                        categories: [makeCategory(1, "Root")],
                        uncategorizedLoaded: { current: true },
                        categoriesLoading: false,
                    }),
                ),
            );
            expect(result.current.pendingImageId.current).toBeNull();
            expect(setSelectedImage).not.toHaveBeenCalled();
        });
    });

    describe("URL sync effect", () => {
        it("syncs image and viewport to URL params", () => {
            const img = makeImage(42);
            const cat = makeCategory(1, "Root", [], [img]);
            const { result } = renderHook(() =>
                useShareableImageState(
                    makeDeps({
                        selectedImage: img,
                        categories: [cat],
                        categoriesLoading: false,
                        path: [cat],
                    }),
                ),
            );
            act(() => {
                result.current.handleViewportChange({
                    zoom: 3.0,
                    x: 0.5,
                    y: 0.5,
                });
            });
            const url = replaceStateSpy.mock.calls[
                replaceStateSpy.mock.calls.length - 1
            ][2] as string;
            expect(url).toContain("image=42");
            expect(url).toContain("zoom=");
        });

        it("sets page param for non-browse pages", () => {
            renderHook(() =>
                useShareableImageState(
                    makeDeps({ page: "manage" }),
                ),
            );
            const url = replaceStateSpy.mock.calls[
                replaceStateSpy.mock.calls.length - 1
            ][2] as string;
            expect(url).toContain("page=manage");
        });

        it("skips URL sync when enableUrlSync is false", () => {
            const callsBefore = replaceStateSpy.mock.calls.length;
            const img = makeImage(42);
            const { result } = renderHook(() =>
                useShareableImageState(
                    makeDeps({
                        selectedImage: img,
                        enableUrlSync: false,
                    }),
                ),
            );
            act(() => {
                result.current.handleViewportChange({
                    zoom: 5,
                    x: 0.1,
                    y: 0.9,
                });
            });
            // No new replaceState calls should have been made
            expect(replaceStateSpy.mock.calls.length).toBe(callsBefore);
        });

        it("skips replaceState on not-found pending image when enableUrlSync is false", () => {
            // Set URL with an image ID that won't exist in any data source
            window.history.replaceState(null, "", "/?image=999");
            const callsBefore = replaceStateSpy.mock.calls.length;
            const uncategorizedLoaded = { current: true };
            renderHook(() =>
                useShareableImageState(
                    makeDeps({
                        enableUrlSync: false,
                        categoriesLoading: false,
                        categories: [],
                        uncategorizedImages: [],
                        uncategorizedLoaded:
                            uncategorizedLoaded as React.RefObject<boolean>,
                    }),
                ),
            );
            // The not-found branch should NOT have called replaceState
            expect(replaceStateSpy.mock.calls.length).toBe(callsBefore);
        });
    });

    describe("setters are exposed", () => {
        it("exposes setViewportState", () => {
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            act(() => {
                result.current.setViewportState({ zoom: 1, x: 0, y: 0 });
            });
            expect(result.current.viewportState).toEqual({
                zoom: 1,
                x: 0,
                y: 0,
            });
        });

        it("exposes setOverlays", () => {
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            act(() => {
                result.current.setOverlays([{ x: 0, y: 0, w: 1, h: 1 }]);
            });
            expect(result.current.overlays).toHaveLength(1);
        });

        it("exposes setLockEngaged", () => {
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            act(() => {
                result.current.setLockEngaged(true);
            });
            expect(result.current.lockEngaged).toBe(true);
        });

        it("exposes setSnackOpen", () => {
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps()),
            );
            act(() => {
                result.current.setSnackOpen(true);
            });
            expect(result.current.snackOpen).toBe(true);
        });
    });

    describe("initialViewport", () => {
        it("is stable across re-renders for the same image", () => {
            const img = makeImage(1);
            const { result, rerender } = renderHook(
                (props: UseShareableImageStateDeps) =>
                    useShareableImageState(props),
                { initialProps: makeDeps({ selectedImage: img }) },
            );
            const first = result.current.initialViewport;
            act(() => {
                result.current.handleViewportChange({
                    zoom: 5,
                    x: 0.1,
                    y: 0.9,
                });
            });
            rerender(makeDeps({ selectedImage: img }));
            expect(result.current.initialViewport).toBe(first);
        });
    });

    describe("initialOverlays", () => {
        it("uses locked overlays when no URL overlays present", () => {
            const img = makeImage(1, {
                metadataExtra: {
                    locked_overlays: [{ x: 0, y: 0, w: 0.5, h: 0.5 }],
                },
            });
            const { result } = renderHook(() =>
                useShareableImageState(makeDeps({ selectedImage: img })),
            );
            expect(result.current.initialOverlays).toEqual([
                { x: 0, y: 0, w: 0.5, h: 0.5 },
            ]);
        });
    });

    describe("clearPending", () => {
        it("clears pendingImageId so URL sync resumes", () => {
            window.history.replaceState(null, "", "/?image=999");
            const { result } = renderHook(() =>
                useShareableImageState(
                    makeDeps({ categoriesLoading: true }),
                ),
            );
            // While categories are loading, pendingImageId is set from the URL
            expect(result.current.pendingImageId.current).toBe(999);
            act(() => {
                result.current.clearPending();
            });
            expect(result.current.pendingImageId.current).toBeNull();
        });
    });

    describe("rotation parsing", () => {
        it("parses rotation from URL", () => {
            window.history.replaceState(
                null,
                "",
                "/?image=42&zoom=1&x=0.5&y=0.5&rotation=90.0",
            );
            const setSelectedImage = vi.fn();
            const img = makeImage(42);
            const cat = makeCategory(1, "Root", [], [img]);
            renderHook(() =>
                useShareableImageState(
                    makeDeps({
                        setSelectedImage,
                        categories: [cat],
                        categoriesLoading: false,
                    }),
                ),
            );
            expect(setSelectedImage).toHaveBeenCalledWith(img);
        });
    });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImageActions } from "../src/useImageActions";
import type { UseImageActionsDeps } from "../src/useImageActions";
import type { Category, ImageItem } from "../src/types";
import * as api from "../src/api";

vi.mock("../src/api", async () => {
    const actual = await vi.importActual<typeof api>("../src/api");
    return {
        ...actual,
        updateImage: vi.fn(),
        deleteImage: vi.fn(),
        replaceImage: vi.fn(),
    };
});

const mockUpdateImage = vi.mocked(api.updateImage);
const mockDeleteImage = vi.mocked(api.deleteImage);
const mockReplaceImage = vi.mocked(api.replaceImage);

function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
    return {
        id: 100,
        name: "Test Image",
        thumb: "/thumb/100.jpg",
        tileSources: "/tiles/100",
        categoryId: null,
        active: true,
        sortOrder: 0,
        version: 1,
        ...overrides,
    };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
    return {
        id: 1,
        label: "Cat A",
        parentId: null,
        children: [],
        images: [],
        programIds: [],
        status: "active",
        cardImageId: null,
        metadataExtra: null,
        ...overrides,
    };
}

function makeDeps(overrides: Partial<UseImageActionsDeps> = {}): UseImageActionsDeps {
    return {
        categories: [],
        uncategorizedImages: [],
        selectedImage: null,
        setSelectedImage: vi.fn(),
        setPath: vi.fn(),
        loadCategories: vi.fn().mockResolvedValue(undefined),
        loadUncategorizedImages: vi.fn().mockResolvedValue(undefined),
        refreshCategories: vi.fn().mockResolvedValue([]),
        setErrorSnack: vi.fn(),
        clearImage: vi.fn(),
        startReplaceUpload: vi.fn().mockReturnValue({
            uploadId: 1,
            abort: new AbortController(),
        }),
        trackReplaceProgress: vi.fn(),
        transitionReplaceToProcessing: vi.fn(),
        removeReplaceUpload: vi.fn(),
        failReplaceUpload: vi.fn(),
        ...overrides,
    };
}

describe("useImageActions", () => {
    beforeEach(() => {
        mockUpdateImage.mockReset();
        mockDeleteImage.mockReset();
        mockReplaceImage.mockReset();
    });

    describe("state", () => {
        it("initializes imageEditOpen as false", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));
            expect(result.current.imageEditOpen).toBe(false);
        });

        it("initializes browseEditImage as null", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));
            expect(result.current.browseEditImage).toBeNull();
        });

        it("setImageEditOpen toggles state", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));
            act(() => {
                result.current.setImageEditOpen(true);
            });
            expect(result.current.imageEditOpen).toBe(true);
        });

        it("setBrowseEditImage sets image", () => {
            const img = makeImage();
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));
            act(() => {
                result.current.setBrowseEditImage(img);
            });
            expect(result.current.browseEditImage).toEqual(img);
        });
    });

    describe("selectedApiImage", () => {
        it("returns null when no selectedImage", () => {
            const deps = makeDeps({ selectedImage: null });
            const { result } = renderHook(() => useImageActions(deps));
            expect(result.current.selectedApiImage).toBeNull();
        });

        it("maps ImageItem to ApiImage shape", () => {
            const img = makeImage({
                id: 5,
                name: "Slide",
                thumb: "/t/5.jpg",
                tileSources: "/tiles/5",
                categoryId: 2,
                copyright: "CC",
                note: "test note",
                active: false,
                version: 3,
                metadataExtra: { key: "val" },
                width: 1024,
                height: 768,
                fileSize: 5000,
                createdAt: "2024-01-01",
                updatedAt: "2024-02-01",
            });
            const deps = makeDeps({ selectedImage: img });
            const { result } = renderHook(() => useImageActions(deps));
            expect(result.current.selectedApiImage).toEqual({
                id: 5,
                name: "Slide",
                thumb: "/t/5.jpg",
                tile_sources: "/tiles/5",
                category_id: 2,
                copyright: "CC",
                note: "test note",
                active: false,
                sort_order: 0,
                version: 3,
                metadata_extra: { key: "val" },
                width: 1024,
                height: 768,
                file_size: 5000,
                created_at: "2024-01-01",
                updated_at: "2024-02-01",
            });
        });
    });

    describe("browseApiImage", () => {
        it("returns null when no browseEditImage", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));
            expect(result.current.browseApiImage).toBeNull();
        });

        it("maps browseEditImage to ApiImage shape", () => {
            const img = makeImage({ id: 7, name: "Browse" });
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));
            act(() => {
                result.current.setBrowseEditImage(img);
            });
            expect(result.current.browseApiImage).not.toBeNull();
            expect(result.current.browseApiImage!.id).toBe(7);
            expect(result.current.browseApiImage!.name).toBe("Browse");
        });
    });

    describe("toggleImageVisibility", () => {
        it("toggles active flag and reloads", async () => {
            const img = makeImage({ id: 10, active: true, version: 2 });
            const catA = makeCategory({ id: 1, images: [img] });
            const deps = makeDeps({ categories: [catA] });
            mockUpdateImage.mockResolvedValue({
                id: 10,
                name: "Test Image",
                thumb: "/thumb/10.jpg",
                tile_sources: "/tiles/10",
                category_id: null,
                copyright: null,
                note: null,
                active: false,
                sort_order: 0,
                version: 3,
                metadata_extra: null,
                width: null,
                height: null,
                file_size: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.toggleImageVisibility(10);
            });

            expect(mockUpdateImage).toHaveBeenCalledWith(10, { active: false }, 2);
            expect(deps.loadCategories).toHaveBeenCalled();
            expect(deps.loadUncategorizedImages).toHaveBeenCalled();
        });

        it("finds image in uncategorized when not in tree", async () => {
            const img = makeImage({ id: 20, active: false, version: 1 });
            const deps = makeDeps({ uncategorizedImages: [img] });
            mockUpdateImage.mockResolvedValue({
                id: 20,
                name: "Test Image",
                thumb: "/thumb/20.jpg",
                tile_sources: "/tiles/20",
                category_id: null,
                copyright: null,
                note: null,
                active: true,
                sort_order: 0,
                version: 2,
                metadata_extra: null,
                width: null,
                height: null,
                file_size: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.toggleImageVisibility(20);
            });

            expect(mockUpdateImage).toHaveBeenCalledWith(20, { active: true }, 1);
        });

        it("sets error snack on failure", async () => {
            const img = makeImage({ id: 30, active: true, version: 1 });
            const deps = makeDeps({ uncategorizedImages: [img] });
            mockUpdateImage.mockRejectedValue(new Error("Network error"));
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.toggleImageVisibility(30);
            });

            expect(deps.setErrorSnack).toHaveBeenCalled();
        });

        it("no-ops if image not found", async () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.toggleImageVisibility(999);
            });

            expect(mockUpdateImage).not.toHaveBeenCalled();
        });
    });

    describe("handleSaveBrowseImage", () => {
        it("saves and reloads categories", async () => {
            const img = makeImage({ id: 50, name: "Browse Image" });
            const deps = makeDeps();
            mockUpdateImage.mockResolvedValue({
                id: 50,
                name: "Updated",
                thumb: "/thumb/50.jpg",
                tile_sources: "/tiles/50",
                category_id: null,
                copyright: null,
                note: null,
                active: true,
                sort_order: 0,
                version: 2,
                metadata_extra: null,
                width: null,
                height: null,
                file_size: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useImageActions(deps));

            act(() => {
                result.current.setBrowseEditImage(img);
            });

            await act(async () => {
                await result.current.handleSaveBrowseImage({ name: "Updated" });
            });

            expect(mockUpdateImage).toHaveBeenCalledWith(50, { name: "Updated" });
            expect(result.current.browseEditImage).toBeNull();
            expect(deps.loadCategories).toHaveBeenCalled();
            expect(deps.loadUncategorizedImages).toHaveBeenCalled();
        });

        it("no-ops when browseEditImage is null", async () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.handleSaveBrowseImage({ name: "Test" });
            });

            expect(mockUpdateImage).not.toHaveBeenCalled();
        });

        it("sets error snack on failure", async () => {
            const img = makeImage({ id: 50 });
            const deps = makeDeps();
            mockUpdateImage.mockRejectedValue(new Error("Save failed"));
            const { result } = renderHook(() => useImageActions(deps));

            act(() => {
                result.current.setBrowseEditImage(img);
            });

            await act(async () => {
                await result.current.handleSaveBrowseImage({ name: "X" });
            });

            expect(deps.setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("handleSaveViewerImage", () => {
        it("saves, updates selectedImage, refreshes path", async () => {
            const img = makeImage({ id: 60, categoryId: 1, version: 2 });
            const catA = makeCategory({ id: 1, label: "Root" });
            const deps = makeDeps({ selectedImage: img });
            mockUpdateImage.mockResolvedValue({
                id: 60,
                name: "Renamed",
                thumb: "/thumb/60.jpg",
                tile_sources: "/tiles/60",
                category_id: 1,
                copyright: null,
                note: null,
                active: true,
                sort_order: 0,
                version: 3,
                metadata_extra: null,
                width: null,
                height: null,
                file_size: null,
                created_at: "",
                updated_at: "",
            });
            vi.mocked(deps.refreshCategories).mockResolvedValue([catA]);
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.handleSaveViewerImage({ name: "Renamed" });
            });

            expect(mockUpdateImage).toHaveBeenCalledWith(60, { name: "Renamed" });
            expect(deps.setSelectedImage).toHaveBeenCalled();
            expect(result.current.imageEditOpen).toBe(false);
            expect(deps.refreshCategories).toHaveBeenCalled();
            expect(deps.setPath).toHaveBeenCalledWith([catA]);
            expect(deps.loadUncategorizedImages).toHaveBeenCalled();
        });

        it("sets empty path when updated image has no category", async () => {
            const img = makeImage({ id: 61, categoryId: null });
            const deps = makeDeps({ selectedImage: img });
            mockUpdateImage.mockResolvedValue({
                id: 61,
                name: "X",
                thumb: "/t.jpg",
                tile_sources: "/t/61",
                category_id: null,
                copyright: null,
                note: null,
                active: true,
                sort_order: 0,
                version: 2,
                metadata_extra: null,
                width: null,
                height: null,
                file_size: null,
                created_at: "",
                updated_at: "",
            });
            vi.mocked(deps.refreshCategories).mockResolvedValue([]);
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.handleSaveViewerImage({ name: "X" });
            });

            expect(deps.setPath).toHaveBeenCalledWith([]);
        });

        it("no-ops when selectedImage is null", async () => {
            const deps = makeDeps({ selectedImage: null });
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.handleSaveViewerImage({ name: "Y" });
            });

            expect(mockUpdateImage).not.toHaveBeenCalled();
        });
    });

    describe("handleReplaceViewerImage", () => {
        it("starts upload and transitions on success", async () => {
            const img = makeImage({ id: 70, version: 3 });
            const deps = makeDeps({ selectedImage: img });
            mockReplaceImage.mockResolvedValue({
                id: 200,
                filename: "new.jpg",
                status: "pending",
                error_message: null,
                progress: 0,
                image_id: 70,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.handleReplaceViewerImage({
                    file: new File([""], "new.jpg"),
                    formData: { name: "New" },
                });
            });

            expect(deps.startReplaceUpload).toHaveBeenCalledWith(
                expect.any(File),
                "viewer",
            );
            // Wait for promise to resolve
            await act(async () => {
                await new Promise((r) => setTimeout(r, 0));
            });
            expect(deps.transitionReplaceToProcessing).toHaveBeenCalledWith(1, 200);
            expect(deps.loadCategories).toHaveBeenCalled();
            expect(deps.loadUncategorizedImages).toHaveBeenCalled();
        });

        it("no-ops when selectedImage is null", async () => {
            const deps = makeDeps({ selectedImage: null });
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.handleReplaceViewerImage({
                    file: new File([""], "x.jpg"),
                    formData: { name: "X" },
                });
            });

            expect(deps.startReplaceUpload).not.toHaveBeenCalled();
        });
    });

    describe("handleReplaceBrowseImage", () => {
        it("starts upload and transitions on success", async () => {
            const img = makeImage({ id: 80 });
            const deps = makeDeps();
            mockReplaceImage.mockResolvedValue({
                id: 300,
                filename: "r.jpg",
                status: "pending",
                error_message: null,
                progress: 0,
                image_id: 80,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useImageActions(deps));

            act(() => {
                result.current.setBrowseEditImage(img);
            });

            await act(async () => {
                await result.current.handleReplaceBrowseImage({
                    file: new File([""], "r.jpg"),
                    formData: { name: "R" },
                });
            });

            expect(deps.startReplaceUpload).toHaveBeenCalledWith(
                expect.any(File),
                "browse",
            );
            await act(async () => {
                await new Promise((r) => setTimeout(r, 0));
            });
            expect(deps.transitionReplaceToProcessing).toHaveBeenCalledWith(1, 300);
        });

        it("no-ops when browseEditImage is null", async () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.handleReplaceBrowseImage({
                    file: new File([""], "x.jpg"),
                    formData: {},
                });
            });

            expect(deps.startReplaceUpload).not.toHaveBeenCalled();
        });
    });

    describe("handleDeleteViewerImage", () => {
        it("deletes image, clears state, and reloads", async () => {
            const img = makeImage({ id: 90 });
            const deps = makeDeps({ selectedImage: img });
            mockDeleteImage.mockResolvedValue(undefined);
            const { result } = renderHook(() => useImageActions(deps));

            act(() => {
                result.current.setImageEditOpen(true);
            });

            await act(async () => {
                await result.current.handleDeleteViewerImage();
            });

            expect(mockDeleteImage).toHaveBeenCalledWith(90);
            expect(result.current.imageEditOpen).toBe(false);
            expect(deps.clearImage).toHaveBeenCalled();
            expect(deps.loadCategories).toHaveBeenCalled();
            expect(deps.loadUncategorizedImages).toHaveBeenCalled();
        });

        it("no-ops when selectedImage is null", async () => {
            const deps = makeDeps({ selectedImage: null });
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.handleDeleteViewerImage();
            });

            expect(mockDeleteImage).not.toHaveBeenCalled();
        });
    });

    describe("handleDeleteBrowseImage", () => {
        it("deletes image, clears browseEditImage, and reloads", async () => {
            const img = makeImage({ id: 95 });
            const deps = makeDeps();
            mockDeleteImage.mockResolvedValue(undefined);
            const { result } = renderHook(() => useImageActions(deps));

            act(() => {
                result.current.setBrowseEditImage(img);
            });

            await act(async () => {
                await result.current.handleDeleteBrowseImage();
            });

            expect(mockDeleteImage).toHaveBeenCalledWith(95);
            expect(result.current.browseEditImage).toBeNull();
            expect(deps.loadCategories).toHaveBeenCalled();
            expect(deps.loadUncategorizedImages).toHaveBeenCalled();
        });

        it("no-ops when browseEditImage is null", async () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useImageActions(deps));

            await act(async () => {
                await result.current.handleDeleteBrowseImage();
            });

            expect(mockDeleteImage).not.toHaveBeenCalled();
        });
    });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCategoryActions } from "../src/useCategoryActions";
import type { UseCategoryActionsDeps } from "../src/useCategoryActions";
import type { Category, ImageItem } from "../src/types";
import * as api from "../src/api";

vi.mock("../src/api", async () => {
    const actual = await vi.importActual<typeof api>("../src/api");
    return {
        ...actual,
        createCategory: vi.fn(),
        deleteCategory: vi.fn(),
        updateCategory: vi.fn(),
        reorderCategories: vi.fn(),
        updateImage: vi.fn(),
    };
});

const mockCreateCategory = vi.mocked(api.createCategory);
const mockDeleteCategory = vi.mocked(api.deleteCategory);
const mockUpdateCategory = vi.mocked(api.updateCategory);
const mockReorderCategories = vi.mocked(api.reorderCategories);
const mockUpdateImage = vi.mocked(api.updateImage);

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

function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
    return {
        id: 100,
        name: "Test Image",
        thumb: "/thumb/100.jpg",
        tileSources: "/tiles/100",
        categoryId: null,
        active: true,
        version: 1,
        ...overrides,
    };
}

function makeDeps(overrides: Partial<UseCategoryActionsDeps> = {}): UseCategoryActionsDeps {
    return {
        categories: [],
        uncategorizedImages: [],
        loadCategories: vi.fn().mockResolvedValue(undefined),
        loadUncategorizedImages: vi.fn(),
        currentCategories: [],
        ancestorProgramIds: [],
        getPathRestriction: vi.fn().mockReturnValue([]),
        path: [],
        setPath: vi.fn(),
        editNameCategory: null,
        setErrorSnack: vi.fn(),
        setMoveSnack: vi.fn(),
        ...overrides,
    };
}

describe("useCategoryActions", () => {
    beforeEach(() => {
        mockCreateCategory.mockReset();
        mockDeleteCategory.mockReset();
        mockUpdateCategory.mockReset();
        mockReorderCategories.mockReset();
        mockUpdateImage.mockReset();
    });

    describe("addCategoryInline", () => {
        it("creates a category and reloads data", async () => {
            const deps = makeDeps();
            mockCreateCategory.mockResolvedValue({
                id: 10,
                label: "New",
                parent_id: null,
                program_ids: [],
                status: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            let returnedId: number | void;
            await act(async () => {
                returnedId = await result.current.addCategoryInline("New", null);
            });

            expect(mockCreateCategory).toHaveBeenCalledWith({
                label: "New",
                parent_id: null,
            });
            expect(returnedId!).toBe(10);
            expect(deps.loadCategories).toHaveBeenCalled();
            expect(deps.loadUncategorizedImages).toHaveBeenCalled();
        });

        it("passes programIds when provided", async () => {
            const deps = makeDeps();
            mockCreateCategory.mockResolvedValue({
                id: 11,
                label: "Prog",
                parent_id: 5,
                program_ids: [1, 2],
                status: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.addCategoryInline("Prog", 5, [1, 2]);
            });

            expect(mockCreateCategory).toHaveBeenCalledWith({
                label: "Prog",
                parent_id: 5,
                program_ids: [1, 2],
            });
        });
    });

    describe("deleteCategoryInline", () => {
        it("deletes a category and reloads data", async () => {
            const deps = makeDeps();
            mockDeleteCategory.mockResolvedValue(undefined);
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.deleteCategoryInline(5);
            });

            expect(mockDeleteCategory).toHaveBeenCalledWith(5);
            expect(deps.loadCategories).toHaveBeenCalled();
            expect(deps.loadUncategorizedImages).toHaveBeenCalled();
        });

        it("clears path segments referencing the deleted category", async () => {
            const catA = makeCategory({ id: 1, label: "A" });
            const catB = makeCategory({ id: 2, label: "B" });
            const deps = makeDeps({ path: [catA, catB] });
            mockDeleteCategory.mockResolvedValue(undefined);
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.deleteCategoryInline(2);
            });

            const setPathCall = (deps.setPath as ReturnType<typeof vi.fn>).mock.calls[0][0];
            // setPath receives an updater function
            const newPath = setPathCall([catA, catB]);
            expect(newPath).toEqual([catA]);
        });

        it("shows error snack on failure", async () => {
            const deps = makeDeps();
            mockDeleteCategory.mockRejectedValue(new Error("fail"));
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.deleteCategoryInline(5);
            });

            expect(deps.setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("editCategoryInline", () => {
        it("updates a category label and reloads", async () => {
            const deps = makeDeps();
            mockUpdateCategory.mockResolvedValue({
                id: 3,
                label: "Renamed",
                parent_id: null,
                program_ids: [],
                status: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.editCategoryInline(3, "Renamed");
            });

            expect(mockUpdateCategory).toHaveBeenCalledWith(3, { label: "Renamed" });
            expect(deps.loadCategories).toHaveBeenCalled();
        });

        it("passes programIds when provided", async () => {
            const deps = makeDeps();
            mockUpdateCategory.mockResolvedValue({
                id: 3,
                label: "Renamed",
                parent_id: null,
                program_ids: [1],
                status: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.editCategoryInline(3, "Renamed", [1]);
            });

            expect(mockUpdateCategory).toHaveBeenCalledWith(3, {
                label: "Renamed",
                program_ids: [1],
            });
        });
    });

    describe("toggleCategoryVisibility", () => {
        it("toggles from active to hidden", async () => {
            const cat = makeCategory({ id: 5, status: "active" });
            const deps = makeDeps({ categories: [cat] });
            mockUpdateCategory.mockResolvedValue({
                id: 5,
                label: "Cat A",
                parent_id: null,
                program_ids: [],
                status: "hidden",
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.toggleCategoryVisibility(5);
            });

            expect(mockUpdateCategory).toHaveBeenCalledWith(5, { status: "hidden" });
            expect(deps.loadCategories).toHaveBeenCalled();
        });

        it("toggles from hidden to active", async () => {
            const cat = makeCategory({ id: 5, status: "hidden" });
            const deps = makeDeps({ categories: [cat] });
            mockUpdateCategory.mockResolvedValue({
                id: 5,
                label: "Cat A",
                parent_id: null,
                program_ids: [],
                status: "active",
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.toggleCategoryVisibility(5);
            });

            expect(mockUpdateCategory).toHaveBeenCalledWith(5, { status: "active" });
        });

        it("shows error snack on failure", async () => {
            const deps = makeDeps({ categories: [makeCategory({ id: 5 })] });
            mockUpdateCategory.mockRejectedValue(new Error("fail"));
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.toggleCategoryVisibility(5);
            });

            expect(deps.setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("reorderCategoriesInline", () => {
        it("calls reorder API and reloads", async () => {
            const deps = makeDeps();
            mockReorderCategories.mockResolvedValue(undefined);
            const items = [{ id: 1, parent_id: null, sort_order: 0 }];
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.reorderCategoriesInline(items);
            });

            expect(mockReorderCategories).toHaveBeenCalledWith(items);
            expect(deps.loadCategories).toHaveBeenCalled();
        });

        it("shows error snack on failure", async () => {
            const deps = makeDeps();
            mockReorderCategories.mockRejectedValue(new Error("fail"));
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.reorderCategoriesInline([]);
            });

            expect(deps.setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("handleMoveCategory", () => {
        it("moves a category and closes dialog", async () => {
            const deps = makeDeps();
            mockUpdateCategory.mockResolvedValue({
                id: 3,
                label: "Cat",
                parent_id: 10,
                program_ids: [],
                status: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            // Open the dialog first
            act(() => {
                result.current.handleRequestMoveCategory(makeCategory({ id: 3 }));
            });
            expect(result.current.moveCatOpen).toBe(true);
            expect(result.current.movingCategory?.id).toBe(3);

            await act(async () => {
                await result.current.handleMoveCategory(3, 10);
            });

            expect(mockUpdateCategory).toHaveBeenCalledWith(3, { parent_id: 10 });
            expect(result.current.moveCatOpen).toBe(false);
            expect(result.current.movingCategory).toBeNull();
            expect(deps.loadCategories).toHaveBeenCalled();
        });

        it("shows error snack on failure", async () => {
            const deps = makeDeps();
            mockUpdateCategory.mockRejectedValue(new Error("fail"));
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleMoveCategory(3, 10);
            });

            expect(deps.setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("handleRequestMoveCategory", () => {
        it("sets movingCategory and opens dialog", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useCategoryActions(deps));
            const cat = makeCategory({ id: 7, label: "Move Me" });

            act(() => {
                result.current.handleRequestMoveCategory(cat);
            });

            expect(result.current.movingCategory).toEqual(cat);
            expect(result.current.moveCatOpen).toBe(true);
        });
    });

    describe("handleDropImageOnCategory", () => {
        it("moves an image to a category with undo snack", async () => {
            const img = makeImage({ id: 100, categoryId: 1, name: "Photo", version: 3 });
            const catA = makeCategory({
                id: 1,
                label: "Source",
                images: [img],
            });
            const catB = makeCategory({ id: 2, label: "Target" });
            const deps = makeDeps({ categories: [catA, catB] });
            mockUpdateImage.mockResolvedValue({
                id: 100,
                name: "Photo",
                thumb: "/thumb/100.jpg",
                tile_sources: "/tiles/100",
                category_id: 2,
                copyright: null,
                note: null,
                active: true,
                version: 4,
                width: null,
                height: null,
                file_size: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropImageOnCategory(100, 2);
            });

            expect(mockUpdateImage).toHaveBeenCalledWith(100, { category_id: 2 }, 3);
            expect(deps.loadCategories).toHaveBeenCalled();
            expect(deps.loadUncategorizedImages).toHaveBeenCalled();
            expect(deps.setMoveSnack).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining("Photo"),
                }),
            );
        });

        it("skips move when image is already in the target category", async () => {
            const img = makeImage({ id: 100, categoryId: 2 });
            const cat = makeCategory({ id: 2, label: "Same", images: [img] });
            const deps = makeDeps({ categories: [cat] });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropImageOnCategory(100, 2);
            });

            expect(mockUpdateImage).not.toHaveBeenCalled();
        });

        it("finds uncategorized images when not in tree", async () => {
            const img = makeImage({ id: 200, categoryId: null, version: 1 });
            const catB = makeCategory({ id: 2, label: "Target" });
            const deps = makeDeps({
                categories: [catB],
                uncategorizedImages: [img],
            });
            mockUpdateImage.mockResolvedValue({
                id: 200,
                name: "Test Image",
                thumb: "/thumb/200.jpg",
                tile_sources: "/tiles/200",
                category_id: 2,
                copyright: null,
                note: null,
                active: true,
                version: 2,
                width: null,
                height: null,
                file_size: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropImageOnCategory(200, 2);
            });

            expect(mockUpdateImage).toHaveBeenCalledWith(200, { category_id: 2 }, 1);
        });

        it("onUndo reverts image to previous category", async () => {
            const img = makeImage({ id: 100, categoryId: 1, name: "Photo", version: 3 });
            const catA = makeCategory({ id: 1, label: "Source", images: [img] });
            const catB = makeCategory({ id: 2, label: "Target" });
            const deps = makeDeps({ categories: [catA, catB] });
            mockUpdateImage.mockResolvedValue({
                id: 100,
                name: "Photo",
                thumb: "/thumb/100.jpg",
                tile_sources: "/tiles/100",
                category_id: 2,
                copyright: null,
                note: null,
                active: true,
                version: 4,
                width: null,
                height: null,
                file_size: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropImageOnCategory(100, 2);
            });

            const snackCall = vi.mocked(deps.setMoveSnack).mock.calls[0][0];
            expect(snackCall).not.toBeNull();
            const onUndo = (snackCall as { message: string; onUndo: () => Promise<void> }).onUndo;

            mockUpdateImage.mockReset();
            mockUpdateImage.mockResolvedValue({
                id: 100,
                name: "Photo",
                thumb: "/thumb/100.jpg",
                tile_sources: "/tiles/100",
                category_id: 1,
                copyright: null,
                note: null,
                active: true,
                version: 5,
                width: null,
                height: null,
                file_size: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });

            await act(async () => {
                await onUndo();
            });

            expect(deps.setMoveSnack).toHaveBeenCalledWith(null);
            expect(mockUpdateImage).toHaveBeenCalledWith(100, { category_id: 1 }, 4);
            expect(deps.loadCategories).toHaveBeenCalledTimes(2);
            expect(deps.loadUncategorizedImages).toHaveBeenCalledTimes(2);
        });

        it("onUndo shows error snack when revert fails", async () => {
            const img = makeImage({ id: 100, categoryId: 1, name: "Photo", version: 3 });
            const catA = makeCategory({ id: 1, label: "Source", images: [img] });
            const catB = makeCategory({ id: 2, label: "Target" });
            const deps = makeDeps({ categories: [catA, catB] });
            mockUpdateImage.mockResolvedValue({
                id: 100,
                name: "Photo",
                thumb: "/thumb/100.jpg",
                tile_sources: "/tiles/100",
                category_id: 2,
                copyright: null,
                note: null,
                active: true,
                version: 4,
                width: null,
                height: null,
                file_size: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropImageOnCategory(100, 2);
            });

            const snackCall = vi.mocked(deps.setMoveSnack).mock.calls[0][0];
            const onUndo = (snackCall as { message: string; onUndo: () => Promise<void> }).onUndo;

            mockUpdateImage.mockReset();
            mockUpdateImage.mockRejectedValue(new Error("conflict"));

            await act(async () => {
                await onUndo();
            });

            expect(deps.setErrorSnack).toHaveBeenCalledWith(
                expect.stringContaining("Failed to undo move"),
            );
        });

        it("shows error snack on failure", async () => {
            const img = makeImage({ id: 100, categoryId: 1 });
            const cat = makeCategory({ id: 1, images: [img] });
            const deps = makeDeps({ categories: [cat] });
            mockUpdateImage.mockRejectedValue(new Error("fail"));
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropImageOnCategory(100, 2);
            });

            expect(deps.setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("handleDropCategoryOnCategory", () => {
        it("moves a category into another with undo snack", async () => {
            const child = makeCategory({ id: 3, label: "Child" });
            const catA = makeCategory({ id: 1, label: "Parent", children: [child] });
            const catB = makeCategory({ id: 2, label: "New Parent" });
            const deps = makeDeps({ categories: [catA, catB] });
            mockUpdateCategory.mockResolvedValue({
                id: 3,
                label: "Child",
                parent_id: 2,
                program_ids: [],
                status: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropCategoryOnCategory(3, 2);
            });

            expect(mockUpdateCategory).toHaveBeenCalledWith(3, { parent_id: 2 });
            expect(deps.loadCategories).toHaveBeenCalled();
            expect(deps.setMoveSnack).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining("Child"),
                }),
            );
        });

        it("onUndo reverts category to previous parent", async () => {
            const child = makeCategory({ id: 3, label: "Child" });
            const catA = makeCategory({ id: 1, label: "Parent", children: [child] });
            const catB = makeCategory({ id: 2, label: "New Parent" });
            const deps = makeDeps({ categories: [catA, catB] });
            mockUpdateCategory.mockResolvedValue({
                id: 3,
                label: "Child",
                parent_id: 2,
                program_ids: [],
                status: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropCategoryOnCategory(3, 2);
            });

            const snackCall = vi.mocked(deps.setMoveSnack).mock.calls[0][0];
            expect(snackCall).not.toBeNull();
            const onUndo = (snackCall as { message: string; onUndo: () => Promise<void> }).onUndo;

            mockUpdateCategory.mockReset();
            mockUpdateCategory.mockResolvedValue({
                id: 3,
                label: "Child",
                parent_id: 1,
                program_ids: [],
                status: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });

            await act(async () => {
                await onUndo();
            });

            expect(deps.setMoveSnack).toHaveBeenCalledWith(null);
            expect(mockUpdateCategory).toHaveBeenCalledWith(3, { parent_id: 1 });
            expect(deps.loadCategories).toHaveBeenCalledTimes(2);
        });

        it("onUndo shows error snack when revert fails", async () => {
            const child = makeCategory({ id: 3, label: "Child" });
            const catA = makeCategory({ id: 1, label: "Parent", children: [child] });
            const catB = makeCategory({ id: 2, label: "New Parent" });
            const deps = makeDeps({ categories: [catA, catB] });
            mockUpdateCategory.mockResolvedValue({
                id: 3,
                label: "Child",
                parent_id: 2,
                program_ids: [],
                status: null,
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropCategoryOnCategory(3, 2);
            });

            const snackCall = vi.mocked(deps.setMoveSnack).mock.calls[0][0];
            const onUndo = (snackCall as { message: string; onUndo: () => Promise<void> }).onUndo;

            mockUpdateCategory.mockReset();
            mockUpdateCategory.mockRejectedValue(new Error("network error"));

            await act(async () => {
                await onUndo();
            });

            expect(deps.setErrorSnack).toHaveBeenCalledWith(
                expect.stringContaining("Failed to undo move"),
            );
        });

        it("shows error snack on failure", async () => {
            const deps = makeDeps({ categories: [makeCategory({ id: 1 })] });
            mockUpdateCategory.mockRejectedValue(new Error("fail"));
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleDropCategoryOnCategory(1, 2);
            });

            expect(deps.setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("handleSetCardImage", () => {
        it("sets a card image on a category", async () => {
            const cat = makeCategory({ id: 5, metadataExtra: { foo: "bar" } });
            const deps = makeDeps({ categories: [cat] });
            mockUpdateCategory.mockResolvedValue({
                id: 5,
                label: "Cat A",
                parent_id: null,
                program_ids: [],
                status: null,
                metadata_extra: { foo: "bar", card_image_id: 42 },
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleSetCardImage(5, 42);
            });

            expect(mockUpdateCategory).toHaveBeenCalledWith(5, {
                metadata_extra: { foo: "bar", card_image_id: 42 },
            });
            expect(deps.loadCategories).toHaveBeenCalled();
        });

        it("clears card image by passing null", async () => {
            const cat = makeCategory({ id: 5, metadataExtra: { card_image_id: 42 } });
            const deps = makeDeps({ categories: [cat] });
            mockUpdateCategory.mockResolvedValue({
                id: 5,
                label: "Cat A",
                parent_id: null,
                program_ids: [],
                status: null,
                metadata_extra: { card_image_id: null },
                created_at: "",
                updated_at: "",
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleSetCardImage(5, null);
            });

            expect(mockUpdateCategory).toHaveBeenCalledWith(5, {
                metadata_extra: { card_image_id: null },
            });
        });

        it("shows error snack on failure", async () => {
            const deps = makeDeps({ categories: [makeCategory({ id: 5 })] });
            mockUpdateCategory.mockRejectedValue(new Error("fail"));
            const { result } = renderHook(() => useCategoryActions(deps));

            await act(async () => {
                await result.current.handleSetCardImage(5, 42);
            });

            expect(deps.setErrorSnack).toHaveBeenCalled();
        });
    });

    describe("editCategoryContext", () => {
        it("returns fallback when editNameCategory is null", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useCategoryActions(deps));

            expect(result.current.editCategoryContext).toEqual({
                siblingNames: [],
                inheritedProgramIds: [],
                freshLabel: "",
                freshProgramIds: [],
            });
        });

        it("returns sibling info for a breadcrumb category", () => {
            const catA = makeCategory({ id: 1, label: "A", programIds: [10] });
            const catB = makeCategory({ id: 2, label: "B", programIds: [20] });
            const deps = makeDeps({
                categories: [catA, catB],
                path: [catA],
                editNameCategory: catA,
                getPathRestriction: vi.fn().mockReturnValue([10]),
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            expect(result.current.editCategoryContext.siblingNames).toEqual(["B"]);
            expect(result.current.editCategoryContext.freshLabel).toBe("A");
        });

        it("returns sibling info for a child category", () => {
            const child1 = makeCategory({ id: 10, label: "C1" });
            const child2 = makeCategory({ id: 11, label: "C2" });
            const deps = makeDeps({
                currentCategories: [child1, child2],
                editNameCategory: child1,
                ancestorProgramIds: [5],
            });
            const { result } = renderHook(() => useCategoryActions(deps));

            expect(result.current.editCategoryContext.siblingNames).toEqual(["C2"]);
            expect(result.current.editCategoryContext.inheritedProgramIds).toEqual([5]);
            expect(result.current.editCategoryContext.freshLabel).toBe("C1");
        });
    });
});

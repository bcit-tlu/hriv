/**
 * Unit tests for SortableTileGrid component, buildTileItems utility,
 * DroppableCategoryZone rendering, and handleDragEnd behaviour.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { buildTileItems } from "../../src/components/sortableTileGridUtils";
import { DROP_PREFIX } from "../../src/components/sortableTileGridUtils";
import SortableTileGrid from "../../src/components/SortableTileGrid";
import type { SortableTileGridProps } from "../../src/components/SortableTileGrid";
import type { Program } from "../../src/types";
import { makeCategory, makeImage } from "../helpers/fixtures";

// ---------------------------------------------------------------------------
// Capture onDragEnd from DndContext so we can invoke it in tests.
// We wrap the real DndContext and intercept the handler.
// ---------------------------------------------------------------------------

import type { DragEndEvent } from "@dnd-kit/core";

let capturedOnDragEnd: ((event: DragEndEvent) => void) | undefined;

vi.mock("@dnd-kit/core", async () => {
    const actual =
        await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
    return {
        ...actual,
        DndContext: (props: Record<string, unknown>) => {
            capturedOnDragEnd = props.onDragEnd as
                | ((event: DragEndEvent) => void)
                | undefined;
            const ActualDndContext = actual.DndContext as React.ComponentType<
                Record<string, unknown>
            >;
            return <ActualDndContext {...props} />;
        },
    };
});

// Mock only the reorder API calls; passthrough all other exports so future
// api.ts additions don't require updating this mock.
import * as apiModule from "../../src/api";

vi.mock("../../src/api", async () => {
    const actual =
        await vi.importActual<typeof apiModule>("../../src/api");
    return {
        ...actual,
        reorderCategories: vi.fn(() => Promise.resolve()),
        reorderImages: vi.fn(() => Promise.resolve()),
    };
});

import { reorderCategories, reorderImages } from "../../src/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultPrograms: Program[] = [];

function renderGrid(overrides: Partial<SortableTileGridProps> = {}) {
    const defaults: SortableTileGridProps = {
        allCategories: [],
        currentCategories: [],
        currentImages: [],
        uncategorizedImages: [],
        path: [],
        canEditContent: true,
        fileDragActive: false,
        programs: defaultPrograms,
        onCategoryClick: vi.fn(),
        onImageClick: vi.fn(),
        onFilesDrop: vi.fn(),
        onDropImageOnCategory: vi.fn(),
        onReorderComplete: vi.fn(),
        onReorderError: vi.fn(),
    };
    const props = { ...defaults, ...overrides };
    return { ...render(<SortableTileGrid {...props} />), props };
}

// ---------------------------------------------------------------------------
// buildTileItems
// ---------------------------------------------------------------------------

describe("buildTileItems", () => {
    it("returns empty array for no categories or images", () => {
        expect(buildTileItems([], [])).toEqual([]);
    });

    it("returns categories only when no images", () => {
        const cats = [makeCategory({ id: 1, sortOrder: 0 })];
        const result = buildTileItems(cats, []);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("category");
        expect(result[0].data.id).toBe(1);
    });

    it("returns images only when no categories", () => {
        const imgs = [makeImage({ id: 10, sortOrder: 0 })];
        const result = buildTileItems([], imgs);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("image");
        expect(result[0].data.id).toBe(10);
    });

    it("interleaves categories and images sorted by sortOrder", () => {
        const cats = [
            makeCategory({ id: 1, sortOrder: 0 }),
            makeCategory({ id: 2, sortOrder: 2 }),
        ];
        const imgs = [
            makeImage({ id: 10, sortOrder: 1 }),
            makeImage({ id: 11, sortOrder: 3 }),
        ];
        const result = buildTileItems(cats, imgs);
        expect(result.map((r) => r.data.id)).toEqual([1, 10, 2, 11]);
        expect(result.map((r) => r.type)).toEqual([
            "category",
            "image",
            "category",
            "image",
        ]);
    });

    it("handles duplicate sortOrder values deterministically", () => {
        const cats = [makeCategory({ id: 1, sortOrder: 0 })];
        const imgs = [makeImage({ id: 10, sortOrder: 0 })];
        const result = buildTileItems(cats, imgs);
        expect(result).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// SortableTileGrid rendering
// ---------------------------------------------------------------------------

describe("SortableTileGrid", () => {
    it("renders category and image tiles", () => {
        const cat = makeCategory({
            id: 1,
            label: "Architecture",
            sortOrder: 0,
        });
        const img = makeImage({
            id: 10,
            name: "Liver Section",
            sortOrder: 1,
        });

        render(
            <SortableTileGrid
                allCategories={[]}
                currentCategories={[cat]}
                currentImages={[img]}
                uncategorizedImages={[]}
                path={[]}
                canEditContent={false}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        expect(screen.getByText("Architecture")).toBeInTheDocument();
        expect(screen.getByText("Liver Section")).toBeInTheDocument();
    });

    it("includes uncategorized images at root level", () => {
        const uncat = makeImage({
            id: 20,
            name: "Uncategorized Img",
            sortOrder: 0,
        });

        render(
            <SortableTileGrid
                allCategories={[]}
                currentCategories={[]}
                currentImages={[]}
                uncategorizedImages={[uncat]}
                path={[]}
                canEditContent={false}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        expect(screen.getByText("Uncategorized Img")).toBeInTheDocument();
    });

    it("excludes uncategorized images when not at root", () => {
        const parentCat = makeCategory({ id: 1, label: "Parent" });
        const uncat = makeImage({
            id: 20,
            name: "Uncategorized Img",
            sortOrder: 0,
        });

        render(
            <SortableTileGrid
                allCategories={[]}
                currentCategories={[]}
                currentImages={[]}
                uncategorizedImages={[uncat]}
                path={[parentCat]}
                canEditContent={false}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        expect(
            screen.queryByText("Uncategorized Img"),
        ).not.toBeInTheDocument();
    });

    it("enables sortable drag for editors", () => {
        const cat = makeCategory({
            id: 1,
            label: "Architecture",
            sortOrder: 0,
        });

        render(
            <SortableTileGrid
                allCategories={[]}
                currentCategories={[cat]}
                currentImages={[]}
                uncategorizedImages={[]}
                path={[]}
                canEditContent={true}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        const sortableItems = screen.queryAllByRole("button");
        const sortableItem = sortableItems.find(
            (el) => el.getAttribute("aria-roledescription") === "sortable",
        );
        expect(sortableItem).toBeDefined();
        expect(sortableItem).not.toHaveAttribute("aria-disabled", "true");
    });

    it("disables sortable drag for non-editors", () => {
        const cat = makeCategory({
            id: 1,
            label: "Architecture",
            sortOrder: 0,
        });

        render(
            <SortableTileGrid
                allCategories={[]}
                currentCategories={[cat]}
                currentImages={[]}
                uncategorizedImages={[]}
                path={[]}
                canEditContent={false}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        const sortableItems = screen.queryAllByRole("button");
        const sortableWrapper = sortableItems.find(
            (el) => el.getAttribute("aria-roledescription") === "sortable",
        );
        expect(sortableWrapper).toBeDefined();
        expect(sortableWrapper).toHaveAttribute("aria-disabled", "true");
    });

    it("renders FileDropZone for editors when drag active", () => {
        render(
            <SortableTileGrid
                allCategories={[]}
                currentCategories={[]}
                currentImages={[]}
                uncategorizedImages={[]}
                path={[]}
                canEditContent={true}
                fileDragActive={true}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        expect(
            screen.getByText(/drop files here/i),
        ).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// DroppableCategoryZone rendering
// ---------------------------------------------------------------------------

describe("DroppableCategoryZone (via SortableTileGrid)", () => {
    it("renders droppable regions with accessible labels for editors", () => {
        const cat = makeCategory({
            id: 5,
            label: "Histology",
            sortOrder: 0,
        });

        renderGrid({ currentCategories: [cat], canEditContent: true });

        const dropRegions = screen.getAllByRole("region", {
            name: "Move into category",
        });
        expect(dropRegions.length).toBeGreaterThanOrEqual(1);
    });

    it("does not show move overlay text when not hovering", () => {
        const cat = makeCategory({
            id: 5,
            label: "Histology",
            sortOrder: 0,
        });

        renderGrid({ currentCategories: [cat], canEditContent: true });

        expect(screen.queryByText("Move here")).not.toBeInTheDocument();
    });

    it("wraps each category tile in a droppable zone for editors", () => {
        const cats = [
            makeCategory({ id: 1, label: "Cat A", sortOrder: 0 }),
            makeCategory({ id: 2, label: "Cat B", sortOrder: 1 }),
        ];

        renderGrid({ currentCategories: cats, canEditContent: true });

        const dropRegions = screen.getAllByRole("region", {
            name: "Move into category",
        });
        expect(dropRegions).toHaveLength(2);
    });

    it("renders droppable zones even for non-editors (disabled state)", () => {
        const cat = makeCategory({
            id: 1,
            label: "Cat A",
            sortOrder: 0,
        });

        renderGrid({ currentCategories: [cat], canEditContent: false });

        const dropRegions = screen.getAllByRole("region", {
            name: "Move into category",
        });
        expect(dropRegions).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// handleDragEnd — move into category
// ---------------------------------------------------------------------------

describe("handleDragEnd — move into category", () => {
    beforeEach(() => {
        capturedOnDragEnd = undefined;
        vi.mocked(reorderCategories).mockReset().mockResolvedValue();
        vi.mocked(reorderImages).mockReset().mockResolvedValue();
    });

    it("calls onDropImageOnCategory when image is dropped on a droppable zone", async () => {
        const cat = makeCategory({ id: 5, label: "Target", sortOrder: 0 });
        const img = makeImage({ id: 42, name: "Slide A", sortOrder: 1 });
        const onDropImageOnCategory = vi.fn();

        renderGrid({
            currentCategories: [cat],
            currentImages: [img],
            canEditContent: true,
            onDropImageOnCategory,
        });

        expect(capturedOnDragEnd).toBeDefined();

        // handleDragEnd is async — await its promise so act() flushes all
        // microtasks (API mocks resolve synchronously via Promise.resolve()).
        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "img-42" },
                over: { id: `${DROP_PREFIX}5` },
            } as unknown as DragEndEvent);
        });

        expect(onDropImageOnCategory).toHaveBeenCalledWith(42, 5);
    });

    it("calls onDropCategoryOnCategory when category is dropped on a droppable zone", async () => {
        const cat1 = makeCategory({ id: 1, label: "Cat A", sortOrder: 0 });
        const cat2 = makeCategory({ id: 2, label: "Cat B", sortOrder: 1 });
        const onDropImageOnCategory = vi.fn();
        const onDropCategoryOnCategory = vi.fn();

        renderGrid({
            currentCategories: [cat1, cat2],
            canEditContent: true,
            onDropImageOnCategory,
            onDropCategoryOnCategory,
        });

        expect(capturedOnDragEnd).toBeDefined();

        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "cat-1" },
                over: { id: `${DROP_PREFIX}2` },
            } as unknown as DragEndEvent);
        });

        expect(onDropCategoryOnCategory).toHaveBeenCalledWith(1, 2);
        expect(onDropImageOnCategory).not.toHaveBeenCalled();
    });

    it("does nothing when dropped on self", async () => {
        const img = makeImage({ id: 10, name: "Slide", sortOrder: 0 });
        const onDropImageOnCategory = vi.fn();

        renderGrid({
            currentImages: [img],
            canEditContent: true,
            onDropImageOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "img-10" },
                over: { id: "img-10" },
            } as unknown as DragEndEvent);
        });

        expect(onDropImageOnCategory).not.toHaveBeenCalled();
    });

    it("does nothing when over is null", async () => {
        const img = makeImage({ id: 10, name: "Slide", sortOrder: 0 });
        const onDropImageOnCategory = vi.fn();

        renderGrid({
            currentImages: [img],
            canEditContent: true,
            onDropImageOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "img-10" },
                over: null,
            } as unknown as DragEndEvent);
        });

        expect(onDropImageOnCategory).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// handleDragEnd — reorder
// ---------------------------------------------------------------------------

describe("handleDragEnd — reorder", () => {
    beforeEach(() => {
        capturedOnDragEnd = undefined;
        vi.mocked(reorderCategories).mockReset().mockResolvedValue();
        vi.mocked(reorderImages).mockReset().mockResolvedValue();
    });

    it("calls reorderCategories and reorderImages when items are reordered", async () => {
        const cat = makeCategory({ id: 1, label: "Cat A", sortOrder: 0 });
        const img = makeImage({ id: 10, name: "Slide", sortOrder: 1 });
        const onReorderComplete = vi.fn();

        renderGrid({
            currentCategories: [cat],
            currentImages: [img],
            canEditContent: true,
            onReorderComplete,
        });

        // Swap: move img-10 before cat-1
        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "img-10" },
                over: { id: "cat-1" },
            } as unknown as DragEndEvent);
        });

        expect(reorderImages).toHaveBeenCalledWith([
            { id: 10, sort_order: 0 },
        ]);
        expect(reorderCategories).toHaveBeenCalledWith([
            { id: 1, parent_id: null, sort_order: 1 },
        ]);
        expect(onReorderComplete).toHaveBeenCalled();
    });

    it("uses parent_id from path for nested category reorder", async () => {
        const parent = makeCategory({ id: 99, label: "Parent", sortOrder: 0 });
        const cat1 = makeCategory({ id: 1, label: "Child A", sortOrder: 0 });
        const cat2 = makeCategory({ id: 2, label: "Child B", sortOrder: 1 });

        renderGrid({
            currentCategories: [cat1, cat2],
            path: [parent],
            canEditContent: true,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "cat-2" },
                over: { id: "cat-1" },
            } as unknown as DragEndEvent);
        });

        expect(reorderCategories).toHaveBeenCalledWith([
            { id: 2, parent_id: 99, sort_order: 0 },
            { id: 1, parent_id: 99, sort_order: 1 },
        ]);
    });

    it("calls onReorderError and rolls back on API failure", async () => {
        const apiError = new Error("Network error");
        vi.mocked(reorderImages).mockRejectedValueOnce(apiError);

        const cat = makeCategory({ id: 1, label: "Cat", sortOrder: 0 });
        const img = makeImage({ id: 10, name: "Img", sortOrder: 1 });
        const onReorderError = vi.fn();
        const onReorderComplete = vi.fn();

        renderGrid({
            currentCategories: [cat],
            currentImages: [img],
            canEditContent: true,
            onReorderError,
            onReorderComplete,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "img-10" },
                over: { id: "cat-1" },
            } as unknown as DragEndEvent);
        });

        expect(onReorderError).toHaveBeenCalled();
        // onReorderComplete is called even on error (to trigger server refresh)
        expect(onReorderComplete).toHaveBeenCalled();
    });

    it("calls only reorderCategories when no images are present", async () => {
        const cat1 = makeCategory({ id: 1, label: "A", sortOrder: 0 });
        const cat2 = makeCategory({ id: 2, label: "B", sortOrder: 1 });

        renderGrid({
            currentCategories: [cat1, cat2],
            canEditContent: true,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "cat-2" },
                over: { id: "cat-1" },
            } as unknown as DragEndEvent);
        });

        expect(reorderCategories).toHaveBeenCalled();
        expect(reorderImages).not.toHaveBeenCalled();
    });

    it("calls only reorderImages when no categories are present", async () => {
        const img1 = makeImage({ id: 10, name: "A", sortOrder: 0 });
        const img2 = makeImage({ id: 11, name: "B", sortOrder: 1 });

        renderGrid({
            currentImages: [img1, img2],
            canEditContent: true,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "img-11" },
                over: { id: "img-10" },
            } as unknown as DragEndEvent);
        });

        expect(reorderImages).toHaveBeenCalled();
        expect(reorderCategories).not.toHaveBeenCalled();
    });

    it("reports partial failure when one API call rejects (Promise.allSettled)", async () => {
        vi.mocked(reorderCategories).mockRejectedValueOnce(
            new Error("Cat reorder failed"),
        );

        const cat = makeCategory({ id: 1, label: "Cat", sortOrder: 0 });
        const img = makeImage({ id: 10, name: "Img", sortOrder: 1 });
        const onReorderError = vi.fn();

        renderGrid({
            currentCategories: [cat],
            currentImages: [img],
            canEditContent: true,
            onReorderError,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                active: { id: "img-10" },
                over: { id: "cat-1" },
            } as unknown as DragEndEvent);
        });

        expect(onReorderError).toHaveBeenCalled();
    });
});

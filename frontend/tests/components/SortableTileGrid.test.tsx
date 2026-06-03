import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SortableTileGrid from "../../src/components/SortableTileGrid";
import type { SortableTileGridProps } from "../../src/components/SortableTileGrid";
import type { Program } from "../../src/types";
import {
    DROP_PREFIX,
    REORDER_END_ID,
    REORDER_PREFIX,
} from "../../src/components/sortableTileGridUtils";
import { makeCategory, makeImage } from "../helpers/fixtures";

// Capture onDragEnd from DragDropProvider for direct invocation.
type DragEndHandler = (event: {
    operation: {
        source: { id: string | number } | null;
        target: { id: string | number } | null;
        canceled: boolean;
    };
}) => void;

let capturedOnDragEnd: DragEndHandler | undefined;

vi.mock("@dnd-kit/react", async () => {
    const actual =
        await vi.importActual<typeof import("@dnd-kit/react")>(
            "@dnd-kit/react",
        );
    return {
        ...actual,
        DragDropProvider: (props: Record<string, unknown>) => {
            capturedOnDragEnd = props.onDragEnd as DragEndHandler | undefined;
            const ActualProvider =
                actual.DragDropProvider as React.ComponentType<
                    Record<string, unknown>
                >;
            return <ActualProvider {...props} />;
        },
    };
});

import * as apiModule from "../../src/api";

vi.mock("../../src/api", async () => {
    const actual = await vi.importActual<typeof apiModule>("../../src/api");
    return {
        ...actual,
        reorderCategories: vi.fn(() => Promise.resolve()),
        reorderImages: vi.fn(() => Promise.resolve()),
    };
});

import { reorderCategories, reorderImages } from "../../src/api";

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

describe("SortableTileGrid", () => {
    beforeEach(() => {
        capturedOnDragEnd = undefined;
        vi.mocked(reorderCategories).mockReset().mockResolvedValue();
        vi.mocked(reorderImages).mockReset().mockResolvedValue();
    });

    it("renders category and image tiles", () => {
        renderGrid({
            currentCategories: [
                makeCategory({ id: 1, label: "Architecture", sortOrder: 0 }),
            ],
            currentImages: [
                makeImage({ id: 10, name: "Liver Section", sortOrder: 1 }),
            ],
            canEditContent: false,
        });

        expect(screen.getByText("Architecture")).toBeInTheDocument();
        expect(screen.getByText("Liver Section")).toBeInTheDocument();
    });

    it("renders category move zones and reorder gaps", () => {
        renderGrid({
            currentCategories: [
                makeCategory({ id: 1, label: "Cat A", sortOrder: 0 }),
                makeCategory({ id: 2, label: "Cat B", sortOrder: 1 }),
            ],
        });

        expect(
            screen.getAllByRole("region", { name: "Move into category" }),
        ).toHaveLength(2);
    });

    it("moves image into category when dropped on category body target", async () => {
        const onDropImageOnCategory = vi.fn();
        renderGrid({
            currentCategories: [
                makeCategory({ id: 5, label: "Target", sortOrder: 0 }),
            ],
            currentImages: [
                makeImage({ id: 42, name: "Slide A", sortOrder: 1 }),
            ],
            onDropImageOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-42" },
                    target: { id: `${DROP_PREFIX}5` },
                    canceled: false,
                },
            });
        });

        expect(onDropImageOnCategory).toHaveBeenCalledWith(42, 5);
    });

    it("does nothing when dropped on image tile body id", async () => {
        renderGrid({
            currentImages: [
                makeImage({ id: 10, name: "A", sortOrder: 0 }),
                makeImage({ id: 11, name: "B", sortOrder: 1 }),
            ],
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-11" },
                    target: { id: "img-10" },
                    canceled: false,
                },
            });
        });

        expect(reorderImages).not.toHaveBeenCalled();
        expect(reorderCategories).not.toHaveBeenCalled();
    });

    it("reorders using explicit gap target ids", async () => {
        renderGrid({
            currentCategories: [
                makeCategory({ id: 1, label: "Cat", sortOrder: 0 }),
            ],
            currentImages: [makeImage({ id: 10, name: "Img", sortOrder: 1 })],
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-10" },
                    target: { id: `${REORDER_PREFIX}cat-1` },
                    canceled: false,
                },
            });
        });

        expect(reorderImages).toHaveBeenCalledWith([{ id: 10, sort_order: 0 }]);
        expect(reorderCategories).toHaveBeenCalledWith([
            { id: 1, parent_id: null, sort_order: 1 },
        ]);
    });

    it("reorders to end using reorder-end target", async () => {
        renderGrid({
            currentImages: [
                makeImage({ id: 10, name: "A", sortOrder: 0 }),
                makeImage({ id: 11, name: "B", sortOrder: 1 }),
            ],
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-10" },
                    target: { id: REORDER_END_ID },
                    canceled: false,
                },
            });
        });

        expect(reorderImages).toHaveBeenCalledWith([
            { id: 11, sort_order: 0 },
            { id: 10, sort_order: 1 },
        ]);
    });

    it("calls onReorderError when a reorder API call fails", async () => {
        vi.mocked(reorderImages).mockRejectedValueOnce(
            new Error("Network error"),
        );
        const onReorderError = vi.fn();

        renderGrid({
            currentCategories: [makeCategory({ id: 1, sortOrder: 0 })],
            currentImages: [makeImage({ id: 10, sortOrder: 1 })],
            onReorderError,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-10" },
                    target: { id: `${REORDER_PREFIX}cat-1` },
                    canceled: false,
                },
            });
        });

        expect(onReorderError).toHaveBeenCalled();
    });
});

describe("DroppableCategoryZone (rendering + accept)", () => {
    beforeEach(() => {
        capturedOnDragEnd = undefined;
        vi.mocked(reorderCategories).mockReset().mockResolvedValue();
        vi.mocked(reorderImages).mockReset().mockResolvedValue();
    });

    it("does not show move overlay text when not hovering", () => {
        renderGrid({
            currentCategories: [
                makeCategory({ id: 5, label: "Histology", sortOrder: 0 }),
            ],
        });

        expect(screen.queryByText("Move here")).not.toBeInTheDocument();
    });

    it("renders droppable zones even for non-editors (disabled state)", () => {
        renderGrid({
            currentCategories: [
                makeCategory({ id: 1, label: "Cat A", sortOrder: 0 }),
            ],
            canEditContent: false,
        });

        expect(
            screen.getAllByRole("region", { name: "Move into category" }),
        ).toHaveLength(1);
    });

    it("allows sibling category drops (per-source blocking, not global union)", async () => {
        const catA = makeCategory({ id: 1, label: "Cat A", sortOrder: 0 });
        const catB = makeCategory({ id: 2, label: "Cat B", sortOrder: 1 });
        const onDropCategoryOnCategory = vi.fn();

        renderGrid({
            allCategories: [catA, catB],
            currentCategories: [catA, catB],
            onDropCategoryOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "cat-1" },
                    target: { id: `${DROP_PREFIX}2` },
                    canceled: false,
                },
            });
        });

        expect(onDropCategoryOnCategory).toHaveBeenCalledWith(1, 2);
    });

    it("renders a move zone for both parent and child (ancestor-cycle map)", () => {
        const childB = makeCategory({ id: 2, label: "Child B", sortOrder: 0 });
        const parentA = makeCategory({
            id: 1,
            label: "Parent A",
            sortOrder: 0,
            children: [childB],
        });

        renderGrid({
            allCategories: [parentA],
            currentCategories: [parentA, childB],
        });

        expect(
            screen.getAllByRole("region", { name: "Move into category" }),
        ).toHaveLength(2);
    });
});

describe("handleDragEnd — move guards", () => {
    beforeEach(() => {
        capturedOnDragEnd = undefined;
        vi.mocked(reorderCategories).mockReset().mockResolvedValue();
        vi.mocked(reorderImages).mockReset().mockResolvedValue();
    });

    it("calls onDropCategoryOnCategory (not image) when category dropped on zone", async () => {
        const onDropImageOnCategory = vi.fn();
        const onDropCategoryOnCategory = vi.fn();
        renderGrid({
            currentCategories: [
                makeCategory({ id: 1, label: "Cat A", sortOrder: 0 }),
                makeCategory({ id: 2, label: "Cat B", sortOrder: 1 }),
            ],
            onDropImageOnCategory,
            onDropCategoryOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "cat-1" },
                    target: { id: `${DROP_PREFIX}2` },
                    canceled: false,
                },
            });
        });

        expect(onDropCategoryOnCategory).toHaveBeenCalledWith(1, 2);
        expect(onDropImageOnCategory).not.toHaveBeenCalled();
    });

    it("does nothing when source and target are the same tile", async () => {
        const onDropImageOnCategory = vi.fn();
        renderGrid({
            currentImages: [makeImage({ id: 10, name: "Slide", sortOrder: 0 })],
            onDropImageOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-10" },
                    target: { id: "img-10" },
                    canceled: false,
                },
            });
        });

        expect(onDropImageOnCategory).not.toHaveBeenCalled();
        expect(reorderImages).not.toHaveBeenCalled();
    });

    it("does nothing when target is null", async () => {
        const onDropImageOnCategory = vi.fn();
        renderGrid({
            currentImages: [makeImage({ id: 10, name: "Slide", sortOrder: 0 })],
            onDropImageOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-10" },
                    target: null,
                    canceled: false,
                },
            });
        });

        expect(onDropImageOnCategory).not.toHaveBeenCalled();
    });

    it("does nothing when the drag is canceled", async () => {
        const onDropImageOnCategory = vi.fn();
        renderGrid({
            currentCategories: [makeCategory({ id: 5, sortOrder: 0 })],
            currentImages: [makeImage({ id: 10, name: "Slide", sortOrder: 1 })],
            onDropImageOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-10" },
                    target: { id: `${DROP_PREFIX}5` },
                    canceled: true,
                },
            });
        });

        expect(onDropImageOnCategory).not.toHaveBeenCalled();
    });
});

describe("handleDragEnd — reorder branches", () => {
    beforeEach(() => {
        capturedOnDragEnd = undefined;
        vi.mocked(reorderCategories).mockReset().mockResolvedValue();
        vi.mocked(reorderImages).mockReset().mockResolvedValue();
    });

    it("uses parent_id from path for nested category reorder", async () => {
        const parent = makeCategory({ id: 99, label: "Parent", sortOrder: 0 });

        renderGrid({
            currentCategories: [
                makeCategory({ id: 1, label: "Child A", sortOrder: 0 }),
                makeCategory({ id: 2, label: "Child B", sortOrder: 1 }),
            ],
            path: [parent],
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "cat-2" },
                    target: { id: `${REORDER_PREFIX}cat-1` },
                    canceled: false,
                },
            });
        });

        expect(reorderCategories).toHaveBeenCalledWith([
            { id: 2, parent_id: 99, sort_order: 0 },
            { id: 1, parent_id: 99, sort_order: 1 },
        ]);
        expect(reorderImages).not.toHaveBeenCalled();
    });

    it("calls only reorderImages when no categories are present", async () => {
        renderGrid({
            currentImages: [
                makeImage({ id: 10, name: "A", sortOrder: 0 }),
                makeImage({ id: 11, name: "B", sortOrder: 1 }),
            ],
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-11" },
                    target: { id: `${REORDER_PREFIX}img-10` },
                    canceled: false,
                },
            });
        });

        expect(reorderImages).toHaveBeenCalled();
        expect(reorderCategories).not.toHaveBeenCalled();
    });

    it("reports partial failure when one API call rejects (Promise.allSettled)", async () => {
        vi.mocked(reorderCategories).mockRejectedValueOnce(
            new Error("Cat reorder failed"),
        );
        const onReorderError = vi.fn();

        renderGrid({
            currentCategories: [makeCategory({ id: 1, sortOrder: 0 })],
            currentImages: [makeImage({ id: 10, sortOrder: 1 })],
            onReorderError,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-10" },
                    target: { id: `${REORDER_PREFIX}cat-1` },
                    canceled: false,
                },
            });
        });

        expect(onReorderError).toHaveBeenCalled();
    });

    it("still calls onReorderComplete (server refresh) on reorder failure", async () => {
        vi.mocked(reorderImages).mockRejectedValueOnce(
            new Error("Network error"),
        );
        const onReorderComplete = vi.fn();
        const onReorderError = vi.fn();

        renderGrid({
            currentCategories: [makeCategory({ id: 1, sortOrder: 0 })],
            currentImages: [makeImage({ id: 10, sortOrder: 1 })],
            onReorderComplete,
            onReorderError,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-10" },
                    target: { id: `${REORDER_PREFIX}cat-1` },
                    canceled: false,
                },
            });
        });

        expect(onReorderError).toHaveBeenCalled();
        expect(onReorderComplete).toHaveBeenCalled();
    });
});

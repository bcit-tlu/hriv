import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import SortableTileGrid from "../../src/components/SortableTileGrid";
import type { SortableTileGridProps } from "../../src/components/SortableTileGrid";
import type { Group, Program } from "../../src/types";
import { DROP_PREFIX } from "../../src/components/sortableTileGridUtils";
import { makeCategory, makeImage } from "../helpers/fixtures";

// Capture onDragEnd from DragDropProvider for direct invocation.
// Real @dnd-kit Sortable sources/targets carry their projected sortable index
// (`index`/`initialIndex`/`group`); `move()` commits using the source's
// projected `index`, NOT the target's array position (see @dnd-kit/helpers
// mutate()). Model those fields so the mocks exercise the production path.
type SortableMeta = {
    index?: number;
    initialIndex?: number;
    group?: string;
};
type DragEndHandler = (event: {
    operation: {
        source: ({ id: string | number } & SortableMeta) | null;
        target: ({ id: string | number } & SortableMeta) | null;
        canceled: boolean;
    };
}) => void;

// Build a reorder source with the reflowed index `move()` actually commits.
function sortableSource(id: string, index: number, initialIndex = index) {
    return { id, index, initialIndex, group: "tiles" };
}

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

const defaultPrograms: Program[] = [
    {
        id: 10,
        name: "Pathology",
        oidc_group: null,
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
    },
];
const defaultGroups: Group[] = [
    {
        id: 30,
        name: "Lab A2",
        description: null,
        createdByUserId: 1,
        memberIds: [],
        instructorIds: [1],
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
    },
];

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

    it("renders inherited program and group chips for categories restricted by an ancestor", () => {
        renderGrid({
            path: [makeCategory({ id: 10, label: "Parent", programIds: [10], groupIds: [30] })],
            currentCategories: [
                makeCategory({ id: 11, label: "Child", parentId: 10 }),
            ],
            programs: defaultPrograms,
            groups: defaultGroups,
            canEditContent: false,
        });

        expect(screen.getByText("Pathology").closest('.MuiChip-root')).toHaveStyle({ opacity: '0.6' });
        expect(screen.getByText("Lab A2").closest('.MuiChip-root')).toHaveStyle({ opacity: '0.6' });
    });

    it("renders a move zone per category tile", () => {
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

    it("reorders when dropped on a sibling image tile (A2 optimistic reflow)", async () => {
        renderGrid({
            currentImages: [
                makeImage({ id: 10, name: "A", sortOrder: 0 }),
                makeImage({ id: 11, name: "B", sortOrder: 1 }),
            ],
        });

        // A2: dropping onto a sibling tile commits the reflowed order.
        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("img-11", 0, 1),
                    target: { id: "img-10" },
                    canceled: false,
                },
            });
        });

        expect(reorderImages).toHaveBeenCalledWith([
            { id: 11, sort_order: 0 },
            { id: 10, sort_order: 1 },
        ]);
        expect(reorderCategories).not.toHaveBeenCalled();
    });

    it("reorders an interleaved category + image when dropped on a tile", async () => {
        renderGrid({
            currentCategories: [
                makeCategory({ id: 1, label: "Cat", sortOrder: 0 }),
            ],
            currentImages: [makeImage({ id: 10, name: "Img", sortOrder: 1 })],
        });

        // Drag the image onto the category tile's sortable slot → reorder so
        // the image leads. Move-into-category would require a drop-cat-* target.
        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("img-10", 0, 1),
                    target: { id: "cat-1" },
                    canceled: false,
                },
            });
        });

        expect(reorderImages).toHaveBeenCalledWith([{ id: 10, sort_order: 0 }]);
        expect(reorderCategories).toHaveBeenCalledWith([
            { id: 1, parent_id: null, sort_order: 1 },
        ]);
    });

    it("calls onReorderError when a reorder API call fails", async () => {
        vi.mocked(reorderImages).mockRejectedValueOnce(
            new Error("Network error"),
        );
        const onReorderError = vi.fn();

        renderGrid({
            currentImages: [
                makeImage({ id: 10, sortOrder: 0 }),
                makeImage({ id: 11, sortOrder: 1 }),
            ],
            onReorderError,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("img-11", 0, 1),
                    target: { id: "img-10" },
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

    it("does nothing when source and target are the same tile (identity check)", async () => {
        const onDropImageOnCategory = vi.fn();
        renderGrid({
            currentImages: [makeImage({ id: 10, name: "Slide", sortOrder: 0 })],
            onDropImageOnCategory,
        });

        // After optimistic reflow the collision detector may resolve the target
        // as the source itself. With projected index === initialIndex, move()
        // returns the same array and the downstream identity check no-ops.
        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("img-10", 0, 0),
                    target: { id: "img-10" },
                    canceled: false,
                },
            });
        });

        expect(onDropImageOnCategory).not.toHaveBeenCalled();
        expect(reorderImages).not.toHaveBeenCalled();
    });

    it("reorders when source.id === target.id but projected index differs (optimistic reflow)", async () => {
        renderGrid({
            currentImages: [
                makeImage({ id: 10, name: "Slide A", sortOrder: 0 }),
                makeImage({ id: 11, name: "Slide B", sortOrder: 1 }),
            ],
        });

        // After optimistic reflow, the collision detector resolves the target as
        // the source itself. But the source's projected index (0) differs from
        // initialIndex (1) — real movement happened, so reorder must fire.
        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("img-11", 0, 1),
                    target: { id: "img-11" },
                    canceled: false,
                },
            });
        });

        expect(reorderImages).toHaveBeenCalledWith([
            { id: 11, sort_order: 0 },
            { id: 10, sort_order: 1 },
        ]);
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
                    source: sortableSource("cat-2", 0, 1),
                    target: { id: "cat-1" },
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
                    source: sortableSource("img-11", 0, 1),
                    target: { id: "img-10" },
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
                    source: sortableSource("img-10", 0, 1),
                    target: { id: "cat-1" },
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
                    source: sortableSource("img-10", 0, 1),
                    target: { id: "cat-1" },
                    canceled: false,
                },
            });
        });

        expect(onReorderError).toHaveBeenCalled();
        expect(onReorderComplete).toHaveBeenCalled();
    });

    it("calls onReorderComplete on success path", async () => {
        const onReorderComplete = vi.fn();

        renderGrid({
            currentImages: [
                makeImage({ id: 10, name: "A", sortOrder: 0 }),
                makeImage({ id: 11, name: "B", sortOrder: 1 }),
            ],
            onReorderComplete,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("img-11", 0, 1),
                    target: { id: "img-10" },
                    canceled: false,
                },
            });
        });

        expect(onReorderComplete).toHaveBeenCalledTimes(1);
    });

    it("awaits async onReorderComplete before releasing in-flight guard", async () => {
        // Verify handleDragEnd awaits the Promise returned by
        // onReorderComplete (keeps reorderInFlightRef true so the
        // render-time guard doesn't rebuild items from stale data).
        const callLog: string[] = [];
        const onReorderComplete = vi.fn(async () => {
            callLog.push("complete-called");
            // Simulate an async refresh (e.g. fetchCategoryTree)
            await Promise.resolve();
            callLog.push("complete-resolved");
        });

        renderGrid({
            currentImages: [
                makeImage({ id: 10, name: "A", sortOrder: 0 }),
                makeImage({ id: 11, name: "B", sortOrder: 1 }),
            ],
            onReorderComplete,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("img-11", 0, 1),
                    target: { id: "img-10" },
                    canceled: false,
                },
            });
        });

        // Both steps ran — the handler awaited the async callback.
        expect(callLog).toEqual(["complete-called", "complete-resolved"]);
    });
});

// ---------------------------------------------------------------------------
// Locked move-vs-reorder contract — see docs/drag-and-drop.md.
// These assertions exist so a regression in the dispatch rules fails CI.
// ---------------------------------------------------------------------------

describe("drag-and-drop spec contract (docs/drag-and-drop.md)", () => {
    beforeEach(() => {
        capturedOnDragEnd = undefined;
        vi.mocked(reorderCategories).mockReset().mockResolvedValue();
        vi.mocked(reorderImages).mockReset().mockResolvedValue();
    });

    it("move fires only on a drop-cat-* target (never the reorder APIs)", async () => {
        const onDropImageOnCategory = vi.fn();
        renderGrid({
            currentCategories: [makeCategory({ id: 5, sortOrder: 0 })],
            currentImages: [makeImage({ id: 42, sortOrder: 1 })],
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
        expect(reorderImages).not.toHaveBeenCalled();
        expect(reorderCategories).not.toHaveBeenCalled();
    });

    it("a drop-cat-* target only moves; it never reorders (move wins over the sortable)", async () => {
        const onDropImageOnCategory = vi.fn();
        renderGrid({
            currentCategories: [makeCategory({ id: 1, sortOrder: 0 })],
            currentImages: [
                makeImage({ id: 10, sortOrder: 1 }),
                makeImage({ id: 11, sortOrder: 2 }),
            ],
            onDropImageOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: { id: "img-11" },
                    target: { id: `${DROP_PREFIX}1` },
                    canceled: false,
                },
            });
        });

        expect(onDropImageOnCategory).toHaveBeenCalledWith(11, 1);
        expect(reorderImages).not.toHaveBeenCalled();
        expect(reorderCategories).not.toHaveBeenCalled();
    });

    it("handleDragEnd dispatches reorder for a bare tile target (pure dispatch; move-wins suppression is enforced upstream)", async () => {
        // `handleDragEnd` is pure dispatch: a non-`drop-cat-*` target reorders.
        // The move-wins guard does NOT live here — it lives in the directional
        // collision detectors (`farHalfReorderCollision` /
        // `nearHalfMoveCollision`): a category tile only becomes a reorder
        // target once the pointer crosses its centre on the far side, and the
        // High-priority move zone wins on the near half. That split is
        // unit-tested directly in `sortableTileGridUtils.test.ts`.
        const onDropCategoryOnCategory = vi.fn();
        renderGrid({
            currentCategories: [
                makeCategory({ id: 1, label: "Parent", sortOrder: 0 }),
                makeCategory({ id: 2, label: "Child", sortOrder: 1 }),
            ],
            onDropCategoryOnCategory,
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("cat-1", 1, 0),
                    target: { id: "cat-2" },
                    canceled: false,
                },
            });
        });

        expect(reorderCategories).toHaveBeenCalled();
        expect(onDropCategoryOnCategory).not.toHaveBeenCalled();
    });

    it("A2: reorder fires on a sibling tile target (optimistic reflow)", async () => {
        renderGrid({
            currentImages: [
                makeImage({ id: 10, sortOrder: 0 }),
                makeImage({ id: 11, sortOrder: 1 }),
            ],
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("img-10", 1, 0),
                    target: { id: "img-11" },
                    canceled: false,
                },
            });
        });

        expect(reorderImages).toHaveBeenCalled();
    });

    it("commits the projected sortable index, not the target's array position (3+ tiles)", async () => {
        // With ≤2 tiles the projected source index and the target's array
        // position coincide, so the dispatch is path-agnostic. With 3+ tiles
        // they can diverge: dragging the first tile past the *second* reflows
        // it to the end (index 2) even though the pointer's target tile sits at
        // index 1. `move()` commits the reflowed source.index, so this pins the
        // production path and guards future large-grid tests from silently
        // computing order from the target instead.
        renderGrid({
            currentImages: [
                makeImage({ id: 10, sortOrder: 0 }),
                makeImage({ id: 11, sortOrder: 1 }),
                makeImage({ id: 12, sortOrder: 2 }),
            ],
        });

        await act(async () => {
            await capturedOnDragEnd!({
                operation: {
                    source: sortableSource("img-10", 2, 0),
                    target: { id: "img-11" },
                    canceled: false,
                },
            });
        });

        // Projected index 2 → [11, 12, 10]. Target position 1 would give
        // [11, 10, 12]; asserting the former proves we follow source.index.
        expect(reorderImages).toHaveBeenCalledWith([
            { id: 11, sort_order: 0 },
            { id: 12, sort_order: 1 },
            { id: 10, sort_order: 2 },
        ]);
    });
});

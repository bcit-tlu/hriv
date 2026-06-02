/**
 * Unit tests for sortableTileGridUtils: moveOrReorder collision detection,
 * DROP_PREFIX constant, tileId, and buildTileItems.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollisionDescriptor } from "@dnd-kit/core";

// Mock @dnd-kit/core collision algorithms before importing the module under test
const mockPointerWithin = vi.fn<[], CollisionDescriptor[]>(() => []);
const mockClosestCenter = vi.fn<[], CollisionDescriptor[]>(() => []);

vi.mock("@dnd-kit/core", async () => {
    const actual =
        await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
    return {
        ...actual,
        pointerWithin: (...a: unknown[]) => mockPointerWithin(...(a as [])),
        closestCenter: (...a: unknown[]) => mockClosestCenter(...(a as [])),
    };
});

import {
    moveOrReorder,
    DROP_PREFIX,
    tileId,
    buildTileItems,
} from "../../src/components/sortableTileGridUtils";
import type { Category, ImageItem } from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCategory(overrides: Partial<Category> = {}): Category {
    return {
        id: 1,
        label: "Cat A",
        parentId: null,
        children: [],
        images: [],
        programIds: [],
        status: null,
        sortOrder: 0,
        cardImageId: null,
        ...overrides,
    };
}

function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
    return {
        id: 100,
        name: "Test Image",
        thumb: "/thumbs/test.jpg",
        tileSources: "/tiles/test.dzi",
        active: true,
        sortOrder: 0,
        version: 1,
        ...overrides,
    };
}

/** Minimal collision args — moveOrReorder only reads `args.active.id`. */
function makeArgs(activeId: string) {
    return {
        active: { id: activeId },
        collisionRect: {} as never,
        droppableRects: new Map() as never,
        droppableContainers: [] as never,
        pointerCoordinates: null,
    } as Parameters<typeof moveOrReorder>[0];
}

function collision(id: string): CollisionDescriptor {
    return { id, data: { droppableContainer: {} as never, value: 0 } };
}

// ---------------------------------------------------------------------------
// DROP_PREFIX
// ---------------------------------------------------------------------------

describe("DROP_PREFIX", () => {
    it("equals 'drop-cat-'", () => {
        expect(DROP_PREFIX).toBe("drop-cat-");
    });
});

// ---------------------------------------------------------------------------
// tileId
// ---------------------------------------------------------------------------

describe("tileId", () => {
    it("returns cat-{id} for category items", () => {
        expect(
            tileId({ type: "category", sortOrder: 0, data: makeCategory({ id: 7 }) }),
        ).toBe("cat-7");
    });

    it("returns img-{id} for image items", () => {
        expect(
            tileId({ type: "image", sortOrder: 0, data: makeImage({ id: 42 }) }),
        ).toBe("img-42");
    });
});

// ---------------------------------------------------------------------------
// moveOrReorder collision detection
// ---------------------------------------------------------------------------

describe("moveOrReorder", () => {
    beforeEach(() => {
        mockPointerWithin.mockReset();
        mockClosestCenter.mockReset();
    });

    // ── Image active scenarios ──────────────────────────────

    it("returns droppable zone hit when image pointer is within one", () => {
        const dropHit = collision("drop-cat-5");
        mockPointerWithin.mockReturnValue([
            collision("cat-3"),
            dropHit,
            collision("img-2"),
        ]);

        const result = moveOrReorder(makeArgs("img-10"));

        expect(result).toEqual([dropHit]);
        // closestCenter should NOT be called when a droppable hit is found
        expect(mockClosestCenter).not.toHaveBeenCalled();
    });

    it("returns first droppable hit when multiple zones overlap", () => {
        const hit1 = collision("drop-cat-5");
        const hit2 = collision("drop-cat-8");
        mockPointerWithin.mockReturnValue([hit1, hit2]);

        const result = moveOrReorder(makeArgs("img-1"));

        expect(result).toEqual([hit1]);
    });

    it("falls back to closestCenter when image has no droppable hit", () => {
        mockPointerWithin.mockReturnValue([
            collision("cat-3"),
            collision("img-2"),
        ]);
        const sortableHit = collision("cat-1");
        mockClosestCenter.mockReturnValue([sortableHit]);

        const result = moveOrReorder(makeArgs("img-10"));

        expect(result).toEqual([sortableHit]);
    });

    it("falls back to closestCenter when pointerWithin returns empty", () => {
        mockPointerWithin.mockReturnValue([]);
        const sortableHit = collision("img-5");
        mockClosestCenter.mockReturnValue([sortableHit]);

        const result = moveOrReorder(makeArgs("img-1"));

        expect(result).toEqual([sortableHit]);
    });

    // ── Category active scenarios ───────────────────────────

    it("skips droppable zones entirely when dragging a category", () => {
        const sortableHit = collision("cat-2");
        mockClosestCenter.mockReturnValue([sortableHit]);

        const result = moveOrReorder(makeArgs("cat-3"));

        expect(result).toEqual([sortableHit]);
        // pointerWithin should NOT be called for categories
        expect(mockPointerWithin).not.toHaveBeenCalled();
    });

    it("filters drop-cat-* IDs from closestCenter for category drags", () => {
        mockClosestCenter.mockReturnValue([
            collision("drop-cat-5"),
            collision("cat-2"),
            collision("drop-cat-8"),
            collision("img-1"),
        ]);

        const result = moveOrReorder(makeArgs("cat-3"));

        expect(result).toEqual([collision("cat-2"), collision("img-1")]);
    });

    // ── Fallback filtering ──────────────────────────────────

    it("filters drop-cat-* IDs from closestCenter fallback for images", () => {
        mockPointerWithin.mockReturnValue([]); // no droppable hit
        mockClosestCenter.mockReturnValue([
            collision("drop-cat-10"),
            collision("cat-1"),
            collision("drop-cat-20"),
        ]);

        const result = moveOrReorder(makeArgs("img-5"));

        expect(result).toEqual([collision("cat-1")]);
    });

    it("returns empty array when closestCenter only has drop-cat-* IDs", () => {
        mockPointerWithin.mockReturnValue([]);
        mockClosestCenter.mockReturnValue([
            collision("drop-cat-1"),
            collision("drop-cat-2"),
        ]);

        const result = moveOrReorder(makeArgs("img-1"));

        expect(result).toEqual([]);
    });

    it("returns empty array when closestCenter is empty", () => {
        mockPointerWithin.mockReturnValue([]);
        mockClosestCenter.mockReturnValue([]);

        const result = moveOrReorder(makeArgs("img-1"));

        expect(result).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// buildTileItems (additional coverage beyond SortableTileGrid.test.tsx)
// ---------------------------------------------------------------------------

describe("buildTileItems tiebreaker", () => {
    it("places categories before images at the same sortOrder", () => {
        const cat = makeCategory({ id: 1, sortOrder: 0 });
        const img = makeImage({ id: 10, sortOrder: 0 });
        const result = buildTileItems([cat], [img]);
        expect(result[0].type).toBe("category");
        expect(result[1].type).toBe("image");
    });

    it("uses id as secondary tiebreaker within the same type", () => {
        const cats = [
            makeCategory({ id: 5, sortOrder: 0 }),
            makeCategory({ id: 2, sortOrder: 0 }),
        ];
        const result = buildTileItems(cats, []);
        expect(result[0].data.id).toBe(2);
        expect(result[1].data.id).toBe(5);
    });
});

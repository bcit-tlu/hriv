/**
 * Unit tests for sortableTileGridUtils: moveOrReorder collision detection,
 * DROP_PREFIX constant, tileId, and buildTileItems.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CollisionDescriptor, UniqueIdentifier } from "@dnd-kit/core";

// Mock @dnd-kit/core collision algorithms before importing the module under test
const mockClosestCenter = vi.fn<[], CollisionDescriptor[]>(() => []);

vi.mock("@dnd-kit/core", async () => {
    const actual =
        await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
    return {
        ...actual,
        closestCenter: (...a: unknown[]) => mockClosestCenter(...(a as [])),
    };
});

import {
    moveOrReorder,
    createMoveOrReorder,
    DROP_PREFIX,
    tileId,
    buildTileItems,
} from "../../src/components/sortableTileGridUtils";
import { makeCategory, makeImage } from "../helpers/fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a droppable container stub with a bounding rect. */
function makeDroppable(
    id: UniqueIdentifier,
    rect: { left: number; top: number; width: number; height: number },
) {
    return {
        id,
        key: String(id),
        disabled: false,
        node: { current: null },
        data: { current: undefined },
        rect: {
            current: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                right: rect.left + rect.width,
                bottom: rect.top + rect.height,
            },
        },
    };
}

/** Build collision args with pointer position and droppable containers. */
function makeArgs(
    activeId: string,
    pointer: { x: number; y: number } | null = null,
    droppables: ReturnType<typeof makeDroppable>[] = [],
) {
    return {
        active: { id: activeId },
        collisionRect: {} as never,
        droppableRects: new Map() as never,
        droppableContainers: droppables as never,
        pointerCoordinates: pointer,
    } as Parameters<ReturnType<typeof createMoveOrReorder>>[0];
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
        mockClosestCenter.mockReset();
    });

    // A 100×100 droppable zone at (0,0). Center 70% spans (15,15)–(85,85).
    const catZone = makeDroppable("drop-cat-5", { left: 0, top: 0, width: 100, height: 100 });

    // ── Center 70% hit (image → move into category) ─────────

    it("returns droppable zone when image pointer is in center 70%", () => {
        const result = moveOrReorder(
            makeArgs("img-10", { x: 50, y: 50 }, [catZone]),
        );
        expect(result).toEqual([{ id: "drop-cat-5" }]);
        expect(mockClosestCenter).not.toHaveBeenCalled();
    });

    // ── Center 70% hit (category → move into category) ──────

    it("returns droppable zone when category pointer is in center 70%", () => {
        const result = moveOrReorder(
            makeArgs("cat-9", { x: 50, y: 50 }, [catZone]),
        );
        expect(result).toEqual([{ id: "drop-cat-5" }]);
        expect(mockClosestCenter).not.toHaveBeenCalled();
    });

    // ── Self-drop prevention ────────────────────────────────

    it("does not allow dropping a category onto itself", () => {
        const sortableHit = collision("cat-2");
        mockClosestCenter.mockReturnValue([sortableHit]);

        const result = moveOrReorder(
            makeArgs("cat-5", { x: 50, y: 50 }, [catZone]),
        );
        expect(result).toEqual([sortableHit]);
    });

    // ── Edge zone → reorder ─────────────────────────────────

    it("falls back to closestCenter when pointer is in edge zone", () => {
        const sortableHit = collision("cat-1");
        mockClosestCenter.mockReturnValue([sortableHit]);

        // x=5 is within the left 15% edge zone
        const result = moveOrReorder(
            makeArgs("img-10", { x: 5, y: 50 }, [catZone]),
        );
        expect(result).toEqual([sortableHit]);
    });

    it("falls back to closestCenter when pointer is in bottom edge zone", () => {
        const sortableHit = collision("img-2");
        mockClosestCenter.mockReturnValue([sortableHit]);

        // y=92 is within the bottom 15% edge zone
        const result = moveOrReorder(
            makeArgs("img-1", { x: 50, y: 92 }, [catZone]),
        );
        expect(result).toEqual([sortableHit]);
    });

    // ── No pointer coordinates → reorder ────────────────────

    it("falls back to closestCenter when no pointer coordinates", () => {
        const sortableHit = collision("img-5");
        mockClosestCenter.mockReturnValue([sortableHit]);

        const result = moveOrReorder(makeArgs("img-1", null, [catZone]));
        expect(result).toEqual([sortableHit]);
    });

    // ── closestCenter filtering ─────────────────────────────

    it("filters drop-cat-* IDs from closestCenter fallback", () => {
        mockClosestCenter.mockReturnValue([
            collision("drop-cat-10"),
            collision("cat-1"),
            collision("drop-cat-20"),
        ]);

        const result = moveOrReorder(makeArgs("img-5", { x: 5, y: 5 }, [catZone]));
        expect(result).toEqual([collision("cat-1")]);
    });

    it("returns empty array when closestCenter only has drop-cat-* IDs", () => {
        mockClosestCenter.mockReturnValue([
            collision("drop-cat-1"),
            collision("drop-cat-2"),
        ]);

        const result = moveOrReorder(makeArgs("img-1"));
        expect(result).toEqual([]);
    });

    it("returns empty array when closestCenter is empty", () => {
        mockClosestCenter.mockReturnValue([]);

        const result = moveOrReorder(makeArgs("img-1"));
        expect(result).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// createMoveOrReorder — ancestor-cycle prevention
// ---------------------------------------------------------------------------

describe("createMoveOrReorder ancestor-cycle prevention", () => {
    beforeEach(() => {
        mockClosestCenter.mockReset();
    });

    // Tree: cat-1 → cat-2 → cat-3
    const tree = [
        makeCategory({
            id: 1,
            children: [
                makeCategory({
                    id: 2,
                    children: [makeCategory({ id: 3 })],
                }),
            ],
        }),
        makeCategory({ id: 4 }),
    ];

    const detector = createMoveOrReorder(tree);
    const catZone2 = makeDroppable("drop-cat-2", { left: 0, top: 0, width: 100, height: 100 });
    const catZone3 = makeDroppable("drop-cat-3", { left: 0, top: 0, width: 100, height: 100 });
    const catZone4 = makeDroppable("drop-cat-4", { left: 200, top: 0, width: 100, height: 100 });

    it("blocks dropping a parent onto its child", () => {
        const sortableHit = collision("cat-99");
        mockClosestCenter.mockReturnValue([sortableHit]);

        // cat-1 dragged onto drop-cat-2 (its child) → blocked, falls back to closestCenter
        const result = detector(
            makeArgs("cat-1", { x: 50, y: 50 }, [catZone2]),
        );
        expect(result).toEqual([sortableHit]);
    });

    it("blocks dropping a grandparent onto its grandchild", () => {
        const sortableHit = collision("cat-99");
        mockClosestCenter.mockReturnValue([sortableHit]);

        // cat-1 dragged onto drop-cat-3 (its grandchild) → blocked
        const result = detector(
            makeArgs("cat-1", { x: 50, y: 50 }, [catZone3]),
        );
        expect(result).toEqual([sortableHit]);
    });

    it("allows dropping onto a non-descendant category", () => {
        // cat-1 dragged onto drop-cat-4 (sibling, not descendant) → allowed
        const result = detector(
            makeArgs("cat-1", { x: 250, y: 50 }, [catZone4]),
        );
        expect(result).toEqual([{ id: "drop-cat-4" }]);
        expect(mockClosestCenter).not.toHaveBeenCalled();
    });

    it("allows images to drop onto any category regardless of tree", () => {
        // img-10 dragged onto drop-cat-2 → allowed (ancestor-cycle only applies to categories)
        const result = detector(
            makeArgs("img-10", { x: 50, y: 50 }, [catZone2]),
        );
        expect(result).toEqual([{ id: "drop-cat-2" }]);
        expect(mockClosestCenter).not.toHaveBeenCalled();
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

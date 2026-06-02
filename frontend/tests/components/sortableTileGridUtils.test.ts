/**
 * Unit tests for sortableTileGridUtils: tileId, DROP_PREFIX,
 * collectDescendantIds, findCategory, buildTileItems,
 * createGapOnlyClosestCenter, and createInsetPointerIntersection.
 */

import { describe, it, expect, vi } from "vitest";

import {
    DROP_PREFIX,
    DROP_ZONE_INSET,
    tileId,
    collectDescendantIds,
    findCategory,
    buildTileItems,
    createGapOnlyClosestCenter,
    createInsetPointerIntersection,
} from "../../src/components/sortableTileGridUtils";
import { makeCategory, makeImage } from "../helpers/fixtures";

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
// collectDescendantIds
// ---------------------------------------------------------------------------

describe("collectDescendantIds", () => {
    it("returns empty set for a leaf category", () => {
        const leaf = makeCategory({ id: 1 });
        expect(collectDescendantIds(leaf)).toEqual(new Set());
    });

    it("collects direct children", () => {
        const cat = makeCategory({
            id: 1,
            children: [makeCategory({ id: 2 }), makeCategory({ id: 3 })],
        });
        expect(collectDescendantIds(cat)).toEqual(new Set([2, 3]));
    });

    it("collects nested descendants", () => {
        const cat = makeCategory({
            id: 1,
            children: [
                makeCategory({
                    id: 2,
                    children: [makeCategory({ id: 3 })],
                }),
            ],
        });
        expect(collectDescendantIds(cat)).toEqual(new Set([2, 3]));
    });

    it("does not include the root category itself", () => {
        const cat = makeCategory({
            id: 1,
            children: [makeCategory({ id: 2 })],
        });
        const ids = collectDescendantIds(cat);
        expect(ids.has(1)).toBe(false);
        expect(ids.has(2)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// findCategory
// ---------------------------------------------------------------------------

describe("findCategory", () => {
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

    it("finds a top-level category", () => {
        const found = findCategory(tree, 1);
        expect(found).toBeDefined();
        expect(found!.id).toBe(1);
    });

    it("finds a nested child category", () => {
        const found = findCategory(tree, 2);
        expect(found).toBeDefined();
        expect(found!.id).toBe(2);
    });

    it("finds a deeply nested category", () => {
        const found = findCategory(tree, 3);
        expect(found).toBeDefined();
        expect(found!.id).toBe(3);
    });

    it("finds a sibling root category", () => {
        const found = findCategory(tree, 4);
        expect(found).toBeDefined();
        expect(found!.id).toBe(4);
    });

    it("returns undefined for a non-existent ID", () => {
        expect(findCategory(tree, 999)).toBeUndefined();
    });

    it("returns undefined for an empty forest", () => {
        expect(findCategory([], 1)).toBeUndefined();
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

// ---------------------------------------------------------------------------
// createGapOnlyClosestCenter
// ---------------------------------------------------------------------------

vi.mock("@dnd-kit/collision", () => ({
    closestCenter: vi.fn(() => ({ id: "mock-closest", value: 1, type: 0, priority: 0 })),
    pointerIntersection: vi.fn(() => ({ id: "mock-pointer", value: 1, type: 1, priority: 3 })),
}));

function makeCollisionInput(x: number, y: number, droppableRect?: { left: number; right: number; top: number; bottom: number; width: number; height: number }) {
    return {
        droppable: {
            id: "drop-1",
            shape: droppableRect ? { boundingRectangle: droppableRect } : undefined,
        },
        dragOperation: {
            position: { current: { x, y } },
        },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function makeDomElement(rect: { left: number; right: number; top: number; bottom: number; width: number; height: number }): Element {
    return {
        getBoundingClientRect: () => rect,
    } as unknown as Element;
}

describe("createGapOnlyClosestCenter", () => {
    it("suppresses closestCenter when pointer is inside the inset rect of a drop zone", async () => {
        const { closestCenter } = await import("@dnd-kit/collision");
        const el = makeDomElement({ left: 0, right: 200, top: 0, bottom: 100, width: 200, height: 100 });
        const elements = new Set([el]);
        const detector = createGapOnlyClosestCenter(elements);
        // Pointer at center (100, 50) — inside inset rect
        const result = detector(makeCollisionInput(100, 50));
        expect(result).toBeNull();
        expect(closestCenter).not.toHaveBeenCalled();
    });

    it("delegates to closestCenter when pointer is in the fringe of a drop zone", async () => {
        const { closestCenter } = await import("@dnd-kit/collision");
        vi.mocked(closestCenter).mockClear();
        const el = makeDomElement({ left: 0, right: 200, top: 0, bottom: 100, width: 200, height: 100 });
        const elements = new Set([el]);
        const detector = createGapOnlyClosestCenter(elements);
        // Pointer at (2, 50) — inside full rect but outside the inset rect (5% of 200 = 10)
        const result = detector(makeCollisionInput(2, 50));
        expect(result).not.toBeNull();
        expect(closestCenter).toHaveBeenCalled();
    });

    it("delegates to closestCenter when pointer is outside all drop zones", async () => {
        const { closestCenter } = await import("@dnd-kit/collision");
        vi.mocked(closestCenter).mockClear();
        const el = makeDomElement({ left: 0, right: 200, top: 0, bottom: 100, width: 200, height: 100 });
        const elements = new Set([el]);
        const detector = createGapOnlyClosestCenter(elements);
        // Pointer at (300, 50) — completely outside
        const result = detector(makeCollisionInput(300, 50));
        expect(result).not.toBeNull();
        expect(closestCenter).toHaveBeenCalled();
    });

    it("delegates to closestCenter when there are no registered drop zones", async () => {
        const { closestCenter } = await import("@dnd-kit/collision");
        vi.mocked(closestCenter).mockClear();
        const elements = new Set<Element>();
        const detector = createGapOnlyClosestCenter(elements);
        const result = detector(makeCollisionInput(100, 50));
        expect(result).not.toBeNull();
        expect(closestCenter).toHaveBeenCalled();
    });

    it("exports DROP_ZONE_INSET as 0.05", () => {
        expect(DROP_ZONE_INSET).toBe(0.05);
    });
});

// ---------------------------------------------------------------------------
// createInsetPointerIntersection
// ---------------------------------------------------------------------------

describe("createInsetPointerIntersection", () => {
    it("delegates to pointerIntersection when pointer is inside the inset rect", async () => {
        const { pointerIntersection } = await import("@dnd-kit/collision");
        vi.mocked(pointerIntersection).mockClear();
        const detector = createInsetPointerIntersection(0.05);
        const rect = { left: 0, right: 200, top: 0, bottom: 100, width: 200, height: 100 };
        // Pointer at center (100, 50) — inside inset rect
        const result = detector(makeCollisionInput(100, 50, rect));
        expect(result).not.toBeNull();
        expect(pointerIntersection).toHaveBeenCalled();
    });

    it("returns null when pointer is in the fringe of the droppable", async () => {
        const { pointerIntersection } = await import("@dnd-kit/collision");
        vi.mocked(pointerIntersection).mockClear();
        const detector = createInsetPointerIntersection(0.05);
        const rect = { left: 0, right: 200, top: 0, bottom: 100, width: 200, height: 100 };
        // Pointer at (2, 50) — inside full rect but in the fringe (5% of 200 = 10)
        const result = detector(makeCollisionInput(2, 50, rect));
        expect(result).toBeNull();
        expect(pointerIntersection).not.toHaveBeenCalled();
    });

    it("returns null when droppable has no shape", async () => {
        const { pointerIntersection } = await import("@dnd-kit/collision");
        vi.mocked(pointerIntersection).mockClear();
        const detector = createInsetPointerIntersection(0.05);
        const result = detector(makeCollisionInput(100, 50));
        expect(result).toBeNull();
        expect(pointerIntersection).not.toHaveBeenCalled();
    });

    it("returns null when pointer is completely outside the droppable", async () => {
        const { pointerIntersection } = await import("@dnd-kit/collision");
        vi.mocked(pointerIntersection).mockClear();
        const detector = createInsetPointerIntersection(0.05);
        const rect = { left: 0, right: 200, top: 0, bottom: 100, width: 200, height: 100 };
        const result = detector(makeCollisionInput(300, 50, rect));
        expect(result).toBeNull();
        expect(pointerIntersection).not.toHaveBeenCalled();
    });
});

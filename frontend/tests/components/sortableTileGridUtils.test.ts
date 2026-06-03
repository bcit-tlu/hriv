import { describe, it, expect, vi } from "vitest";

import {
    DROP_PREFIX,
    REORDER_END_ID,
    REORDER_PREFIX,
    tileId,
    isReorderTargetId,
    reorderIndexFromTargetId,
    insertionIndexForMove,
    collectDescendantIds,
    findCategory,
    buildTileItems,
    createGapOnlyClosestCenter,
} from "../../src/components/sortableTileGridUtils";
import { makeCategory, makeImage } from "../helpers/fixtures";

const CLOSEST_CENTER_SENTINEL = [{ id: "sentinel" }];

vi.mock("@dnd-kit/collision", () => ({
    closestCenter: vi.fn(() => CLOSEST_CENTER_SENTINEL),
}));

/** Minimal collision input carrying only the pointer position the detector reads. */
function collisionInputAt(x: number, y: number) {
    return {
        dragOperation: { position: { current: { x, y } } },
    } as unknown as Parameters<
        ReturnType<typeof createGapOnlyClosestCenter>
    >[0];
}

/** A fake move-zone element with a fixed bounding rect. */
function moveZoneRect(
    left: number,
    top: number,
    right: number,
    bottom: number,
): Element {
    return {
        getBoundingClientRect: () => ({
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top,
            x: left,
            y: top,
            toJSON: () => ({}),
        }),
    } as unknown as Element;
}

describe("sortableTileGridUtils", () => {
    it("exposes expected drag target prefixes", () => {
        expect(DROP_PREFIX).toBe("drop-cat-");
        expect(REORDER_PREFIX).toBe("reorder-before-");
        expect(REORDER_END_ID).toBe("reorder-end");
    });

    it("creates tile ids", () => {
        expect(
            tileId({
                type: "category",
                sortOrder: 0,
                data: makeCategory({ id: 7 }),
            }),
        ).toBe("cat-7");
        expect(
            tileId({
                type: "image",
                sortOrder: 0,
                data: makeImage({ id: 42 }),
            }),
        ).toBe("img-42");
    });

    it("recognizes reorder targets", () => {
        expect(isReorderTargetId(`${REORDER_PREFIX}cat-1`)).toBe(true);
        expect(isReorderTargetId(REORDER_END_ID)).toBe(true);
        expect(isReorderTargetId("cat-1")).toBe(false);
        expect(isReorderTargetId(`${DROP_PREFIX}2`)).toBe(false);
    });

    it("resolves reorder target index", () => {
        const items = buildTileItems(
            [makeCategory({ id: 1, sortOrder: 0 })],
            [makeImage({ id: 10, sortOrder: 1 })],
        );

        expect(reorderIndexFromTargetId(`${REORDER_PREFIX}cat-1`, items)).toBe(
            0,
        );
        expect(reorderIndexFromTargetId(`${REORDER_PREFIX}img-10`, items)).toBe(
            1,
        );
        expect(reorderIndexFromTargetId(REORDER_END_ID, items)).toBe(2);
        expect(reorderIndexFromTargetId("cat-1", items)).toBeNull();
    });

    it("calculates insertion index for move", () => {
        expect(insertionIndexForMove(2, 0, 4)).toBe(0);
        expect(insertionIndexForMove(0, 2, 4)).toBe(1);
        expect(insertionIndexForMove(0, 4, 4)).toBe(3);
    });

    it("collects descendants and finds categories in tree", () => {
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
        ];

        expect(collectDescendantIds(tree[0])).toEqual(new Set([2, 3]));
        expect(findCategory(tree, 3)?.id).toBe(3);
        expect(findCategory(tree, 999)).toBeUndefined();
    });

    it("builds interleaved sorted tile items with stable tiebreakers", () => {
        const result = buildTileItems(
            [
                makeCategory({ id: 5, sortOrder: 0 }),
                makeCategory({ id: 2, sortOrder: 0 }),
            ],
            [makeImage({ id: 10, sortOrder: 0 })],
        );

        expect(result.map((r) => r.type)).toEqual([
            "category",
            "category",
            "image",
        ]);
        expect(result.map((r) => r.data.id)).toEqual([2, 5, 10]);
    });
});

// ---------------------------------------------------------------------------
// Move-wins guard (docs/drag-and-drop.md): reorder/reflow is suppressed while
// the pointer is inside a registered category move zone, and stays active
// everywhere else. This is the real enforcement of "move always wins over a
// category tile" — the optimistic-sorting plugin reflows only when this
// detector returns a collision, so returning `null` over a move zone fully
// suppresses reflow there while preserving it over image tiles, the inset
// margin around a category, and the inter-tile gaps.
// ---------------------------------------------------------------------------

describe("createGapOnlyClosestCenter (move-wins suppression guard)", () => {
    it("returns null (suppresses reflow) when the pointer is inside a move zone", () => {
        const zones = new Set<Element>([moveZoneRect(100, 100, 200, 200)]);
        const detector = createGapOnlyClosestCenter(zones);

        // Dead-centre and on every edge of the move zone → suppressed.
        expect(detector(collisionInputAt(150, 150))).toBeNull();
        expect(detector(collisionInputAt(100, 100))).toBeNull();
        expect(detector(collisionInputAt(200, 200))).toBeNull();
    });

    it("delegates to closestCenter (reflow active) when the pointer is outside every move zone", () => {
        const zones = new Set<Element>([moveZoneRect(100, 100, 200, 200)]);
        const detector = createGapOnlyClosestCenter(zones);

        // Just outside the rect (the inset margin / gap / image-tile region).
        expect(detector(collisionInputAt(99, 150))).toBe(
            CLOSEST_CENTER_SENTINEL,
        );
        expect(detector(collisionInputAt(150, 201))).toBe(
            CLOSEST_CENTER_SENTINEL,
        );
    });

    it("suppresses when inside ANY of several registered move zones", () => {
        const zones = new Set<Element>([
            moveZoneRect(0, 0, 50, 50),
            moveZoneRect(300, 300, 400, 400),
        ]);
        const detector = createGapOnlyClosestCenter(zones);

        expect(detector(collisionInputAt(25, 25))).toBeNull();
        expect(detector(collisionInputAt(350, 350))).toBeNull();
        // Between the two zones → reorder stays active.
        expect(detector(collisionInputAt(150, 150))).toBe(
            CLOSEST_CENTER_SENTINEL,
        );
    });

    it("with no registered move zones, never suppresses (pure reorder grid)", () => {
        const detector = createGapOnlyClosestCenter(new Set<Element>());
        expect(detector(collisionInputAt(10, 10))).toBe(
            CLOSEST_CENTER_SENTINEL,
        );
    });
});

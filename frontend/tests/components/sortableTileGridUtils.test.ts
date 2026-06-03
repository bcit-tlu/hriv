import { describe, it, expect } from "vitest";

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
} from "../../src/components/sortableTileGridUtils";
import { makeCategory, makeImage } from "../helpers/fixtures";

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

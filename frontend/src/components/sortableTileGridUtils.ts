import { closestCenter } from "@dnd-kit/collision";
import type { CollisionDetector } from "@dnd-kit/abstract";

import type { Category, ImageItem } from "../types";

// ── Tile item union type ────────────────────────────────────

export type TileItem =
    | { type: "category"; sortOrder: number; data: Category }
    | { type: "image"; sortOrder: number; data: ImageItem };

export function tileId(item: TileItem): string {
    return item.type === "category"
        ? `cat-${item.data.id}`
        : `img-${item.data.id}`;
}

// Category tile drop target: move into category.
export const DROP_PREFIX = "drop-cat-";

// Gap drop target: reorder before this index.
export const REORDER_PREFIX = "reorder-before-";
export const REORDER_END_ID = "reorder-end";

export function isReorderTargetId(id: string): boolean {
    return id.startsWith(REORDER_PREFIX) || id === REORDER_END_ID;
}

export function reorderIndexFromTargetId(
    targetId: string,
    items: TileItem[],
): number | null {
    if (targetId === REORDER_END_ID) return items.length;
    if (!targetId.startsWith(REORDER_PREFIX)) return null;

    const beforeId = targetId.slice(REORDER_PREFIX.length);
    const index = items.findIndex((item) => tileId(item) === beforeId);
    return index === -1 ? null : index;
}

export function insertionIndexForMove(
    oldIndex: number,
    targetIndex: number,
    itemCount: number,
): number {
    const clampedTarget = Math.max(0, Math.min(targetIndex, itemCount));
    const adjusted =
        clampedTarget > oldIndex ? clampedTarget - 1 : clampedTarget;
    return Math.max(0, Math.min(adjusted, itemCount - 1));
}

/**
 * Collision detector for sortable tiles that delegates to `closestCenter`
 * but returns `null` (no collision) whenever the pointer is inside any
 * registered category move-zone element. Because the optimistic-sorting
 * plugin only reflows when a sortable is the colliding target, returning
 * `null` here suppresses reorder/reflow while the pointer is inside a move
 * zone, so move always wins there (per the locked spec's guard). The
 * registered element is the *inset* centre of a category tile, so reflow
 * stays active over image tiles, over the inset margin around a category
 * tile, and in the inter-tile gaps — keeping category reorder practical.
 */
export function createGapOnlyClosestCenter(
    moveZoneElements: Set<Element>,
): CollisionDetector {
    return (input) => {
        const { x, y } = input.dragOperation.position.current;
        for (const el of moveZoneElements) {
            const rect = el.getBoundingClientRect();
            if (
                x >= rect.left &&
                x <= rect.right &&
                y >= rect.top &&
                y <= rect.bottom
            ) {
                return null;
            }
        }
        return closestCenter(input);
    };
}

// ── Descendant / tree helpers ───────────────────────────────

/** Collect all descendant category IDs (not including the root itself). */
export function collectDescendantIds(cat: Category): Set<number> {
    const ids = new Set<number>();
    const walk = (children: Category[]) => {
        for (const c of children) {
            ids.add(c.id);
            walk(c.children);
        }
    };
    walk(cat.children);
    return ids;
}

/** Find a category by id anywhere in a forest. */
export function findCategory(
    cats: Category[],
    id: number,
): Category | undefined {
    for (const c of cats) {
        if (c.id === id) return c;
        const found = findCategory(c.children, id);
        if (found) return found;
    }
    return undefined;
}

/** Build an interleaved, sorted list of categories and images. */
export function buildTileItems(
    categories: Category[],
    images: ImageItem[],
): TileItem[] {
    const items: TileItem[] = [
        ...categories.map(
            (c): TileItem => ({
                type: "category",
                sortOrder: c.sortOrder,
                data: c,
            }),
        ),
        ...images.map(
            (i): TileItem => ({
                type: "image",
                sortOrder: i.sortOrder,
                data: i,
            }),
        ),
    ];

    items.sort((a, b) => {
        const d = a.sortOrder - b.sortOrder;
        if (d !== 0) return d;
        if (a.type !== b.type) return a.type === "category" ? -1 : 1;
        return a.data.id - b.data.id;
    });

    return items;
}

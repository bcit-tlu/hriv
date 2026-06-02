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

// ── Droppable category zone ID prefix ────────────────────────

export const DROP_PREFIX = "drop-cat-";

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

/**
 * Create a collision detector for sortable items that delegates to
 * `closestCenter` but suppresses collisions when the pointer is
 * currently inside any registered category drop zone element.
 * This prevents the OptimisticSortingPlugin from visually reordering
 * tiles while the user is hovering over a "Move here" drop target.
 */
export function createGapOnlyClosestCenter(
    dropZoneElements: Set<Element>,
): CollisionDetector {
    return (input) => {
        const { x, y } = input.dragOperation.position.current;
        for (const el of dropZoneElements) {
            const rect = el.getBoundingClientRect();
            // Inset the hit-test rect by ~5% on each side so the outer
            // 5% fringe of a category card belongs to the reorder zone.
            const insetX = rect.width * 0.05;
            const insetY = rect.height * 0.05;
            if (
                x >= rect.left + insetX &&
                x <= rect.right - insetX &&
                y >= rect.top + insetY &&
                y <= rect.bottom - insetY
            ) {
                return null;
            }
        }
        return closestCenter(input);
    };
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
        // Stable tiebreaker: categories before images at the same sortOrder
        if (a.type !== b.type) return a.type === "category" ? -1 : 1;
        return a.data.id - b.data.id;
    });
    return items;
}

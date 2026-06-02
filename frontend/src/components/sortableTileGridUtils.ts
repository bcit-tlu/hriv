import { closestCenter } from "@dnd-kit/core";
import type { CollisionDetection } from "@dnd-kit/core";
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

// ── Custom collision detection ──────────────────────────────
// When the pointer is within the center 70% of a droppable category zone,
// treat the gesture as a "move into category" (for both image and category
// drags). When the pointer is near tile edges or in the gap between tiles,
// fall back to closestCenter for sortable reordering.

export const moveOrReorder: CollisionDetection = (args) => {
    const activeId = String(args.active.id);
    const pointer = args.pointerCoordinates;

    if (pointer) {
        for (const container of args.droppableContainers) {
            const id = String(container.id);
            if (!id.startsWith(DROP_PREFIX)) continue;

            // Don't allow dropping a category onto itself
            const targetCatId = id.slice(DROP_PREFIX.length);
            if (activeId === `cat-${targetCatId}`) continue;

            const rect = container.rect.current;
            if (!rect) continue;

            // Shrink rect by 15% on each side → center 70%
            const insetX = rect.width * 0.15;
            const insetY = rect.height * 0.15;

            if (
                pointer.x >= rect.left + insetX &&
                pointer.x <= rect.left + rect.width - insetX &&
                pointer.y >= rect.top + insetY &&
                pointer.y <= rect.top + rect.height - insetY
            ) {
                return [{ id: container.id }];
            }
        }
    }

    // Pointer is near tile edges or in the gap — reorder.
    // Filter droppable zone IDs from closestCenter so they can't
    // accidentally win the fallback (their rects overlap sortable items).
    return closestCenter(args).filter(
        (c) => !String(c.id).startsWith(DROP_PREFIX),
    );
};

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

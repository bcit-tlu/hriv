import {
    closestCenter,
    pointerWithin,
} from "@dnd-kit/core";
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
// Prefer droppable category zones (move-into) when the pointer is within
// one; otherwise fall back to closestCenter for sortable reordering.

export const moveOrReorder: CollisionDetection = (args) => {
    const activeId = String(args.active.id);

    // Categories always reorder — they use the Move button for reparenting.
    // Only images activate droppable category zones.
    if (!activeId.startsWith("cat-")) {
        const pointerCollisions = pointerWithin(args);

        const droppableHit = pointerCollisions.find((c) => {
            const id = String(c.id);
            return id.startsWith(DROP_PREFIX);
        });

        if (droppableHit) return [droppableHit];
    }

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

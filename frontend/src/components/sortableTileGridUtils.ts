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

// ── Descendant helpers ──────────────────────────────────────

/** Collect all descendant category IDs (not including the root itself). */
function collectDescendantIds(cat: Category): Set<number> {
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
function findCategory(
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

// ── Custom collision detection factory ──────────────────────
// When the pointer is within the center 70% of a droppable category zone,
// treat the gesture as a "move into category" (for both image and category
// drags). When the pointer is near tile edges or in the gap between tiles,
// fall back to closestCenter for sortable reordering.
//
// The factory closes over the full category tree so it can prevent
// ancestor-cycle drops (dragging a parent onto one of its descendants).

export function createMoveOrReorder(
    allCategories: Category[],
): CollisionDetection {
    return (args) => {
        const activeId = String(args.active.id);
        const pointer = args.pointerCoordinates;

        // Pre-compute blocked IDs when the active item is a category.
        // Always block self-drop; additionally block all descendants when
        // the tree is available (ancestor-cycle prevention).
        let blockedIds: Set<number> | null = null;
        if (activeId.startsWith("cat-")) {
            const catId = Number(activeId.slice(4));
            const cat = findCategory(allCategories, catId);
            if (cat) {
                blockedIds = collectDescendantIds(cat);
            } else {
                blockedIds = new Set<number>();
            }
            blockedIds.add(catId); // always block self-drop
        }

        if (pointer) {
            for (const container of args.droppableContainers) {
                const id = String(container.id);
                if (!id.startsWith(DROP_PREFIX)) continue;

                const targetCatId = Number(id.slice(DROP_PREFIX.length));

                // Block self-drop and ancestor-cycle drops
                if (blockedIds?.has(targetCatId)) continue;

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
}

// Convenience alias for contexts without a category tree (e.g. tests)
export const moveOrReorder: CollisionDetection = createMoveOrReorder([]);

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

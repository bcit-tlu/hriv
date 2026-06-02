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
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    return items;
}

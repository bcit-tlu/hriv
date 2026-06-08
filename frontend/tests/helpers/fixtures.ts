/**
 * Shared test fixture factories for Category and ImageItem.
 *
 * Use these instead of defining local makeCategory/makeImage helpers in
 * individual test files. All fields have sensible defaults; pass overrides
 * to customise individual values.
 */

import type { Category, ImageItem } from "../../src/types";

export function makeCategory(overrides: Partial<Category> = {}): Category {
    return {
        id: 1,
        label: "Test Category",
        parentId: null,
        children: [],
        images: [],
        programIds: [],
        groupIds: [],
        status: null,
        sortOrder: 0,
        cardImageId: null,
        ...overrides,
    };
}

export function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
    return {
        id: 100,
        name: "Test Image",
        thumb: "/thumbs/test.jpg",
        tileSources: "/tiles/test.dzi",
        active: true,
        sortOrder: 0,
        version: 1,
        ...overrides,
    };
}

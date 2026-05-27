import { describe, it, expect } from "vitest";
import { findImageInTree, findCategoryPath, resolveCategoryPath } from "../src/treeUtils";
import type { Category } from "../src/types";

function makeImage(id: number, name = `img-${id}`) {
    return {
        id,
        name,
        thumb: `/thumb/${id}.jpg`,
        tileSources: `/tiles/${id}`,
        active: true,
        version: 1,
    };
}

function makeCategory(
    id: number,
    label: string,
    children: Category[] = [],
    images: ReturnType<typeof makeImage>[] = [],
): Category {
    return {
        id,
        label,
        parentId: null,
        children,
        images,
        programIds: [],
    };
}

describe("findImageInTree", () => {
    it("returns null for an empty tree", () => {
        expect(findImageInTree([], 1)).toBeNull();
    });

    it("finds an image at the root level", () => {
        const img = makeImage(42);
        const cat = makeCategory(1, "Root", [], [img]);
        const result = findImageInTree([cat], 42);
        expect(result).not.toBeNull();
        expect(result!.image.id).toBe(42);
        expect(result!.path).toHaveLength(1);
        expect(result!.path[0].id).toBe(1);
    });

    it("finds an image in a nested category", () => {
        const img = makeImage(99);
        const child = makeCategory(2, "Child", [], [img]);
        const root = makeCategory(1, "Root", [child]);
        const result = findImageInTree([root], 99);
        expect(result).not.toBeNull();
        expect(result!.image.id).toBe(99);
        expect(result!.path.map((c) => c.id)).toEqual([1, 2]);
    });

    it("returns null when image does not exist", () => {
        const cat = makeCategory(1, "Root", [], [makeImage(1)]);
        expect(findImageInTree([cat], 999)).toBeNull();
    });

    it("finds the first matching image across siblings", () => {
        const img = makeImage(5);
        const cat1 = makeCategory(1, "A");
        const cat2 = makeCategory(2, "B", [], [img]);
        const result = findImageInTree([cat1, cat2], 5);
        expect(result).not.toBeNull();
        expect(result!.path[0].id).toBe(2);
    });
});

describe("findCategoryPath", () => {
    it("returns null for an empty tree", () => {
        expect(findCategoryPath([], 1)).toBeNull();
    });

    it("finds a root-level category", () => {
        const cat = makeCategory(10, "Root");
        const result = findCategoryPath([cat], 10);
        expect(result).not.toBeNull();
        expect(result!.map((c) => c.id)).toEqual([10]);
    });

    it("finds a nested category with full path", () => {
        const grandchild = makeCategory(3, "GC");
        const child = makeCategory(2, "Child", [grandchild]);
        const root = makeCategory(1, "Root", [child]);
        const result = findCategoryPath([root], 3);
        expect(result).not.toBeNull();
        expect(result!.map((c) => c.id)).toEqual([1, 2, 3]);
    });

    it("returns null when category does not exist", () => {
        const cat = makeCategory(1, "Root");
        expect(findCategoryPath([cat], 999)).toBeNull();
    });
});

describe("resolveCategoryPath", () => {
    it("returns empty array for empty ids", () => {
        const cat = makeCategory(1, "Root");
        expect(resolveCategoryPath([cat], [])).toEqual([]);
    });

    it("resolves a single-level path", () => {
        const cat = makeCategory(1, "Root");
        const result = resolveCategoryPath([cat], [1]);
        expect(result.map((c) => c.id)).toEqual([1]);
    });

    it("resolves a multi-level path", () => {
        const grandchild = makeCategory(3, "GC");
        const child = makeCategory(2, "Child", [grandchild]);
        const root = makeCategory(1, "Root", [child]);
        const result = resolveCategoryPath([root], [1, 2, 3]);
        expect(result.map((c) => c.id)).toEqual([1, 2, 3]);
    });

    it("stops at the first missing ID", () => {
        const child = makeCategory(2, "Child");
        const root = makeCategory(1, "Root", [child]);
        const result = resolveCategoryPath([root], [1, 999, 2]);
        expect(result.map((c) => c.id)).toEqual([1]);
    });

    it("returns empty when first ID does not match", () => {
        const cat = makeCategory(1, "Root");
        expect(resolveCategoryPath([cat], [999])).toEqual([]);
    });
});

import { describe, it, expect } from "vitest";
import { findImageInTree, findCategoryPath, resolveCategoryPath } from "../src/treeUtils";
import { makeCategory, makeImage } from "./helpers/fixtures";

describe("findImageInTree", () => {
    it("returns null for an empty tree", () => {
        expect(findImageInTree([], 1)).toBeNull();
    });

    it("finds an image at the root level", () => {
        const img = makeImage({ id: 42 });
        const cat = makeCategory({ id: 1, label: "Root", images: [img] });
        const result = findImageInTree([cat], 42);
        expect(result).not.toBeNull();
        expect(result!.image.id).toBe(42);
        expect(result!.path).toHaveLength(1);
        expect(result!.path[0].id).toBe(1);
    });

    it("finds an image in a nested category", () => {
        const img = makeImage({ id: 99 });
        const child = makeCategory({ id: 2, label: "Child", images: [img] });
        const root = makeCategory({ id: 1, label: "Root", children: [child] });
        const result = findImageInTree([root], 99);
        expect(result).not.toBeNull();
        expect(result!.image.id).toBe(99);
        expect(result!.path.map((c) => c.id)).toEqual([1, 2]);
    });

    it("returns null when image does not exist", () => {
        const cat = makeCategory({ id: 1, label: "Root", images: [makeImage({ id: 1 })] });
        expect(findImageInTree([cat], 999)).toBeNull();
    });

    it("finds the first matching image across siblings", () => {
        const img = makeImage({ id: 5 });
        const cat1 = makeCategory({ id: 1, label: "A" });
        const cat2 = makeCategory({ id: 2, label: "B", images: [img] });
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
        const cat = makeCategory({ id: 10, label: "Root" });
        const result = findCategoryPath([cat], 10);
        expect(result).not.toBeNull();
        expect(result!.map((c) => c.id)).toEqual([10]);
    });

    it("finds a nested category with full path", () => {
        const grandchild = makeCategory({ id: 3, label: "GC" });
        const child = makeCategory({ id: 2, label: "Child", children: [grandchild] });
        const root = makeCategory({ id: 1, label: "Root", children: [child] });
        const result = findCategoryPath([root], 3);
        expect(result).not.toBeNull();
        expect(result!.map((c) => c.id)).toEqual([1, 2, 3]);
    });

    it("returns null when category does not exist", () => {
        const cat = makeCategory({ id: 1, label: "Root" });
        expect(findCategoryPath([cat], 999)).toBeNull();
    });
});

describe("resolveCategoryPath", () => {
    it("returns empty array for empty ids", () => {
        const cat = makeCategory({ id: 1, label: "Root" });
        expect(resolveCategoryPath([cat], [])).toEqual([]);
    });

    it("resolves a single-level path", () => {
        const cat = makeCategory({ id: 1, label: "Root" });
        const result = resolveCategoryPath([cat], [1]);
        expect(result.map((c) => c.id)).toEqual([1]);
    });

    it("resolves a multi-level path", () => {
        const grandchild = makeCategory({ id: 3, label: "GC" });
        const child = makeCategory({ id: 2, label: "Child", children: [grandchild] });
        const root = makeCategory({ id: 1, label: "Root", children: [child] });
        const result = resolveCategoryPath([root], [1, 2, 3]);
        expect(result.map((c) => c.id)).toEqual([1, 2, 3]);
    });

    it("stops at the first missing ID", () => {
        const child = makeCategory({ id: 2, label: "Child" });
        const root = makeCategory({ id: 1, label: "Root", children: [child] });
        const result = resolveCategoryPath([root], [1, 999, 2]);
        expect(result.map((c) => c.id)).toEqual([1]);
    });

    it("returns empty when first ID does not match", () => {
        const cat = makeCategory({ id: 1, label: "Root" });
        expect(resolveCategoryPath([cat], [999])).toEqual([]);
    });
});

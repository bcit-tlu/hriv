/**
 * Unit tests for SortableTileGrid component and buildTileItems utility.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildTileItems } from "../../src/components/sortableTileGridUtils";
import SortableTileGrid from "../../src/components/SortableTileGrid";
import type { Category, ImageItem, Program } from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCategory(overrides: Partial<Category> = {}): Category {
    return {
        id: 1,
        label: "Cat A",
        parentId: null,
        children: [],
        images: [],
        programIds: [],
        status: null,
        sortOrder: 0,
        cardImageId: null,
        ...overrides,
    };
}

function makeImage(overrides: Partial<ImageItem> = {}): ImageItem {
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

const defaultPrograms: Program[] = [];

// ---------------------------------------------------------------------------
// buildTileItems
// ---------------------------------------------------------------------------

describe("buildTileItems", () => {
    it("returns empty array for no categories or images", () => {
        expect(buildTileItems([], [])).toEqual([]);
    });

    it("returns categories only when no images", () => {
        const cats = [makeCategory({ id: 1, sortOrder: 0 })];
        const result = buildTileItems(cats, []);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("category");
        expect(result[0].data.id).toBe(1);
    });

    it("returns images only when no categories", () => {
        const imgs = [makeImage({ id: 10, sortOrder: 0 })];
        const result = buildTileItems([], imgs);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe("image");
        expect(result[0].data.id).toBe(10);
    });

    it("interleaves categories and images sorted by sortOrder", () => {
        const cats = [
            makeCategory({ id: 1, sortOrder: 0 }),
            makeCategory({ id: 2, sortOrder: 2 }),
        ];
        const imgs = [
            makeImage({ id: 10, sortOrder: 1 }),
            makeImage({ id: 11, sortOrder: 3 }),
        ];
        const result = buildTileItems(cats, imgs);
        expect(result.map((r) => r.data.id)).toEqual([1, 10, 2, 11]);
        expect(result.map((r) => r.type)).toEqual([
            "category",
            "image",
            "category",
            "image",
        ]);
    });

    it("handles duplicate sortOrder values deterministically", () => {
        const cats = [makeCategory({ id: 1, sortOrder: 0 })];
        const imgs = [makeImage({ id: 10, sortOrder: 0 })];
        const result = buildTileItems(cats, imgs);
        expect(result).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// SortableTileGrid rendering
// ---------------------------------------------------------------------------

describe("SortableTileGrid", () => {
    it("renders category and image tiles", () => {
        const cat = makeCategory({
            id: 1,
            label: "Architecture",
            sortOrder: 0,
        });
        const img = makeImage({
            id: 10,
            name: "Liver Section",
            sortOrder: 1,
        });

        render(
            <SortableTileGrid
                currentCategories={[cat]}
                currentImages={[img]}
                uncategorizedImages={[]}
                path={[]}
                canEditContent={false}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        expect(screen.getByText("Architecture")).toBeInTheDocument();
        expect(screen.getByText("Liver Section")).toBeInTheDocument();
    });

    it("includes uncategorized images at root level", () => {
        const uncat = makeImage({
            id: 20,
            name: "Uncategorized Img",
            sortOrder: 0,
        });

        render(
            <SortableTileGrid
                currentCategories={[]}
                currentImages={[]}
                uncategorizedImages={[uncat]}
                path={[]}
                canEditContent={false}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        expect(screen.getByText("Uncategorized Img")).toBeInTheDocument();
    });

    it("excludes uncategorized images when not at root", () => {
        const parentCat = makeCategory({ id: 1, label: "Parent" });
        const uncat = makeImage({
            id: 20,
            name: "Uncategorized Img",
            sortOrder: 0,
        });

        render(
            <SortableTileGrid
                currentCategories={[]}
                currentImages={[]}
                uncategorizedImages={[uncat]}
                path={[parentCat]}
                canEditContent={false}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        expect(
            screen.queryByText("Uncategorized Img"),
        ).not.toBeInTheDocument();
    });

    it("enables sortable drag for editors", () => {
        const cat = makeCategory({
            id: 1,
            label: "Architecture",
            sortOrder: 0,
        });

        render(
            <SortableTileGrid
                currentCategories={[cat]}
                currentImages={[]}
                uncategorizedImages={[]}
                path={[]}
                canEditContent={true}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        const sortableItems = screen.queryAllByRole("button");
        const sortableItem = sortableItems.find(
            (el) => el.getAttribute("aria-roledescription") === "sortable",
        );
        expect(sortableItem).toBeDefined();
        expect(sortableItem).not.toHaveAttribute("aria-disabled", "true");
    });

    it("disables sortable drag for non-editors", () => {
        const cat = makeCategory({
            id: 1,
            label: "Architecture",
            sortOrder: 0,
        });

        render(
            <SortableTileGrid
                currentCategories={[cat]}
                currentImages={[]}
                uncategorizedImages={[]}
                path={[]}
                canEditContent={false}
                fileDragActive={false}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        const sortableItems = screen.queryAllByRole("button");
        const sortableWrapper = sortableItems.find(
            (el) => el.getAttribute("aria-roledescription") === "sortable",
        );
        expect(sortableWrapper).toBeDefined();
        expect(sortableWrapper).toHaveAttribute("aria-disabled", "true");
    });

    it("renders FileDropZone for editors when drag active", () => {
        render(
            <SortableTileGrid
                currentCategories={[]}
                currentImages={[]}
                uncategorizedImages={[]}
                path={[]}
                canEditContent={true}
                fileDragActive={true}
                programs={defaultPrograms}
                onCategoryClick={vi.fn()}
                onImageClick={vi.fn()}
                onFilesDrop={vi.fn()}
            />,
        );

        expect(
            screen.getByText(/drop files here/i),
        ).toBeInTheDocument();
    });
});

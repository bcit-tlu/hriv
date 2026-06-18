import type { Category, ImageItem } from "./types";

/** Search the category tree for an image by ID, returning the image and its category path. */
export function findImageInTree(
    tree: Category[],
    imageId: number,
    path: Category[] = [],
): { image: ImageItem; path: Category[] } | null {
    for (const cat of tree) {
        for (const img of cat.images) {
            if (img.id === imageId) return { image: img, path: [...path, cat] };
        }
        const found = findImageInTree(cat.children, imageId, [...path, cat]);
        if (found) return found;
    }
    return null;
}

export function findCategoryPath(
    tree: Category[],
    categoryId: number,
    path: Category[] = [],
): Category[] | null {
    for (const cat of tree) {
        if (cat.id === categoryId) return [...path, cat];
        const found = findCategoryPath(cat.children, categoryId, [
            ...path,
            cat,
        ]);
        if (found) return found;
    }
    return null;
}

export interface CategoryHiddenState {
    hidden: boolean;
    directlyHidden: boolean;
    hiddenByAncestor: boolean;
}

/** Derive direct vs inherited hidden state from a category path. */
export function getCategoryHiddenStateFromPath(
    path: Category[] | null | undefined,
): CategoryHiddenState {
    if (!path?.length) {
        return {
            hidden: false,
            directlyHidden: false,
            hiddenByAncestor: false,
        };
    }

    const directlyHidden = path[path.length - 1].status === "hidden";
    const hiddenByAncestor = path
        .slice(0, -1)
        .some((category) => category.status === "hidden");

    return {
        hidden: directlyHidden || hiddenByAncestor,
        directlyHidden,
        hiddenByAncestor,
    };
}

/** Check whether a category is hidden directly or through an ancestor. */
export function getCategoryHiddenStateInTree(
    tree: Category[],
    categoryId: number | null | undefined,
): CategoryHiddenState {
    if (categoryId == null) {
        return {
            hidden: false,
            directlyHidden: false,
            hiddenByAncestor: false,
        };
    }

    return getCategoryHiddenStateFromPath(findCategoryPath(tree, categoryId));
}

/** Check if a category (or any ancestor) is hidden in the tree. */
export function isCategoryHiddenInTree(
    tree: Category[],
    categoryId: number | null | undefined,
): boolean {
    return getCategoryHiddenStateInTree(tree, categoryId).hidden;
}

/** Return a new tree with a single image updated by ID. */
export function updateImageInTree(
    tree: Category[],
    imageId: number,
    updater: (image: ImageItem) => ImageItem,
): Category[] {
    let changed = false;
    const nextTree = tree.map((category) => {
        let categoryChanged = false;

        const nextImages = category.images.map((image) => {
            if (image.id !== imageId) return image;
            categoryChanged = true;
            return updater(image);
        });

        const nextChildren = updateImageInTree(category.children, imageId, updater);
        if (nextChildren !== category.children) {
            categoryChanged = true;
        }

        if (!categoryChanged) return category;

        changed = true;
        return {
            ...category,
            images: nextImages,
            children: nextChildren,
        };
    });

    return changed ? nextTree : tree;
}

/** Walk the category tree following an ordered list of IDs to reconstruct a path. */
export function resolveCategoryPath(tree: Category[], ids: number[]): Category[] {
    const result: Category[] = [];
    let current = tree;
    for (const id of ids) {
        const cat = current.find((c) => c.id === id);
        if (!cat) break;
        result.push(cat);
        current = cat.children;
    }
    return result;
}

import { useState, useCallback, useMemo } from "react";
import {
    createCategory as apiCreateCategory,
    deleteCategory as apiDeleteCategory,
    updateCategory as apiUpdateCategory,
    reorderCategories as apiReorderCategories,
    updateImage as apiUpdateImage,
    userMessage,
} from "./api";
import { findImageInTree, findCategoryPath } from "./treeUtils";
import type { Category, ImageItem } from "./types";

export interface UseCategoryActionsDeps {
    categories: Category[];
    uncategorizedImages: ImageItem[];
    loadCategories: () => Promise<void>;
    loadUncategorizedImages: (opts?: { signal?: AbortSignal }) => Promise<void>;
    currentCategories: Category[];
    ancestorProgramIds: number[];
    getPathRestriction: (depth?: number) => number[];
    path: Category[];
    setPath: React.Dispatch<React.SetStateAction<Category[]>>;
    editNameCategory: Category | null;
    setErrorSnack: React.Dispatch<React.SetStateAction<string | null>>;
    setMoveSnack: React.Dispatch<
        React.SetStateAction<{ message: string; onUndo: () => void } | null>
    >;
}

export function useCategoryActions({
    categories,
    uncategorizedImages,
    loadCategories,
    loadUncategorizedImages,
    currentCategories,
    ancestorProgramIds,
    getPathRestriction,
    path,
    setPath,
    editNameCategory,
    setErrorSnack,
    setMoveSnack,
}: UseCategoryActionsDeps) {
    const [moveCatOpen, setMoveCatOpen] = useState(false);
    const [movingCategory, setMovingCategory] = useState<Category | null>(null);

    const editCategoryContext = useMemo(() => {
        const fallback = {
            siblingNames: [] as string[],
            inheritedProgramIds: [] as number[],
            freshLabel: editNameCategory?.label ?? "",
            freshProgramIds: editNameCategory?.programIds ?? [],
        };
        if (!editNameCategory) return fallback;
        const isBreadcrumbCategory =
            path.length > 0 && path[path.length - 1].id === editNameCategory.id;
        if (isBreadcrumbCategory) {
            let parentChildren = categories;
            for (let i = 0; i < path.length - 1; i++) {
                const found = parentChildren.find((c) => c.id === path[i].id);
                if (!found) break;
                parentChildren = found.children;
            }
            const freshCat = parentChildren.find((c) => c.id === editNameCategory.id);
            const siblingNames = parentChildren
                .filter((c) => c.id !== editNameCategory.id)
                .map((c) => c.label);
            return {
                siblingNames,
                inheritedProgramIds: getPathRestriction(path.length - 1),
                freshLabel: freshCat?.label ?? editNameCategory.label,
                freshProgramIds: freshCat?.programIds ?? editNameCategory.programIds,
            };
        }
        const freshChild = currentCategories.find((c) => c.id === editNameCategory.id);
        return {
            siblingNames: currentCategories
                .filter((c) => c.id !== editNameCategory.id)
                .map((c) => c.label),
            inheritedProgramIds: ancestorProgramIds,
            freshLabel: freshChild?.label ?? editNameCategory.label,
            freshProgramIds: freshChild?.programIds ?? editNameCategory.programIds,
        };
    }, [editNameCategory, path, categories, currentCategories, ancestorProgramIds, getPathRestriction]);

    const addCategoryInline = useCallback(
        async (
            label: string,
            parentId: number | null,
            programIds?: number[],
        ): Promise<number | void> => {
            const body: Parameters<typeof apiCreateCategory>[0] = {
                label,
                parent_id: parentId,
            };
            if (programIds !== undefined) body.program_ids = programIds;
            const created = await apiCreateCategory(body);
            await loadCategories();
            loadUncategorizedImages();
            return created.id;
        },
        [loadCategories, loadUncategorizedImages],
    );

    const deleteCategoryInline = useCallback(
        async (categoryId: number) => {
            try {
                await apiDeleteCategory(categoryId);
                setPath((prev) => {
                    const idx = prev.findIndex((seg) => seg.id === categoryId);
                    return idx >= 0 ? prev.slice(0, idx) : prev;
                });
                await loadCategories();
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to delete category", err);
                setErrorSnack(userMessage(err, "Failed to delete category."));
            }
        },
        [loadCategories, loadUncategorizedImages, setPath, setErrorSnack],
    );

    const editCategoryInline = useCallback(
        async (
            categoryId: number,
            newLabel: string,
            programIds?: number[],
        ) => {
            const body: Parameters<typeof apiUpdateCategory>[1] = {
                label: newLabel,
            };
            if (programIds !== undefined) body.program_ids = programIds;
            await apiUpdateCategory(categoryId, body);
            await loadCategories();
        },
        [loadCategories],
    );

    const toggleCategoryVisibility = useCallback(
        async (categoryId: number) => {
            try {
                const catPath = findCategoryPath(categories, categoryId);
                const current = catPath?.[catPath.length - 1];
                await apiUpdateCategory(categoryId, {
                    status:
                        current?.status === "hidden" ? "active" : "hidden",
                });
                await loadCategories();
            } catch (err) {
                console.error("Failed to toggle category visibility", err);
                setErrorSnack(userMessage(err, "Failed to toggle category visibility."));
            }
        },
        [categories, loadCategories, setErrorSnack],
    );

    const reorderCategoriesInline = useCallback(
        async (
            items: Array<{
                id: number;
                parent_id: number | null;
                sort_order: number;
            }>,
        ) => {
            try {
                await apiReorderCategories(items);
                await loadCategories();
            } catch (err) {
                console.error("Failed to reorder categories", err);
                setErrorSnack(userMessage(err, "Failed to reorder categories."));
            }
        },
        [loadCategories, setErrorSnack],
    );

    const handleMoveCategory = useCallback(
        async (categoryId: number, newParentId: number | null) => {
            try {
                await apiUpdateCategory(categoryId, { parent_id: newParentId });
                setMoveCatOpen(false);
                setMovingCategory(null);
                await loadCategories();
            } catch (err) {
                console.error("Failed to move category", err);
                setErrorSnack(userMessage(err, "Failed to move category."));
            }
        },
        [loadCategories, setErrorSnack],
    );

    const handleRequestMoveCategory = useCallback((cat: Category) => {
        setMovingCategory(cat);
        setMoveCatOpen(true);
    }, []);

    const handleDropImageOnCategory = useCallback(
        async (imageId: number, categoryId: number) => {
            try {
                const found = findImageInTree(categories, imageId);
                const img =
                    found?.image ??
                    uncategorizedImages.find((i) => i.id === imageId);
                if (!img) return;
                if (img.categoryId === categoryId) return;
                const prevCategoryId = img.categoryId ?? null;
                const targetName =
                    findCategoryPath(categories, categoryId)?.at(-1)
                        ?.label ?? "category";
                const updated = await apiUpdateImage(
                    imageId,
                    { category_id: categoryId },
                    img.version,
                );
                await loadCategories();
                loadUncategorizedImages();
                setMoveSnack({
                    message: `Moved \u201c${img.name}\u201d to \u201c${targetName}\u201d`,
                    onUndo: async () => {
                        try {
                            setMoveSnack(null);
                            await apiUpdateImage(
                                imageId,
                                { category_id: prevCategoryId },
                                updated.version,
                            );
                            await loadCategories();
                            loadUncategorizedImages();
                        } catch (undoErr) {
                            setErrorSnack(
                                userMessage(
                                    undoErr,
                                    "Failed to undo move.",
                                ),
                            );
                        }
                    },
                });
            } catch (err) {
                console.error("Failed to move image via drag-and-drop", err);
                setErrorSnack(
                    userMessage(err, "Failed to move image to category."),
                );
            }
        },
        [categories, uncategorizedImages, loadCategories, loadUncategorizedImages, setMoveSnack, setErrorSnack],
    );

    const handleDropCategoryOnCategory = useCallback(
        async (draggedCategoryId: number, targetCategoryId: number) => {
            try {
                const draggedPath = findCategoryPath(
                    categories,
                    draggedCategoryId,
                );
                const prevParentId =
                    draggedPath && draggedPath.length >= 2
                        ? draggedPath[draggedPath.length - 2].id
                        : null;
                const draggedName =
                    draggedPath?.at(-1)?.label ?? "category";
                const targetName =
                    findCategoryPath(categories, targetCategoryId)
                        ?.at(-1)?.label ?? "category";
                await apiUpdateCategory(draggedCategoryId, {
                    parent_id: targetCategoryId,
                });
                await loadCategories();
                setMoveSnack({
                    message: `Moved \u201c${draggedName}\u201d into \u201c${targetName}\u201d`,
                    onUndo: async () => {
                        try {
                            setMoveSnack(null);
                            await apiUpdateCategory(draggedCategoryId, {
                                parent_id: prevParentId,
                            });
                            await loadCategories();
                        } catch (undoErr) {
                            setErrorSnack(
                                userMessage(
                                    undoErr,
                                    "Failed to undo move.",
                                ),
                            );
                        }
                    },
                });
            } catch (err) {
                console.error(
                    "Failed to move category via drag-and-drop",
                    err,
                );
                setErrorSnack(
                    userMessage(err, "Failed to move category."),
                );
            }
        },
        [categories, loadCategories, setMoveSnack, setErrorSnack],
    );

    const handleSetCardImage = useCallback(
        async (categoryId: number, imageId: number | null) => {
            try {
                const findCat = (cats: Category[]): Category | null => {
                    for (const c of cats) {
                        if (c.id === categoryId) return c;
                        const found = findCat(c.children);
                        if (found) return found;
                    }
                    return null;
                };
                const existing = findCat(categories)?.metadataExtra ?? {};
                await apiUpdateCategory(categoryId, {
                    metadata_extra: { ...existing, card_image_id: imageId },
                });
                await loadCategories();
            } catch (err) {
                console.error("Failed to set card image", err);
                setErrorSnack(userMessage(err, "Failed to set card image."));
            }
        },
        [loadCategories, categories, setErrorSnack],
    );

    return {
        moveCatOpen,
        setMoveCatOpen,
        movingCategory,
        setMovingCategory,
        editCategoryContext,
        addCategoryInline,
        deleteCategoryInline,
        editCategoryInline,
        toggleCategoryVisibility,
        reorderCategoriesInline,
        handleMoveCategory,
        handleRequestMoveCategory,
        handleDropImageOnCategory,
        handleDropCategoryOnCategory,
        handleSetCardImage,
    };
}

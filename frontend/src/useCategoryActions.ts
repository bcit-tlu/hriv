import { useState, useCallback, useMemo } from "react";
import {
    createCategory as apiCreateCategory,
    deleteCategory as apiDeleteCategory,
    updateCategory as apiUpdateCategory,
    reorderCategories as apiReorderCategories,
    reorderImages as apiReorderImages,
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
    ancestorGroupIds: number[];
    getPathGroupRestriction: (depth?: number) => number[];
    path: Category[];
    setPath: React.Dispatch<React.SetStateAction<Category[]>>;
    editNameCategory: Category | null;
    setErrorSnack: React.Dispatch<React.SetStateAction<string | null>>;
    /** Surfaces non-blocking category advisories (e.g. program/group intersection). */
    setWarningSnack?: React.Dispatch<React.SetStateAction<string | null>>;
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
    ancestorGroupIds,
    getPathGroupRestriction,
    path,
    setPath,
    editNameCategory,
    setErrorSnack,
    setWarningSnack,
    setMoveSnack,
}: UseCategoryActionsDeps) {
    const [moveCatOpen, setMoveCatOpen] = useState(false);
    const [movingCategory, setMovingCategory] = useState<Category | null>(null);

    const editCategoryContext = useMemo(() => {
        const fallback = {
            siblingNames: [] as string[],
            inheritedProgramIds: [] as number[],
            inheritedGroupIds: [] as number[],
            freshLabel: editNameCategory?.label ?? "",
            freshProgramIds: editNameCategory?.programIds ?? [],
            freshGroupIds: editNameCategory?.groupIds ?? [],
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
                inheritedGroupIds: getPathGroupRestriction(path.length - 1),
                freshLabel: freshCat?.label ?? editNameCategory.label,
                freshProgramIds: freshCat?.programIds ?? editNameCategory.programIds,
                freshGroupIds: freshCat?.groupIds ?? editNameCategory.groupIds,
            };
        }
        const freshChild = currentCategories.find((c) => c.id === editNameCategory.id);
        return {
            siblingNames: currentCategories
                .filter((c) => c.id !== editNameCategory.id)
                .map((c) => c.label),
            inheritedProgramIds: ancestorProgramIds,
            inheritedGroupIds: ancestorGroupIds,
            freshLabel: freshChild?.label ?? editNameCategory.label,
            freshProgramIds: freshChild?.programIds ?? editNameCategory.programIds,
            freshGroupIds: freshChild?.groupIds ?? editNameCategory.groupIds,
        };
    }, [editNameCategory, path, categories, currentCategories, ancestorProgramIds, getPathRestriction, ancestorGroupIds, getPathGroupRestriction]);

    const addCategoryInline = useCallback(
        async (
            label: string,
            parentId: number | null,
            programIds?: number[],
            groupIds?: number[],
        ): Promise<number | void> => {
            const body: Parameters<typeof apiCreateCategory>[0] = {
                label,
                parent_id: parentId,
            };
            if (programIds !== undefined) body.program_ids = programIds;
            if (groupIds !== undefined) body.group_ids = groupIds;
            const created = await apiCreateCategory(body);
            if (created.warnings?.length && setWarningSnack) {
                setWarningSnack(created.warnings.map((w) => w.message).join(" "));
            }
            await loadCategories();
            loadUncategorizedImages();
            return created.id;
        },
        [loadCategories, loadUncategorizedImages, setWarningSnack],
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
            groupIds?: number[],
        ) => {
            const body: Parameters<typeof apiUpdateCategory>[1] = {
                label: newLabel,
            };
            if (programIds !== undefined) body.program_ids = programIds;
            if (groupIds !== undefined) body.group_ids = groupIds;
            const catPath = findCategoryPath(categories, categoryId);
            const version = catPath?.at(-1)?.version;
            const updated = await apiUpdateCategory(categoryId, body, version);
            if (updated.warnings?.length && setWarningSnack) {
                setWarningSnack(updated.warnings.map((w) => w.message).join(" "));
            }
            await loadCategories();
        },
        [categories, loadCategories, setWarningSnack],
    );

    const toggleCategoryVisibility = useCallback(
        async (categoryId: number) => {
            try {
                const catPath = findCategoryPath(categories, categoryId);
                const current = catPath?.[catPath.length - 1];
                const newStatus =
                    current?.status === "hidden" ? "active" : "hidden";
                await apiUpdateCategory(categoryId, {
                    status: newStatus,
                }, current?.version);
                await loadCategories();
                setPath((prev) =>
                    prev.map((p) =>
                        p.id === categoryId ? { ...p, status: newStatus } : p,
                    ),
                );
            } catch (err) {
                console.error("Failed to toggle category visibility", err);
                setErrorSnack(userMessage(err, "Failed to toggle category visibility."));
            }
        },
        [categories, loadCategories, setErrorSnack, setPath],
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
            } catch (err) {
                console.error("Failed to reorder categories", err);
                setErrorSnack(userMessage(err, "Failed to reorder categories."));
                throw err;
            }
        },
        [setErrorSnack],
    );

    const reorderImagesInline = useCallback(
        async (items: Array<{ id: number; sort_order: number }>) => {
            try {
                await apiReorderImages(items);
            } catch (err) {
                console.error("Failed to reorder images", err);
                setErrorSnack(userMessage(err, "Failed to reorder images."));
                throw err;
            }
        },
        [setErrorSnack],
    );

    const handleMoveCategory = useCallback(
        async (categoryId: number, newParentId: number | null) => {
            try {
                const catPath = findCategoryPath(categories, categoryId);
                const version = catPath?.at(-1)?.version;
                await apiUpdateCategory(categoryId, { parent_id: newParentId }, version);
                setMoveCatOpen(false);
                setMovingCategory(null);
                await loadCategories();
            } catch (err) {
                console.error("Failed to move category", err);
                setErrorSnack(userMessage(err, "Failed to move category."));
            }
        },
        [categories, loadCategories, setErrorSnack],
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
                const draggedVersion = draggedPath?.at(-1)?.version;
                const resp = await apiUpdateCategory(draggedCategoryId, {
                    parent_id: targetCategoryId,
                }, draggedVersion);
                await loadCategories();
                setMoveSnack({
                    message: `Moved \u201c${draggedName}\u201d into \u201c${targetName}\u201d`,
                    onUndo: async () => {
                        try {
                            setMoveSnack(null);
                            await apiUpdateCategory(draggedCategoryId, {
                                parent_id: prevParentId,
                            }, resp.version);
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
                const cat = findCat(categories);
                const existing = cat?.metadataExtra ?? {};
                await apiUpdateCategory(categoryId, {
                    metadata_extra: { ...existing, card_image_id: imageId },
                }, cat?.version);
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
        reorderImagesInline,
        handleMoveCategory,
        handleRequestMoveCategory,
        handleDropImageOnCategory,
        handleDropCategoryOnCategory,
        handleSetCardImage,
    };
}

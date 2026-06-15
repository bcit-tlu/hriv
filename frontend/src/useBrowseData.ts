import { useState, useCallback, useRef, useMemo } from "react";
import {
    fetchCategoryTree,
    fetchUncategorizedImages,
    fetchPrograms as apiFetchPrograms,
    fetchGroups as apiFetchGroups,
} from "./api";
import type { ApiCategoryTree, ApiImage } from "./api";
import type { Category, Group, ImageItem, Program, User } from "./types";
import { narrowProgramIds, narrowGroupIds, resolvePathNode } from "./categoryUtils";
import { apiGroupToGroup } from "./groupUtils";
import { useBackgroundRefresh } from "./useBackgroundRefresh";

function apiImageToItem(img: ApiImage): ImageItem {
    return {
        id: img.id,
        name: img.name,
        thumb: img.thumb,
        tileSources: img.tile_sources,
        categoryId: img.category_id,
        copyright: img.copyright,
        note: img.note,
        active: img.active,
        sortOrder: img.sort_order,
        version: img.version,
        createdAt: img.created_at,
        updatedAt: img.updated_at,
        metadataExtra: img.metadata_extra,
        width: img.width,
        height: img.height,
        fileSize: img.file_size,
    };
}

export function apiTreeToCategory(node: ApiCategoryTree): Category {
    const meta = node.metadata_extra as Record<string, unknown> | null;
    return {
        id: node.id,
        label: node.label,
        parentId: node.parent_id,
        children: node.children.map(apiTreeToCategory),
        images: node.images.map(apiImageToItem),
        programIds: node.program_ids ?? [],
        groupIds: node.group_ids ?? [],
        status: node.status,
        sortOrder: node.sort_order,
        version: node.version,
        cardImageId:
            typeof meta?.card_image_id === "number" ? meta.card_image_id : null,
        metadataExtra: meta ?? null,
    };
}

export interface UseBrowseDataDeps {
    path: Category[];
    currentUser: User | null;
}

export function useBrowseData({ path, currentUser }: UseBrowseDataDeps) {
    const [categories, setCategories] = useState<Category[]>([]);
    const [categoriesLoading, setCategoriesLoading] = useState(true);
    const [uncategorizedImages, setUncategorizedImages] = useState<ImageItem[]>(
        [],
    );
    const [programs, setPrograms] = useState<Program[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const uncategorizedLoaded = useRef(false);

    // Ref holds the invalidateBackground function once the hook mounts.
    // loadCategories reads it to cancel in-flight background requests on
    // foreground fetches without requiring every call site to change.
    const invalidateRef = useRef<(() => void) | null>(null);

    const loadCategories = useCallback(
        async (opts?: { silent?: boolean; signal?: AbortSignal }) => {
            const { silent = false, signal } = opts ?? {};
            if (!signal) invalidateRef.current?.();
            try {
                if (!silent) setCategoriesLoading(true);
                const tree = await fetchCategoryTree(
                    signal ? { signal } : undefined,
                );
                if (signal?.aborted) return;
                setCategories(tree.map(apiTreeToCategory));
            } catch (err) {
                if (signal?.aborted) return;
                console.error("Failed to load categories", err);
            } finally {
                if (!silent) setCategoriesLoading(false);
            }
        },
        [],
    );

    const loadUncategorizedImages = useCallback(
        async (opts?: { signal?: AbortSignal }) => {
            const { signal } = opts ?? {};
            try {
                const imgs = await fetchUncategorizedImages(
                    signal ? { signal } : undefined,
                );
                if (signal?.aborted) return;
                setUncategorizedImages(imgs.map(apiImageToItem));
                uncategorizedLoaded.current = true;
            } catch (err) {
                if (signal?.aborted) return;
                console.error("Failed to load uncategorized images", err);
                uncategorizedLoaded.current = true;
            }
        },
        [],
    );

    const loadPrograms = useCallback(async () => {
        try {
            const p = await apiFetchPrograms();
            setPrograms(
                p.map((pg) => ({
                    id: pg.id,
                    name: pg.name,
                    oidc_group: pg.oidc_group,
                    created_at: pg.created_at,
                    updated_at: pg.updated_at,
                })),
            );
        } catch {
            // Silently ignore — programs are non-critical for initial load
        }
    }, []);

    const loadGroups = useCallback(async () => {
        try {
            const g = await apiFetchGroups();
            setGroups(g.map(apiGroupToGroup));
        } catch {
            // Silently ignore — groups are non-critical for initial load
        }
    }, []);

    const refreshCategories = useCallback(async (): Promise<Category[]> => {
        invalidateRef.current?.();
        // Force bypass the browser HTTP cache so we always get the
        // freshly-committed sort_order values after a reorder.  Without
        // this the browser may serve a stale 304-backed response whose
        // ETag was computed before the reorder transaction committed.
        const tree = await fetchCategoryTree({ cache: "reload" });
        const cats = tree.map(apiTreeToCategory);
        setCategories(cats);
        return cats;
    }, []);

    const refreshUncategorizedImages = useCallback(
        async (): Promise<ImageItem[]> => {
            const imgs = await fetchUncategorizedImages({ cache: "reload" });
            const items = imgs.map(apiImageToItem);
            setUncategorizedImages(items);
            uncategorizedLoaded.current = true;
            return items;
        },
        [],
    );

    // Background refresh: re-fetch categories and uncategorized images every
    // 30 s while the tab is visible.  The category tree endpoint returns
    // ETag + Cache-Control: private, no-cache so the browser's default fetch
    // cache mode transparently sends If-None-Match and receives 304 when
    // nothing changed.
    const backgroundRefresh = useCallback(
        async (signal: AbortSignal) => {
            await loadCategories({ silent: true, signal });
            await loadUncategorizedImages({ signal });
        },
        [loadCategories, loadUncategorizedImages],
    );
    const invalidateBackground = useBackgroundRefresh(
        backgroundRefresh,
        currentUser != null,
    );
    invalidateRef.current = invalidateBackground;

    // Resolve the live children/images from the categories state tree
    // so newly added categories appear immediately.
    const { cats: resolvedCategories, imgs: currentImages } = useMemo(
        () => resolvePathNode(categories, path),
        [categories, path],
    );

    // Walk the categories tree along the given path segments applying narrowing
    // (intersection) semantics. `depth` controls how many path segments to
    // traverse (defaults to all).
    const getPathRestriction = useCallback(
        (depth?: number): number[] => {
            const ancestors: Category[] = [];
            let node = categories;
            const limit = depth ?? path.length;
            for (let i = 0; i < limit; i++) {
                const found = node.find((c) => c.id === path[i].id);
                if (!found) break;
                ancestors.push(found);
                node = found.children;
            }
            return narrowProgramIds(ancestors);
        },
        [categories, path],
    );

    const ancestorProgramIds = useMemo(
        () => getPathRestriction(),
        [getPathRestriction],
    );

    // Group analogue of getPathRestriction: walk the path applying the same
    // ancestor-narrowing semantics to the (independent) group dimension.
    const getPathGroupRestriction = useCallback(
        (depth?: number): number[] => {
            const ancestors: Category[] = [];
            let node = categories;
            const limit = depth ?? path.length;
            for (let i = 0; i < limit; i++) {
                const found = node.find((c) => c.id === path[i].id);
                if (!found) break;
                ancestors.push(found);
                node = found.children;
            }
            return narrowGroupIds(ancestors);
        },
        [categories, path],
    );

    const ancestorGroupIds = useMemo(
        () => getPathGroupRestriction(),
        [getPathGroupRestriction],
    );

    // Filter out hidden categories for students in browse mode
    const isStudent = currentUser?.role === "student";
    const currentCategories = useMemo(
        () =>
            isStudent
                ? resolvedCategories.filter((c) => c.status !== "hidden")
                : resolvedCategories,
        [isStudent, resolvedCategories],
    );

    return {
        categories,
        categoriesLoading,
        setCategories,
        uncategorizedImages,
        uncategorizedLoaded,
        setUncategorizedImages,
        programs,
        groups,
        setGroups,
        loadCategories,
        loadUncategorizedImages,
        loadPrograms,
        loadGroups,
        refreshCategories,
        refreshUncategorizedImages,
        currentImages,
        getPathRestriction,
        ancestorProgramIds,
        getPathGroupRestriction,
        ancestorGroupIds,
        currentCategories,
    };
}

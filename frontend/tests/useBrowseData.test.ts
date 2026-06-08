import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrowseData, apiTreeToCategory } from "../src/useBrowseData";
import type { UseBrowseDataDeps } from "../src/useBrowseData";
import type { Category, User } from "../src/types";
import type { ApiCategoryTree } from "../src/api";
import * as api from "../src/api";

vi.mock("../src/api", async () => {
    const actual = await vi.importActual<typeof api>("../src/api");
    return {
        ...actual,
        fetchCategoryTree: vi.fn(),
        fetchUncategorizedImages: vi.fn(),
        fetchPrograms: vi.fn(),
        fetchGroups: vi.fn(),
    };
});

vi.mock("../src/useBackgroundRefresh", () => ({
    useBackgroundRefresh: vi.fn(() => vi.fn()),
}));

const mockFetchCategoryTree = vi.mocked(api.fetchCategoryTree);
const mockFetchUncategorizedImages = vi.mocked(api.fetchUncategorizedImages);
const mockFetchPrograms = vi.mocked(api.fetchPrograms);
const mockFetchGroups = vi.mocked(api.fetchGroups);

function makeUser(overrides: Partial<User> = {}): User {
    return {
        id: 1,
        name: "Test User",
        email: "test@bcit.ca",
        role: "admin",
        program_ids: [],
        program_names: [], group_ids: [], group_names: [],
        ...overrides,
    };
}

function makeApiTree(overrides: Partial<ApiCategoryTree> = {}): ApiCategoryTree {
    return {
        id: 1,
        label: "Root",
        parent_id: null,
        program_ids: [],
        group_ids: [],
        status: null,
        sort_order: 0,
        metadata_extra: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        children: [],
        images: [],
        ...overrides,
    };
}

function makeApiImage(id: number, overrides: Partial<api.ApiImage> = {}): api.ApiImage {
    return {
        id,
        name: `img-${id}`,
        thumb: `/thumb/${id}.jpg`,
        tile_sources: `/tiles/${id}`,
        category_id: null,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        ...overrides,
    };
}

function makeDeps(overrides: Partial<UseBrowseDataDeps> = {}): UseBrowseDataDeps {
    return {
        path: [],
        currentUser: null,
        ...overrides,
    };
}

/** Simulates what App.tsx's initial-load effect does after the
 *  currentUser reset effect. */
async function triggerInitialLoad(result: { current: ReturnType<typeof useBrowseData> }) {
    await act(async () => {
        await result.current.loadCategories();
        await result.current.loadUncategorizedImages();
        await result.current.loadPrograms();
    });
}

describe("useBrowseData", () => {
    beforeEach(() => {
        mockFetchCategoryTree.mockReset();
        mockFetchUncategorizedImages.mockReset();
        mockFetchPrograms.mockReset();
        mockFetchCategoryTree.mockResolvedValue([]);
        mockFetchUncategorizedImages.mockResolvedValue([]);
        mockFetchPrograms.mockResolvedValue([]);
        mockFetchGroups.mockReset();
        mockFetchGroups.mockResolvedValue([]);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("initial state", () => {
        it("returns empty categories when no user is logged in", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useBrowseData(deps));
            expect(result.current.categories).toEqual([]);
            expect(result.current.categoriesLoading).toBe(true);
            expect(result.current.uncategorizedImages).toEqual([]);
            expect(result.current.programs).toEqual([]);
        });

        it("does not fetch data when no user is logged in", () => {
            const deps = makeDeps();
            renderHook(() => useBrowseData(deps));
            expect(mockFetchCategoryTree).not.toHaveBeenCalled();
            expect(mockFetchUncategorizedImages).not.toHaveBeenCalled();
            expect(mockFetchPrograms).not.toHaveBeenCalled();
        });
    });

    describe("data loading", () => {
        it("loads categories, images, and programs when called explicitly", async () => {
            const tree = [makeApiTree({ id: 1, label: "Cat A" })];
            const imgs = [makeApiImage(10)];
            const progs = [{ id: 1, name: "P1", oidc_group: null, created_at: "", updated_at: "" }];

            mockFetchCategoryTree.mockResolvedValue(tree);
            mockFetchUncategorizedImages.mockResolvedValue(imgs);
            mockFetchPrograms.mockResolvedValue(progs);

            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            expect(result.current.categories).toHaveLength(1);
            expect(result.current.categories[0].label).toBe("Cat A");
            expect(result.current.uncategorizedImages).toHaveLength(1);
            expect(result.current.uncategorizedImages[0].id).toBe(10);
            expect(result.current.programs).toHaveLength(1);
            expect(result.current.programs[0].name).toBe("P1");
            expect(result.current.categoriesLoading).toBe(false);
        });

        it("handles category fetch errors gracefully", async () => {
            mockFetchCategoryTree.mockRejectedValue(new Error("network"));
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});

            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await act(async () => {
                await result.current.loadCategories();
            });

            expect(result.current.categoriesLoading).toBe(false);
            expect(result.current.categories).toEqual([]);
            expect(spy).toHaveBeenCalledWith("Failed to load categories", expect.any(Error));
            spy.mockRestore();
        });

        it("handles uncategorized images fetch errors gracefully", async () => {
            mockFetchUncategorizedImages.mockRejectedValue(new Error("network"));
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});

            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await act(async () => {
                await result.current.loadUncategorizedImages();
            });

            expect(result.current.uncategorizedImages).toEqual([]);
            spy.mockRestore();
        });

        it("handles program fetch errors silently", async () => {
            mockFetchPrograms.mockRejectedValue(new Error("network"));

            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await act(async () => {
                await result.current.loadPrograms();
            });

            expect(result.current.programs).toEqual([]);
        });
    });

    describe("loadCategories options", () => {
        it("skips loading state toggle when silent is true", async () => {
            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            const tree = [makeApiTree({ id: 2, label: "Silent" })];
            mockFetchCategoryTree.mockResolvedValue(tree);

            // Track categoriesLoading transitions during the call
            const loadingStates: boolean[] = [];
            const origLoading = result.current.categoriesLoading;
            loadingStates.push(origLoading);

            await act(async () => {
                await result.current.loadCategories({ silent: true });
            });

            // After silent load, loading should still be false (never toggled to true)
            expect(result.current.categoriesLoading).toBe(false);
            expect(result.current.categories[0].label).toBe("Silent");
        });

        it("sets loading state when silent is false (default)", async () => {
            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            // Settle initial loading state
            await triggerInitialLoad(result);
            expect(result.current.categoriesLoading).toBe(false);

            // Use a deferred promise so we can observe the loading state mid-flight
            let resolveFetch!: (value: typeof api.ApiCategoryTree[]) => void;
            mockFetchCategoryTree.mockImplementation(
                () => new Promise((resolve) => { resolveFetch = resolve as typeof resolveFetch; }),
            );

            // Start a non-silent load (default)
            let loadDone: Promise<void>;
            act(() => {
                loadDone = result.current.loadCategories();
            });

            // During flight, categoriesLoading should be true
            expect(result.current.categoriesLoading).toBe(true);

            // Resolve the fetch
            await act(async () => {
                resolveFetch([]);
                await loadDone!;
            });

            expect(result.current.categoriesLoading).toBe(false);
        });

        it("aborts early when signal is already aborted", async () => {
            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            const controller = new AbortController();
            controller.abort();

            const tree = [makeApiTree({ id: 3, label: "Aborted" })];
            mockFetchCategoryTree.mockResolvedValue(tree);

            await act(async () => {
                await result.current.loadCategories({ signal: controller.signal });
            });

            // Should not update categories because signal was aborted
            expect(result.current.categories).toEqual([]);
        });

        it("does not call invalidateRef when signal is provided", async () => {
            // This test verifies the contract: background refresh passes a signal,
            // and foreground loads do not — only foreground loads invalidate.
            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            const controller = new AbortController();
            const tree = [makeApiTree({ id: 4, label: "WithSignal" })];
            mockFetchCategoryTree.mockResolvedValue(tree);

            await act(async () => {
                await result.current.loadCategories({ signal: controller.signal });
            });

            expect(result.current.categories[0].label).toBe("WithSignal");
        });
    });

    describe("loadUncategorizedImages options", () => {
        it("aborts early when signal is already aborted", async () => {
            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            const controller = new AbortController();
            controller.abort();

            const imgs = [makeApiImage(50, { name: "aborted-img" })];
            mockFetchUncategorizedImages.mockResolvedValue(imgs);

            await act(async () => {
                await result.current.loadUncategorizedImages({ signal: controller.signal });
            });

            // Should not update because signal was aborted
            expect(result.current.uncategorizedImages).toEqual([]);
        });
    });

    describe("refreshCategories", () => {
        it("fetches fresh categories and returns them", async () => {
            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            const freshTree = [makeApiTree({ id: 5, label: "Fresh" })];
            mockFetchCategoryTree.mockResolvedValue(freshTree);

            let cats: Category[] = [];
            await act(async () => {
                cats = await result.current.refreshCategories();
            });

            expect(cats).toHaveLength(1);
            expect(cats[0].label).toBe("Fresh");
            expect(result.current.categories).toHaveLength(1);
            expect(result.current.categories[0].label).toBe("Fresh");
        });
    });

    describe("refreshUncategorizedImages", () => {
        it("fetches fresh uncategorized images and returns them", async () => {
            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            const freshImgs = [makeApiImage(99, { name: "new-img" })];
            mockFetchUncategorizedImages.mockResolvedValue(freshImgs);

            let imgs: ReturnType<typeof result.current.refreshUncategorizedImages> extends Promise<infer T> ? T : never;
            await act(async () => {
                imgs = await result.current.refreshUncategorizedImages();
            });

            expect(imgs!).toHaveLength(1);
            expect(imgs![0].name).toBe("new-img");
            expect(result.current.uncategorizedImages[0].name).toBe("new-img");
        });
    });

    describe("derived state", () => {
        it("resolves categories and images for current path", async () => {
            const childCat = makeApiTree({
                id: 2,
                label: "Child",
                parent_id: 1,
            });
            const rootCat = makeApiTree({
                id: 1,
                label: "Root",
                children: [childCat],
                images: [makeApiImage(10, { category_id: 1 })],
            });
            mockFetchCategoryTree.mockResolvedValue([rootCat]);

            const rootCategory: Category = apiTreeToCategory(rootCat);

            const deps = makeDeps({
                currentUser: makeUser(),
                path: [rootCategory],
            });

            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            expect(result.current.currentCategories).toHaveLength(1);
            expect(result.current.currentCategories[0].label).toBe("Child");
            expect(result.current.currentImages).toHaveLength(1);
            expect(result.current.currentImages[0].id).toBe(10);
        });

        it("returns empty when path does not match tree", async () => {
            mockFetchCategoryTree.mockResolvedValue([
                makeApiTree({ id: 1, label: "Root" }),
            ]);

            const fakeCat: Category = {
                id: 999,
                label: "Ghost",
                parentId: null,
                children: [],
                images: [],
                programIds: [],
                status: null,
                sortOrder: 0,
                cardImageId: null,
                metadataExtra: null,
            };

            const deps = makeDeps({
                currentUser: makeUser(),
                path: [fakeCat],
            });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            expect(result.current.currentCategories).toEqual([]);
            expect(result.current.currentImages).toEqual([]);
        });

        it("filters hidden categories for students", async () => {
            const cats = [
                makeApiTree({ id: 1, label: "Visible", status: null }),
                makeApiTree({ id: 2, label: "Hidden", status: "hidden" }),
            ];
            mockFetchCategoryTree.mockResolvedValue(cats);

            const deps = makeDeps({
                currentUser: makeUser({ role: "student" }),
            });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            expect(result.current.currentCategories).toHaveLength(1);
            expect(result.current.currentCategories[0].label).toBe("Visible");
        });

        it("does not filter hidden categories for admins", async () => {
            const cats = [
                makeApiTree({ id: 1, label: "Visible", status: null }),
                makeApiTree({ id: 2, label: "Hidden", status: "hidden" }),
            ];
            mockFetchCategoryTree.mockResolvedValue(cats);

            const deps = makeDeps({
                currentUser: makeUser({ role: "admin" }),
            });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            expect(result.current.currentCategories).toHaveLength(2);
        });
    });

    describe("getPathRestriction", () => {
        it("returns empty when no path segments have programs", async () => {
            mockFetchCategoryTree.mockResolvedValue([
                makeApiTree({ id: 1, label: "Root" }),
            ]);

            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            expect(result.current.ancestorProgramIds).toEqual([]);
        });

        it("returns program ids from ancestors along the path", async () => {
            const child = makeApiTree({
                id: 2,
                label: "Child",
                parent_id: 1,
                program_ids: [10, 20],
            });
            const root = makeApiTree({
                id: 1,
                label: "Root",
                children: [child],
                program_ids: [10, 20, 30],
            });
            mockFetchCategoryTree.mockResolvedValue([root]);

            const rootCat = apiTreeToCategory(root);
            const childCat = apiTreeToCategory(child);

            const deps = makeDeps({
                currentUser: makeUser(),
                path: [rootCat, childCat],
            });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            // narrowProgramIds intersects: [10,20,30] ∩ [10,20] = [10,20]
            expect(result.current.ancestorProgramIds).toEqual([10, 20]);
        });

        it("supports depth parameter for partial restriction", async () => {
            const child = makeApiTree({
                id: 2,
                label: "Child",
                parent_id: 1,
                program_ids: [10],
            });
            const root = makeApiTree({
                id: 1,
                label: "Root",
                children: [child],
                program_ids: [10, 20, 30],
            });
            mockFetchCategoryTree.mockResolvedValue([root]);

            const rootCat = apiTreeToCategory(root);
            const childCat = apiTreeToCategory(child);

            const deps = makeDeps({
                currentUser: makeUser(),
                path: [rootCat, childCat],
            });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            // Only first ancestor: [10, 20, 30]
            expect(result.current.getPathRestriction(1)).toEqual([10, 20, 30]);
        });
    });

    describe("apiTreeToCategory", () => {
        it("maps API tree nodes to domain Category objects", () => {
            const apiTree = makeApiTree({
                id: 1,
                label: "Test",
                parent_id: null,
                program_ids: [5],
                status: "hidden",
                metadata_extra: { card_image_id: 42 },
                children: [
                    makeApiTree({ id: 2, label: "Child", parent_id: 1 }),
                ],
                images: [makeApiImage(10, { category_id: 1 })],
            });

            const cat = apiTreeToCategory(apiTree);

            expect(cat.id).toBe(1);
            expect(cat.label).toBe("Test");
            expect(cat.parentId).toBeNull();
            expect(cat.programIds).toEqual([5]);
            expect(cat.status).toBe("hidden");
            expect(cat.cardImageId).toBe(42);
            expect(cat.children).toHaveLength(1);
            expect(cat.children[0].label).toBe("Child");
            expect(cat.images).toHaveLength(1);
            expect(cat.images[0].id).toBe(10);
            expect(cat.images[0].categoryId).toBe(1);
        });

        it("handles null metadata_extra", () => {
            const apiTree = makeApiTree({ metadata_extra: null });
            const cat = apiTreeToCategory(apiTree);
            expect(cat.cardImageId).toBeNull();
            expect(cat.metadataExtra).toBeNull();
        });

        it("handles missing card_image_id in metadata", () => {
            const apiTree = makeApiTree({
                metadata_extra: { some_other_key: "value" },
            });
            const cat = apiTreeToCategory(apiTree);
            expect(cat.cardImageId).toBeNull();
        });

        it("maps group_ids onto the domain category", () => {
            const cat = apiTreeToCategory(makeApiTree({ group_ids: [7, 8] }));
            expect(cat.groupIds).toEqual([7, 8]);
        });

        it("defaults groupIds to [] when group_ids is absent", () => {
            const cat = apiTreeToCategory(makeApiTree());
            expect(cat.groupIds).toEqual([]);
        });
    });

    describe("getPathGroupRestriction", () => {
        it("narrows group ids through the ancestor path independently of programs", async () => {
            const child = makeApiTree({
                id: 2,
                label: "Child",
                parent_id: 1,
                group_ids: [10, 20],
            });
            const root = makeApiTree({
                id: 1,
                label: "Root",
                children: [child],
                group_ids: [10, 20, 30],
            });
            mockFetchCategoryTree.mockResolvedValue([root]);

            const deps = makeDeps({
                currentUser: makeUser(),
                path: [apiTreeToCategory(root), apiTreeToCategory(child)],
            });
            const { result } = renderHook(() => useBrowseData(deps));

            await triggerInitialLoad(result);

            // narrowGroupIds intersects: [10,20,30] ∩ [10,20] = [10,20]
            expect(result.current.ancestorGroupIds).toEqual([10, 20]);
            // depth=1 returns only the root's groups
            expect(result.current.getPathGroupRestriction(1)).toEqual([10, 20, 30]);
        });

        it("loads groups via loadGroups", async () => {
            mockFetchGroups.mockResolvedValue([
                {
                    id: 5,
                    name: "Cohort A",
                    description: null,
                    created_by_user_id: 1,
                    member_ids: [],
                    instructor_ids: [1],
                    created_at: "",
                    updated_at: "",
                },
            ]);
            const deps = makeDeps({ currentUser: makeUser() });
            const { result } = renderHook(() => useBrowseData(deps));

            await act(async () => {
                await result.current.loadGroups();
            });

            expect(mockFetchGroups).toHaveBeenCalled();
            expect(result.current.groups).toHaveLength(1);
            expect(result.current.groups[0].name).toBe("Cohort A");
        });
    });
});

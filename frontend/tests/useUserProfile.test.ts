import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUserProfile } from "../src/useUserProfile";
import type { UseUserProfileDeps } from "../src/useUserProfile";
import type { User } from "../src/types";
import * as api from "../src/api";

vi.mock("../src/api", async () => {
    const actual = await vi.importActual<typeof api>("../src/api");
    return {
        ...actual,
        updateUser: vi.fn(),
    };
});

const mockUpdateUser = vi.mocked(api.updateUser);

function makeUser(overrides: Partial<User> = {}): User {
    return {
        id: 1,
        name: "Test User",
        email: "test@example.com",
        role: "admin",
        program_ids: [10, 20],
        program_names: ["Program A", "Program B"],
        group_ids: [],
        group_names: [],
        lastAccess: "2026-01-01T00:00:00Z",
        ...overrides,
    };
}

function makeDeps(overrides: Partial<UseUserProfileDeps> = {}): UseUserProfileDeps {
    return {
        currentUser: makeUser(),
        setErrorSnack: vi.fn(),
        loadPrograms: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("useUserProfile", () => {
    describe("initial state", () => {
        it("starts with profile and edit modals closed", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useUserProfile(deps));
            expect(result.current.profileOpen).toBe(false);
            expect(result.current.editModalOpen).toBe(false);
        });

        it("provides an avatarRef", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useUserProfile(deps));
            expect(result.current.avatarRef).toBeDefined();
            expect(result.current.avatarRef.current).toBeNull();
        });
    });

    describe("currentApiUser memo", () => {
        it("maps User to ApiUser shape when user exists", () => {
            const user = makeUser({
                id: 5,
                name: "Jane",
                email: "jane@test.com",
                role: "instructor",
                program_ids: [1, 2],
                program_names: ["P1", "P2"],
                group_ids: [7],
                group_names: ["Field Studies"],
                lastAccess: "2026-03-15T12:00:00Z",
            });
            const deps = makeDeps({ currentUser: user });
            const { result } = renderHook(() => useUserProfile(deps));

            expect(result.current.currentApiUser).toEqual({
                id: 5,
                name: "Jane",
                email: "jane@test.com",
                role: "instructor",
                program_ids: [1, 2],
                program_names: ["P1", "P2"],
                group_ids: [7],
                group_names: ["Field Studies"],
                last_access: "2026-03-15T12:00:00Z",
                metadata_extra: null,
                created_at: "",
                updated_at: "",
            });
        });

        it("returns null when user is null", () => {
            const deps = makeDeps({ currentUser: null });
            const { result } = renderHook(() => useUserProfile(deps));
            expect(result.current.currentApiUser).toBeNull();
        });

        it("handles missing lastAccess gracefully", () => {
            const user = makeUser({
                lastAccess: undefined,
            });
            const deps = makeDeps({ currentUser: user });
            const { result } = renderHook(() => useUserProfile(deps));
            expect(result.current.currentApiUser?.last_access).toBeNull();
        });
    });

    describe("openEditProfile", () => {
        it("closes profile popover, loads programs, and opens edit modal", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useUserProfile(deps));

            // Open profile first
            act(() => {
                result.current.setProfileOpen(true);
            });
            expect(result.current.profileOpen).toBe(true);

            act(() => {
                result.current.openEditProfile();
            });

            expect(result.current.profileOpen).toBe(false);
            expect(deps.loadPrograms).toHaveBeenCalled();
            expect(result.current.editModalOpen).toBe(true);
        });
    });

    describe("handleSaveProfile", () => {
        it("calls updateUser and invokes onProfileSaved on success", async () => {
            mockUpdateUser.mockResolvedValue({
                id: 1,
                name: "New Name",
                email: "test@example.com",
                role: "admin",
                program_ids: [10, 20],
                program_names: ["Program A", "Program B"],
                last_access: "2026-01-01T00:00:00Z",
                metadata_extra: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
            });
            const onProfileSaved = vi.fn();
            const deps = makeDeps({ onProfileSaved });
            const { result } = renderHook(() => useUserProfile(deps));

            act(() => {
                result.current.setEditModalOpen(true);
            });

            await act(async () => {
                await result.current.handleSaveProfile({ name: "New Name" });
            });

            expect(mockUpdateUser).toHaveBeenCalledWith(1, { name: "New Name" });
            expect(result.current.editModalOpen).toBe(false);
            expect(onProfileSaved).toHaveBeenCalled();
        });

        it("does nothing when currentUser is null", async () => {
            const deps = makeDeps({ currentUser: null });
            const { result } = renderHook(() => useUserProfile(deps));

            await act(async () => {
                await result.current.handleSaveProfile({ name: "X" });
            });

            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        it("shows error snack on failure", async () => {
            mockUpdateUser.mockRejectedValue(new Error("Update failed"));
            const deps = makeDeps();
            const { result } = renderHook(() => useUserProfile(deps));

            await act(async () => {
                await result.current.handleSaveProfile({ name: "X" });
            });

            expect(deps.setErrorSnack).toHaveBeenCalledWith("Failed to update profile.");
        });
    });

    describe("setters", () => {
        it("setProfileOpen toggles popover", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useUserProfile(deps));

            act(() => {
                result.current.setProfileOpen(true);
            });
            expect(result.current.profileOpen).toBe(true);

            act(() => {
                result.current.setProfileOpen(false);
            });
            expect(result.current.profileOpen).toBe(false);
        });

        it("setEditModalOpen toggles edit modal", () => {
            const deps = makeDeps();
            const { result } = renderHook(() => useUserProfile(deps));

            act(() => {
                result.current.setEditModalOpen(true);
            });
            expect(result.current.editModalOpen).toBe(true);
        });
    });
});

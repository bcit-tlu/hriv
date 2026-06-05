import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnnouncementModal } from "../src/useAnnouncementModal";
import * as api from "../src/api";

vi.mock("../src/api", async () => {
    const actual = await vi.importActual<typeof api>("../src/api");
    return {
        ...actual,
        fetchAnnouncement: vi.fn(),
        updateAnnouncement: vi.fn(),
    };
});

const mockFetchAnnouncement = vi.mocked(api.fetchAnnouncement);
const mockUpdateAnnouncement = vi.mocked(api.updateAnnouncement);

function makeAnnouncement(overrides: Partial<api.ApiAnnouncement> = {}): api.ApiAnnouncement {
    return {
        id: 1,
        message: "",
        enabled: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFetchAnnouncement.mockResolvedValue(makeAnnouncement());
});

describe("useAnnouncementModal", () => {
    describe("initial state", () => {
        it("starts with empty announcement and closed modal", () => {
            const { result } = renderHook(() => useAnnouncementModal());
            expect(result.current.announcement).toBe("");
            expect(result.current.annModalOpen).toBe(false);
            expect(result.current.annDraftMessage).toBe("");
            expect(result.current.annDraftEnabled).toBe(false);
            expect(result.current.annSaving).toBe(false);
            expect(result.current.annError).toBeNull();
        });
    });

    describe("loadAnnouncement", () => {
        it("does not auto-load on mount (caller controls fetch)", () => {
            renderHook(() => useAnnouncementModal());
            expect(mockFetchAnnouncement).not.toHaveBeenCalled();
        });

        it("loads enabled announcement into display state", async () => {
            mockFetchAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "Hello world", enabled: true }),
            );
            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });
            expect(result.current.announcement).toBe("Hello world");
        });

        it("sets announcement to empty string when disabled", async () => {
            mockFetchAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "Not visible", enabled: false }),
            );
            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });
            expect(result.current.announcement).toBe("");
        });

        it("silently ignores fetch errors", async () => {
            mockFetchAnnouncement.mockRejectedValue(new Error("Network error"));
            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });
            expect(result.current.announcement).toBe("");
        });
    });

    describe("openAnnModal", () => {
        it("populates draft from current state and opens modal", async () => {
            mockFetchAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "Current msg", enabled: true }),
            );
            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });

            act(() => {
                result.current.openAnnModal();
            });

            expect(result.current.annModalOpen).toBe(true);
            expect(result.current.annDraftMessage).toBe("Current msg");
            expect(result.current.annDraftEnabled).toBe(true);
            expect(result.current.annError).toBeNull();
        });
    });

    describe("handleAnnSave", () => {
        it("saves announcement and closes modal on success", async () => {
            mockFetchAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "Old msg", enabled: false }),
            );
            mockUpdateAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "New msg", enabled: true }),
            );

            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });

            // Open modal and modify draft
            act(() => {
                result.current.openAnnModal();
            });
            act(() => {
                result.current.setAnnDraftMessage("New msg");
                result.current.setAnnDraftEnabled(true);
            });

            // Save
            await act(async () => {
                await result.current.handleAnnSave();
            });

            expect(mockUpdateAnnouncement).toHaveBeenCalledWith({
                message: "New msg",
                enabled: true,
            });
            expect(result.current.annModalOpen).toBe(false);
            // Display state updated immediately from response (no re-fetch needed)
            expect(result.current.announcement).toBe("New msg");
            // Dismiss key cleared so banner is consistent on refresh
            expect(localStorage.getItem("dismissed_announcement")).toBeNull();
            // No redundant re-fetch after save
            expect(mockFetchAnnouncement).toHaveBeenCalledTimes(1);
        });

        it("clears dismissed localStorage key on save", async () => {
            mockFetchAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "Msg", enabled: true, updated_at: "2026-06-01T00:00:00Z" }),
            );
            mockUpdateAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "Msg", enabled: true, updated_at: "2026-06-01T00:00:00Z" }),
            );
            localStorage.setItem("dismissed_announcement", "2026-06-01T00:00:00Z");

            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });

            // Banner suppressed because dismissed key matches updated_at
            expect(result.current.announcement).toBe("");

            act(() => {
                result.current.openAnnModal();
            });

            await act(async () => {
                await result.current.handleAnnSave();
            });

            // After save, dismiss key cleared and banner shows
            expect(localStorage.getItem("dismissed_announcement")).toBeNull();
            expect(result.current.announcement).toBe("Msg");
        });

        it("clears announcement display immediately when saving as disabled", async () => {
            mockFetchAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "Visible", enabled: true }),
            );
            mockUpdateAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "Visible", enabled: false }),
            );

            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });

            act(() => {
                result.current.openAnnModal();
            });
            act(() => {
                result.current.setAnnDraftEnabled(false);
            });

            await act(async () => {
                await result.current.handleAnnSave();
            });

            expect(result.current.announcement).toBe("");
        });

        it("shows error on save failure", async () => {
            mockFetchAnnouncement.mockResolvedValue(makeAnnouncement());
            mockUpdateAnnouncement.mockRejectedValue(new Error("Server error"));

            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });

            act(() => {
                result.current.openAnnModal();
            });

            await act(async () => {
                await result.current.handleAnnSave();
            });

            expect(result.current.annError).toBe("Failed to update announcement");
            expect(result.current.annModalOpen).toBe(true);
            expect(result.current.annSaving).toBe(false);
        });
    });

    describe("dismissAnnouncement", () => {
        it("hides the banner and persists updated_at to localStorage", async () => {
            mockFetchAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "Hello", enabled: true, updated_at: "2026-06-01T00:00:00Z" }),
            );
            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });

            act(() => {
                result.current.dismissAnnouncement();
            });

            expect(result.current.announcement).toBe("");
            expect(localStorage.getItem("dismissed_announcement")).toBe("2026-06-01T00:00:00Z");
        });

        it("suppresses banner on next load when dismissed", async () => {
            const ann = makeAnnouncement({ message: "Persistent", enabled: true, updated_at: "2026-06-01T00:00:00Z" });
            mockFetchAnnouncement.mockResolvedValue(ann);
            localStorage.setItem("dismissed_announcement", "2026-06-01T00:00:00Z");

            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });

            expect(result.current.announcement).toBe("");
        });

        it("shows banner again after admin updates the announcement", async () => {
            localStorage.setItem("dismissed_announcement", "2026-06-01T00:00:00Z");
            mockFetchAnnouncement.mockResolvedValue(
                makeAnnouncement({ message: "New one", enabled: true, updated_at: "2026-06-02T00:00:00Z" }),
            );

            const { result } = renderHook(() => useAnnouncementModal());
            await act(async () => {
                await result.current.loadAnnouncement();
            });
            expect(result.current.announcement).toBe("New one");
        });
    });

    describe("setters", () => {
        it("setAnnModalOpen controls modal visibility", () => {
            const { result } = renderHook(() => useAnnouncementModal());
            act(() => {
                result.current.setAnnModalOpen(true);
            });
            expect(result.current.annModalOpen).toBe(true);
        });

        it("setAnnError clears error", () => {
            const { result } = renderHook(() => useAnnouncementModal());
            act(() => {
                result.current.setAnnError("Some error");
            });
            expect(result.current.annError).toBe("Some error");
            act(() => {
                result.current.setAnnError(null);
            });
            expect(result.current.annError).toBeNull();
        });
    });
});

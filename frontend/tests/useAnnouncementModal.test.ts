import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
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

beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAnnouncement.mockResolvedValue({ message: "", enabled: false });
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

    describe("loadAnnouncement (auto-loads on mount)", () => {
        it("loads enabled announcement into display state", async () => {
            mockFetchAnnouncement.mockResolvedValue({
                message: "Hello world",
                enabled: true,
            });
            const { result } = renderHook(() => useAnnouncementModal());
            await waitFor(() => {
                expect(result.current.announcement).toBe("Hello world");
            });
        });

        it("sets announcement to empty string when disabled", async () => {
            mockFetchAnnouncement.mockResolvedValue({
                message: "Not visible",
                enabled: false,
            });
            const { result } = renderHook(() => useAnnouncementModal());
            await waitFor(() => {
                expect(mockFetchAnnouncement).toHaveBeenCalled();
            });
            expect(result.current.announcement).toBe("");
        });

        it("silently ignores fetch errors", async () => {
            mockFetchAnnouncement.mockRejectedValue(new Error("Network error"));
            const { result } = renderHook(() => useAnnouncementModal());
            await waitFor(() => {
                expect(mockFetchAnnouncement).toHaveBeenCalled();
            });
            expect(result.current.announcement).toBe("");
        });
    });

    describe("openAnnModal", () => {
        it("populates draft from current state and opens modal", async () => {
            mockFetchAnnouncement.mockResolvedValue({
                message: "Current msg",
                enabled: true,
            });
            const { result } = renderHook(() => useAnnouncementModal());
            await waitFor(() => {
                expect(result.current.announcement).toBe("Current msg");
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
            mockFetchAnnouncement.mockResolvedValue({
                message: "Old msg",
                enabled: false,
            });
            mockUpdateAnnouncement.mockResolvedValue({
                message: "New msg",
                enabled: true,
            });

            const { result } = renderHook(() => useAnnouncementModal());
            await waitFor(() => {
                expect(mockFetchAnnouncement).toHaveBeenCalledTimes(1);
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
            // loadAnnouncement called again after save
            expect(mockFetchAnnouncement).toHaveBeenCalledTimes(2);
        });

        it("shows error on save failure", async () => {
            mockFetchAnnouncement.mockResolvedValue({
                message: "",
                enabled: false,
            });
            mockUpdateAnnouncement.mockRejectedValue(new Error("Server error"));

            const { result } = renderHook(() => useAnnouncementModal());
            await waitFor(() => {
                expect(mockFetchAnnouncement).toHaveBeenCalled();
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

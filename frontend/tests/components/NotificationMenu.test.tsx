import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import NotificationMenu from "../../src/components/NotificationMenu";
import * as api from "../../src/api";

vi.mock("../../src/api", async () => {
    const actual = await vi.importActual<typeof api>("../../src/api");
    return {
        ...actual,
        fetchChangelogEntries: vi.fn(),
        markChangelogRead: vi.fn(),
    };
});

const mockFetchChangelogEntries = vi.mocked(api.fetchChangelogEntries);
const mockMarkChangelogRead = vi.mocked(api.markChangelogRead);

const entry: api.ApiChangelogEntry = {
    id: 1,
    title: "v2.5",
    body: "## Highlights\n\n- Faster search",
    published_at: "2026-06-16T12:00:00Z",
    created_at: "2026-06-16T12:00:00Z",
    updated_at: "2026-06-16T12:00:00Z",
};

describe("NotificationMenu", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockFetchChangelogEntries.mockResolvedValue([entry]);
        mockMarkChangelogRead.mockResolvedValue({
            changelog_last_read_at: "2026-06-16T12:30:00Z",
        });
    });

    it("shows an unread badge when there are unseen entries", async () => {
        const { container } = render(
            <NotificationMenu
                userEmail="instructor@example.ca"
                frontendVersion="1.2.3"
                backendVersion="4.5.6"
                backupVersion="7.8.9"
            />,
        );

        await waitFor(() =>
            expect(mockFetchChangelogEntries).toHaveBeenCalledTimes(1),
        );

        const badge = container.querySelector(".MuiBadge-badge");
        expect(badge).not.toHaveClass("MuiBadge-invisible");
    });

    it("does not mark read when only the bell menu is opened", async () => {
        render(
            <NotificationMenu
                userEmail="instructor@example.ca"
                frontendVersion="1.2.3"
                backendVersion="4.5.6"
                backupVersion="7.8.9"
            />,
        );

        await waitFor(() =>
            expect(mockFetchChangelogEntries).toHaveBeenCalledTimes(1),
        );

        fireEvent.click(screen.getByLabelText("Notifications"));
        expect(screen.getByText("What's New")).toBeInTheDocument();
        expect(mockMarkChangelogRead).not.toHaveBeenCalled();
    });

    it("marks read and opens the feed when What's New is clicked", async () => {
        const storageKey = "hriv_changelog_last_read_instructor@example.ca";
        render(
            <NotificationMenu
                userEmail="instructor@example.ca"
                frontendVersion="1.2.3"
                backendVersion="4.5.6"
                backupVersion="7.8.9"
            />,
        );

        await waitFor(() =>
            expect(mockFetchChangelogEntries).toHaveBeenCalledTimes(1),
        );

        fireEvent.click(screen.getByLabelText("Notifications"));
        fireEvent.click(screen.getByText("What's New"));

        await waitFor(() =>
            expect(mockMarkChangelogRead).toHaveBeenCalledTimes(1),
        );
        expect(screen.getByText("v2.5")).toBeInTheDocument();
        expect(localStorage.getItem(storageKey)).not.toBeNull();
    });

    it("hides the unread badge when local storage already has a newer read timestamp", async () => {
        localStorage.setItem(
            "hriv_changelog_last_read_instructor@example.ca",
            "2026-06-16T13:00:00Z",
        );

        const { container } = render(
            <NotificationMenu
                userEmail="instructor@example.ca"
                frontendVersion="1.2.3"
                backendVersion="4.5.6"
                backupVersion="7.8.9"
            />,
        );

        await waitFor(() =>
            expect(mockFetchChangelogEntries).toHaveBeenCalledTimes(1),
        );

        const badge = container.querySelector(".MuiBadge-badge");
        expect(badge).toHaveClass("MuiBadge-invisible");
    });
});

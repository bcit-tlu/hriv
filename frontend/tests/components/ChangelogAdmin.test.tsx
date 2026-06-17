import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChangelogAdmin from "../../src/components/ChangelogAdmin";
import * as api from "../../src/api";

vi.mock("../../src/api", async () => {
    const actual = await vi.importActual<typeof api>("../../src/api");
    return {
        ...actual,
        fetchChangelogEntries: vi.fn(),
        createChangelogEntry: vi.fn(),
        updateChangelogEntry: vi.fn(),
        deleteChangelogEntry: vi.fn(),
    };
});

const mockFetchChangelogEntries = vi.mocked(api.fetchChangelogEntries);
const mockCreateChangelogEntry = vi.mocked(api.createChangelogEntry);
const mockUpdateChangelogEntry = vi.mocked(api.updateChangelogEntry);

const fixture: api.ApiChangelogEntry = {
    id: 1,
    title: "v2.5",
    body: "Released improvements",
    published_at: "2026-06-16T00:00:00Z",
    created_at: "2026-06-16T00:00:00Z",
    updated_at: "2026-06-16T00:00:00Z",
};

describe("ChangelogAdmin", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchChangelogEntries.mockResolvedValue([]);
        mockCreateChangelogEntry.mockResolvedValue(fixture);
        mockUpdateChangelogEntry.mockResolvedValue(fixture);
    });

    it("renders empty state when there are no entries", async () => {
        render(<ChangelogAdmin />);

        await waitFor(() =>
            expect(screen.getByText("No entries yet.")).toBeInTheDocument(),
        );
    });

    it("creates a new entry from the dialog", async () => {
        render(<ChangelogAdmin />);

        await waitFor(() =>
            expect(mockFetchChangelogEntries).toHaveBeenCalledTimes(1),
        );

        fireEvent.click(screen.getByRole("button", { name: "New Entry" }));
        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "v2.5" },
        });
        fireEvent.change(screen.getByLabelText("Body (Markdown)"), {
            target: { value: "Released improvements" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() =>
            expect(mockCreateChangelogEntry).toHaveBeenCalledWith({
                title: "v2.5",
                body: "Released improvements",
            }),
        );
        expect(screen.getByText("v2.5")).toBeInTheDocument();
    });

    it("opens an existing row in republish mode", async () => {
        mockFetchChangelogEntries.mockResolvedValue([fixture]);
        render(<ChangelogAdmin />);

        await waitFor(() =>
            expect(screen.getByText("v2.5")).toBeInTheDocument(),
        );

        fireEvent.click(screen.getByText("v2.5"));
        expect(
            screen.getByRole("button", { name: "Republish" }),
        ).toBeInTheDocument();
    });
});

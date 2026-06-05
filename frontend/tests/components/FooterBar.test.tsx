/**
 * Unit tests for the FooterBar component.
 *
 * Covers:
 * 1. Base link ("High Resolution Image Viewer" → repo) always renders
 * 2. "Report issue" invokes setReportIssueOpen when provided
 * 3. Admin (canManageUsers) view shows version links pointing at the
 *    releases page when a real version is supplied
 * 4. Admin view falls back to the repo URL for "dev"/missing versions
 * 5. Non-admin view hides the Frontend/Backend/Backup version links
 * 6. "Report issue" is hidden when setReportIssueOpen is omitted
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FooterBar from "../../src/components/FooterBar";
import * as useColorModeModule from "../../src/useColorMode";
import type { ColorModeContextValue } from "../../src/colorModeContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RELEASES_HREF = "https://github.com/bcit-tlu/hriv/releases";
const REPO_HREF = "https://github.com/bcit-tlu/hriv";

function mockUseColorMode(overrides: Partial<ColorModeContextValue> = {}) {
    const value: ColorModeContextValue = {
        mode: "light",
        preference: "light",
        setPreference: vi.fn(),
        toggleMode: vi.fn(),
        ...overrides,
    };
    vi.spyOn(useColorModeModule, "useColorMode").mockReturnValue(value);
    return value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FooterBar", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockUseColorMode();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the base 'High Resolution Image Viewer' repo link", () => {
        render(
            <FooterBar canManageUsers={false} setReportIssueOpen={vi.fn()} />,
        );

        const appLink = screen.getByRole("link", {
            name: "High Resolution Image Viewer",
        });
        expect(appLink).toHaveAttribute("href", REPO_HREF);

        // The old BCIT / licence links should no longer be present.
        expect(
            screen.queryByRole("link", { name: "Teaching and Learning Unit" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "MPL-2.0" }),
        ).not.toBeInTheDocument();
    });

    it("invokes setReportIssueOpen when 'Report issue' is clicked", async () => {
        const setReportIssueOpen = vi.fn();
        const user = userEvent.setup();

        render(
            <FooterBar
                canManageUsers={false}
                setReportIssueOpen={setReportIssueOpen}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Report issue" }));
        expect(setReportIssueOpen).toHaveBeenCalledWith(true);
    });

    it("shows version links pointing at releases for real versions (admin)", () => {
        render(
            <FooterBar
                canManageUsers
                frontendVersion="1.2.3"
                backendVersion="4.5.6"
                backupVersion="7.8.9"
                setReportIssueOpen={vi.fn()}
            />,
        );

        const frontend = screen.getByRole("link", { name: "1.2.3" });
        const backend = screen.getByRole("link", { name: "4.5.6" });
        const backup = screen.getByRole("link", { name: "7.8.9" });

        expect(frontend).toHaveAttribute("href", RELEASES_HREF);
        expect(backend).toHaveAttribute("href", RELEASES_HREF);
        expect(backup).toHaveAttribute("href", RELEASES_HREF);
    });

    it("falls back to the repo URL for 'dev'/missing versions (admin)", () => {
        render(<FooterBar canManageUsers setReportIssueOpen={vi.fn()} />);

        // Missing frontendVersion defaults to the "dev" label.
        const frontend = screen.getByRole("link", { name: "dev" });
        expect(frontend).toHaveAttribute("href", REPO_HREF);

        // Missing backend/backup render the "…" placeholder, also repo URL.
        const placeholders = screen.getAllByRole("link", { name: "…" });
        expect(placeholders).toHaveLength(2);
        placeholders.forEach((link) =>
            expect(link).toHaveAttribute("href", REPO_HREF),
        );
    });

    it("hides version links for non-admin users", () => {
        render(
            <FooterBar
                canManageUsers={false}
                frontendVersion="1.2.3"
                backendVersion="4.5.6"
                backupVersion="7.8.9"
                setReportIssueOpen={vi.fn()}
            />,
        );

        expect(screen.queryByText("Frontend:")).not.toBeInTheDocument();
        expect(screen.queryByText("Backend:")).not.toBeInTheDocument();
        expect(screen.queryByText("Backup:")).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "1.2.3" }),
        ).not.toBeInTheDocument();
    });

    it("hides 'Report issue' when setReportIssueOpen is omitted", () => {
        render(<FooterBar canManageUsers={false} />);

        expect(
            screen.queryByRole("button", { name: "Report issue" }),
        ).not.toBeInTheDocument();
    });
});

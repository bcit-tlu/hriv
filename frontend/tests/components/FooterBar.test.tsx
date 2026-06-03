/**
 * Unit tests for the FooterBar component.
 *
 * Covers:
 * 1. Base links (BCIT / TLU, MPL-2.0) always render
 * 2. "Report issue" link invokes setReportIssueOpen
 * 3. Admin version links render only when canManageUsers is true
 * 4. Version links point to releases when a real version is provided
 * 5. Version links point to the repo when version is "dev" or missing
 * 6. Non-admin users do not see version info
 * 7. "Report issue" link is hidden when setReportIssueOpen is omitted
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FooterBar from "../../src/components/FooterBar";
import * as useColorModeModule from "../../src/useColorMode";
import type { ColorModeContextValue } from "../../src/colorModeContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockUseColorMode(mode: "light" | "dark" = "light") {
    const value: ColorModeContextValue = {
        mode,
        preference: mode,
        setPreference: vi.fn(),
        toggleMode: vi.fn(),
    };
    vi.spyOn(useColorModeModule, "useColorMode").mockReturnValue(value);
}

const RELEASES_HREF = "https://github.com/bcit-tlu/hriv/releases";
const REPO_HREF = "https://github.com/bcit-tlu/hriv";

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

    it("renders BCIT / TLU and MPL-2.0 links", () => {
        render(
            <FooterBar
                canManageUsers={false}
                setReportIssueOpen={vi.fn()}
            />,
        );

        const footer = screen.getByRole("contentinfo");
        expect(
            within(footer).getByRole("link", {
                name: "Teaching and Learning Unit",
            }),
        ).toHaveAttribute(
            "href",
            "https://www.bcit.ca/learning-teaching-centre/",
        );
        expect(
            within(footer).getByRole("link", { name: "MPL-2.0" }),
        ).toHaveAttribute("href", "https://www.mozilla.org/en-US/MPL/2.0/");
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

    it("does not show version info for non-admin users", () => {
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
    });

    it("shows version links for admin users with real versions", () => {
        render(
            <FooterBar
                canManageUsers={true}
                frontendVersion="1.2.3"
                backendVersion="4.5.6"
                backupVersion="7.8.9"
                setReportIssueOpen={vi.fn()}
            />,
        );

        const link123 = screen.getByRole("link", { name: "1.2.3" });
        const link456 = screen.getByRole("link", { name: "4.5.6" });
        const link789 = screen.getByRole("link", { name: "7.8.9" });

        expect(link123).toHaveAttribute("href", RELEASES_HREF);
        expect(link456).toHaveAttribute("href", RELEASES_HREF);
        expect(link789).toHaveAttribute("href", RELEASES_HREF);
    });

    it('links to the repo (not releases) when version is "dev"', () => {
        render(
            <FooterBar
                canManageUsers={true}
                frontendVersion={undefined}
                backendVersion={undefined}
                backupVersion={undefined}
                setReportIssueOpen={vi.fn()}
            />,
        );

        const devLinks = screen.getAllByRole("link", { name: "dev" });
        expect(devLinks.length).toBeGreaterThanOrEqual(1);
        devLinks.forEach((link) => {
            expect(link).toHaveAttribute("href", REPO_HREF);
        });
    });

    it('uses "…" as fallback text when backend/backup versions are undefined', () => {
        render(
            <FooterBar
                canManageUsers={true}
                frontendVersion="1.0.0"
                backendVersion={undefined}
                backupVersion={undefined}
                setReportIssueOpen={vi.fn()}
            />,
        );

        const ellipsisLinks = screen.getAllByRole("link", { name: "…" });
        expect(ellipsisLinks).toHaveLength(2);
    });

    it("hides 'Report issue' when setReportIssueOpen is omitted", () => {
        render(<FooterBar canManageUsers={false} />);

        expect(
            screen.queryByRole("button", { name: "Report issue" }),
        ).not.toBeInTheDocument();
    });
});

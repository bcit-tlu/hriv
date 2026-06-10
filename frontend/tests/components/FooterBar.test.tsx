import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FooterBar from "../../src/components/FooterBar";
import * as useColorModeModule from "../../src/useColorMode";
import type { ColorModeContextValue } from "../../src/colorModeContext";

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

describe("FooterBar", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockUseColorMode();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the standard HRIV repo link and not the removed BCIT/licence links", () => {
        render(<FooterBar canManageUsers={false} />);

        expect(
            screen.getByRole("link", { name: "High Resolution Image Viewer" }),
        ).toHaveAttribute("href", REPO_HREF);
        expect(
            screen.queryByRole("link", { name: "Teaching and Learning Unit" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "MPL-2.0" }),
        ).not.toBeInTheDocument();
    });

    it("invokes onReportIssue when Report issue is clicked", async () => {
        const onReportIssue = vi.fn();
        const user = userEvent.setup();

        render(
            <FooterBar canManageUsers={false} onReportIssue={onReportIssue} />,
        );

        await user.click(screen.getByRole("button", { name: "Report issue" }));
        expect(onReportIssue).toHaveBeenCalledTimes(1);
    });

    it("hides Report issue when no callback is provided", () => {
        render(<FooterBar canManageUsers={false} />);

        expect(
            screen.queryByRole("button", { name: "Report issue" }),
        ).not.toBeInTheDocument();
    });

    it("shows admin version links pointing at releases for real versions", () => {
        render(
            <FooterBar
                canManageUsers
                frontendVersion="1.2.3"
                backendVersion="4.5.6"
                backupVersion="7.8.9"
            />,
        );

        expect(screen.getByRole("link", { name: "1.2.3" })).toHaveAttribute(
            "href",
            RELEASES_HREF,
        );
        expect(screen.getByRole("link", { name: "4.5.6" })).toHaveAttribute(
            "href",
            RELEASES_HREF,
        );
        expect(screen.getByRole("link", { name: "7.8.9" })).toHaveAttribute(
            "href",
            RELEASES_HREF,
        );
    });

    it("falls back to the repo URL for dev or missing admin versions", () => {
        render(<FooterBar canManageUsers />);

        expect(screen.getByRole("link", { name: "dev" })).toHaveAttribute(
            "href",
            REPO_HREF,
        );
        const placeholders = screen.getAllByRole("link", { name: "…" });
        expect(placeholders).toHaveLength(2);
        placeholders.forEach((link) => {
            expect(link).toHaveAttribute("href", REPO_HREF);
        });
    });

    it("hides admin version links for non-admin users", () => {
        render(
            <FooterBar
                canManageUsers={false}
                frontendVersion="1.2.3"
                backendVersion="4.5.6"
                backupVersion="7.8.9"
            />,
        );

        expect(screen.queryByText("Frontend:")).not.toBeInTheDocument();
        expect(screen.queryByText("Backend:")).not.toBeInTheDocument();
        expect(screen.queryByText("Backup:")).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "1.2.3" }),
        ).not.toBeInTheDocument();
    });
});

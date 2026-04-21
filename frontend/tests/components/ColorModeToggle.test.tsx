/**
 * Unit tests for ColorModeToggle component.
 *
 * Covers:
 * 1. Correct icon renders per preference (light / dark / auto)
 * 2. Tooltip text matches the expected string per preference, with the
 *    resolved system mode surfaced when preference is "auto"
 * 3. Clicking the button invokes toggleMode from useColorMode
 * 4. iconButtonSx prop is forwarded to the underlying IconButton
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColorModeToggle from "../../src/components/ColorModeToggle";
import * as useColorModeModule from "../../src/useColorMode";
import type { ColorModeContextValue } from "../../src/colorModeContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockUseColorMode(overrides: Partial<ColorModeContextValue> = {}) {
    const toggleMode = vi.fn();
    const setPreference = vi.fn();
    const value: ColorModeContextValue = {
        mode: "light",
        preference: "light",
        setPreference,
        toggleMode,
        ...overrides,
    };
    vi.spyOn(useColorModeModule, "useColorMode").mockReturnValue(value);
    return { toggleMode, setPreference, value };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ColorModeToggle", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the light icon and tooltip when preference is 'light'", async () => {
        mockUseColorMode({ preference: "light", mode: "light" });
        const user = userEvent.setup();

        render(<ColorModeToggle />);

        const button = screen.getByRole("button", { name: "Toggle theme" });
        expect(button.querySelector('[data-testid="LightModeIcon"]')).not.toBeNull();

        await user.hover(button);
        expect(
            await screen.findByRole("tooltip", {
                name: "Theme: Light (click for Dark)",
            }),
        ).toBeInTheDocument();
    });

    it("renders the dark icon and tooltip when preference is 'dark'", async () => {
        mockUseColorMode({ preference: "dark", mode: "dark" });
        const user = userEvent.setup();

        render(<ColorModeToggle />);

        const button = screen.getByRole("button", { name: "Toggle theme" });
        expect(button.querySelector('[data-testid="DarkModeIcon"]')).not.toBeNull();

        await user.hover(button);
        expect(
            await screen.findByRole("tooltip", {
                name: "Theme: Dark (click for Auto)",
            }),
        ).toBeInTheDocument();
    });

    it("renders the auto icon and surfaces the resolved system mode in the tooltip", async () => {
        mockUseColorMode({ preference: "auto", mode: "dark" });
        const user = userEvent.setup();

        render(<ColorModeToggle />);

        const button = screen.getByRole("button", { name: "Toggle theme" });
        expect(
            button.querySelector('[data-testid="BrightnessAutoIcon"]'),
        ).not.toBeNull();

        await user.hover(button);
        // Use a regex so the en-dash / parentheses escaping stays readable.
        expect(
            await screen.findByRole("tooltip", {
                name: /Theme: Auto.*follows system.*dark.*click for Light/,
            }),
        ).toBeInTheDocument();
    });

    it("invokes toggleMode when the button is clicked", async () => {
        const { toggleMode } = mockUseColorMode({ preference: "light" });
        const user = userEvent.setup();

        render(<ColorModeToggle />);

        await user.click(screen.getByRole("button", { name: "Toggle theme" }));
        expect(toggleMode).toHaveBeenCalledTimes(1);
    });

    it("forwards iconButtonSx to the underlying IconButton", () => {
        mockUseColorMode({ preference: "light" });

        render(<ColorModeToggle iconButtonSx={{ color: "rgb(10, 20, 30)" }} />);

        const button = screen.getByRole("button", { name: "Toggle theme" });
        // MUI's sx is applied inline after style resolution; confirming the
        // colour landed on the rendered element is enough to prove the prop
        // was threaded through.
        expect(button).toHaveStyle({ color: "rgb(10, 20, 30)" });
    });
});

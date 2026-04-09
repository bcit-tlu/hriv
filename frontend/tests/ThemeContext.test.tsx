/**
 * Unit tests for ColorModeProvider (ThemeContext.tsx) and useColorMode hook.
 *
 * Covers:
 * 1. Default mode is "light" when no localStorage and no OS dark preference
 * 2. Reads stored preference from localStorage
 * 3. toggleMode switches between light and dark
 * 4. toggleMode persists the new value to localStorage
 * 5. useColorMode returns context values
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColorModeProvider from "../src/ThemeContext";
import { useColorMode } from "../src/useColorMode";

// ---------------------------------------------------------------------------
// Mock window.matchMedia (not available in jsdom)
// ---------------------------------------------------------------------------

function mockMatchMedia(prefersDark = false) {
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    const mql = {
        matches: prefersDark,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => {
            listeners.push(handler);
        }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(mql);
    return { mql, listeners };
}

// ---------------------------------------------------------------------------
// Test component that exposes context values
// ---------------------------------------------------------------------------

function TestConsumer() {
    const { mode, toggleMode } = useColorMode();
    return (
        <div>
            <span data-testid="mode">{mode}</span>
            <button onClick={toggleMode}>toggle</button>
        </div>
    );
}

function renderWithProvider() {
    return render(
        <ColorModeProvider>
            <TestConsumer />
        </ColorModeProvider>,
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ColorModeProvider", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
        mockMatchMedia(false);
    });

    it("defaults to light mode when localStorage is empty and OS prefers light", () => {
        renderWithProvider();
        expect(screen.getByTestId("mode").textContent).toBe("light");
    });

    it("reads a stored 'dark' preference from localStorage", () => {
        localStorage.setItem("hriv-color-mode", "dark");
        renderWithProvider();
        expect(screen.getByTestId("mode").textContent).toBe("dark");
    });

    it("reads a stored 'light' preference from localStorage", () => {
        localStorage.setItem("hriv-color-mode", "light");
        renderWithProvider();
        expect(screen.getByTestId("mode").textContent).toBe("light");
    });

    it("toggleMode switches from light to dark", async () => {
        const user = userEvent.setup();
        renderWithProvider();

        expect(screen.getByTestId("mode").textContent).toBe("light");

        await user.click(screen.getByRole("button", { name: "toggle" }));

        expect(screen.getByTestId("mode").textContent).toBe("dark");
    });

    it("toggleMode switches from dark back to light", async () => {
        const user = userEvent.setup();
        localStorage.setItem("hriv-color-mode", "dark");
        renderWithProvider();

        expect(screen.getByTestId("mode").textContent).toBe("dark");

        await user.click(screen.getByRole("button", { name: "toggle" }));

        expect(screen.getByTestId("mode").textContent).toBe("light");
    });

    it("toggleMode persists the new value to localStorage", async () => {
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByRole("button", { name: "toggle" }));

        expect(localStorage.getItem("hriv-color-mode")).toBe("dark");
    });

    it("ignores invalid localStorage values and defaults to light", () => {
        localStorage.setItem("hriv-color-mode", "invalid");
        renderWithProvider();
        expect(screen.getByTestId("mode").textContent).toBe("light");
    });
});

describe("useColorMode", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
        mockMatchMedia(false);
    });

    it("returns mode and toggleMode from context", () => {
        // Render the TestConsumer which uses useColorMode internally
        renderWithProvider();

        // If useColorMode works, TestConsumer renders the mode text
        expect(screen.getByTestId("mode").textContent).toBe("light");
        // And the toggle button is present (toggleMode is a function)
        expect(screen.getByRole("button", { name: "toggle" })).toBeInTheDocument();
    });
});

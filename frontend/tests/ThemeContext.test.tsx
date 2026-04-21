/**
 * Unit tests for ColorModeProvider (ThemeContext.tsx) and useColorMode hook.
 *
 * Covers:
 * 1. Default preference is "auto" when no localStorage (mode resolved from OS)
 * 2. Reads explicit stored preference from localStorage
 * 3. toggleMode cycles Light → Dark → Auto → Light
 * 4. toggleMode persists explicit choices and clears storage on "auto"
 * 5. setPreference jumps directly to any value
 * 6. OS theme changes propagate to `mode` while preference is "auto"
 * 7. useColorMode returns the context values
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColorModeProvider from "../src/ThemeContext";
import { useColorMode } from "../src/useColorMode";
import type { ColorModePreference } from "../src/colorModeContext";

// ---------------------------------------------------------------------------
// Mock window.matchMedia (not available in jsdom)
// ---------------------------------------------------------------------------

interface MockMql {
    matches: boolean;
    media: string;
    onchange: null;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    dispatchEvent: ReturnType<typeof vi.fn>;
}

function mockMatchMedia(prefersDark = false) {
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    const mql: MockMql = {
        matches: prefersDark,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: vi.fn(
            (_event: string, handler: (e: MediaQueryListEvent) => void) => {
                listeners.push(handler);
            },
        ),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(mql);
    const emit = (matches: boolean) => {
        mql.matches = matches;
        for (const handler of listeners) {
            handler({ matches } as MediaQueryListEvent);
        }
    };
    return { mql, listeners, emit };
}

// ---------------------------------------------------------------------------
// Test component that exposes context values
// ---------------------------------------------------------------------------

function TestConsumer() {
    const { mode, preference, setPreference, toggleMode } = useColorMode();
    return (
        <div>
            <span data-testid="mode">{mode}</span>
            <span data-testid="preference">{preference}</span>
            <button onClick={toggleMode}>toggle</button>
            <button onClick={() => setPreference("light")}>set-light</button>
            <button onClick={() => setPreference("dark")}>set-dark</button>
            <button onClick={() => setPreference("auto")}>set-auto</button>
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

    it("defaults to auto/light when localStorage is empty and OS prefers light", () => {
        renderWithProvider();
        expect(screen.getByTestId("preference").textContent).toBe("auto");
        expect(screen.getByTestId("mode").textContent).toBe("light");
    });

    it("defaults to auto/dark when localStorage is empty and OS prefers dark", () => {
        mockMatchMedia(true);
        renderWithProvider();
        expect(screen.getByTestId("preference").textContent).toBe("auto");
        expect(screen.getByTestId("mode").textContent).toBe("dark");
    });

    it("reads a stored 'dark' preference from localStorage", () => {
        localStorage.setItem("hriv-color-mode", "dark");
        renderWithProvider();
        expect(screen.getByTestId("preference").textContent).toBe("dark");
        expect(screen.getByTestId("mode").textContent).toBe("dark");
    });

    it("reads a stored 'light' preference from localStorage", () => {
        localStorage.setItem("hriv-color-mode", "light");
        renderWithProvider();
        expect(screen.getByTestId("preference").textContent).toBe("light");
        expect(screen.getByTestId("mode").textContent).toBe("light");
    });

    it("ignores invalid localStorage values and falls back to auto", () => {
        localStorage.setItem("hriv-color-mode", "invalid");
        renderWithProvider();
        expect(screen.getByTestId("preference").textContent).toBe("auto");
        expect(screen.getByTestId("mode").textContent).toBe("light");
    });

    it("toggleMode cycles Light → Dark → Auto → Light", async () => {
        const user = userEvent.setup();
        localStorage.setItem("hriv-color-mode", "light");
        renderWithProvider();

        expect(screen.getByTestId("preference").textContent).toBe("light");

        await user.click(screen.getByRole("button", { name: "toggle" }));
        expect(screen.getByTestId("preference").textContent).toBe("dark");

        await user.click(screen.getByRole("button", { name: "toggle" }));
        expect(screen.getByTestId("preference").textContent).toBe("auto");

        await user.click(screen.getByRole("button", { name: "toggle" }));
        expect(screen.getByTestId("preference").textContent).toBe("light");
    });

    it("toggleMode persists explicit choices and removes storage on 'auto'", async () => {
        const user = userEvent.setup();
        localStorage.setItem("hriv-color-mode", "light");
        renderWithProvider();

        // light → dark (persisted)
        await user.click(screen.getByRole("button", { name: "toggle" }));
        expect(localStorage.getItem("hriv-color-mode")).toBe("dark");

        // dark → auto (cleared)
        await user.click(screen.getByRole("button", { name: "toggle" }));
        expect(localStorage.getItem("hriv-color-mode")).toBeNull();

        // auto → light (persisted)
        await user.click(screen.getByRole("button", { name: "toggle" }));
        expect(localStorage.getItem("hriv-color-mode")).toBe("light");
    });

    it("setPreference jumps directly to the requested value", async () => {
        const user = userEvent.setup();
        renderWithProvider();

        await user.click(screen.getByRole("button", { name: "set-dark" }));
        expect(screen.getByTestId("preference").textContent).toBe("dark");
        expect(localStorage.getItem("hriv-color-mode")).toBe("dark");

        await user.click(screen.getByRole("button", { name: "set-auto" }));
        expect(screen.getByTestId("preference").textContent).toBe("auto");
        expect(localStorage.getItem("hriv-color-mode")).toBeNull();

        await user.click(screen.getByRole("button", { name: "set-light" }));
        expect(screen.getByTestId("preference").textContent).toBe("light");
        expect(localStorage.getItem("hriv-color-mode")).toBe("light");
    });

    it("tracks OS-level changes while preference is 'auto'", () => {
        const { emit } = mockMatchMedia(false);
        renderWithProvider();

        expect(screen.getByTestId("mode").textContent).toBe("light");

        act(() => {
            emit(true);
        });
        expect(screen.getByTestId("mode").textContent).toBe("dark");

        act(() => {
            emit(false);
        });
        expect(screen.getByTestId("mode").textContent).toBe("light");
    });

    it("ignores OS-level changes while preference is an explicit override", () => {
        localStorage.setItem("hriv-color-mode", "light");
        const { emit } = mockMatchMedia(false);
        renderWithProvider();

        expect(screen.getByTestId("mode").textContent).toBe("light");

        act(() => {
            emit(true);
        });
        // Explicit preference still wins; only the system tracker state moves.
        expect(screen.getByTestId("mode").textContent).toBe("light");
        expect(screen.getByTestId("preference").textContent).toBe("light");
    });
});

describe("useColorMode", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
        mockMatchMedia(false);
    });

    it("returns mode, preference, setPreference and toggleMode from context", () => {
        renderWithProvider();

        expect(screen.getByTestId("mode").textContent).toBe("light");
        expect(screen.getByTestId("preference").textContent).toBe("auto");
        expect(
            screen.getByRole("button", { name: "toggle" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "set-light" }),
        ).toBeInTheDocument();
    });

    it("exports a ColorModePreference type covering all three values", () => {
        const values: ColorModePreference[] = ["light", "dark", "auto"];
        expect(values).toEqual(["light", "dark", "auto"]);
    });
});

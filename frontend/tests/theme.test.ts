/**
 * Unit tests for theme.ts – buildTheme() and getSurfaceVariant().
 */

import { describe, it, expect } from "vitest";
import { buildTheme, getSurfaceVariant } from "../src/theme";

describe("buildTheme", () => {
    it("returns a theme with palette.mode === 'light' for light mode", () => {
        const theme = buildTheme("light");
        expect(theme.palette.mode).toBe("light");
    });

    it("returns a theme with palette.mode === 'dark' for dark mode", () => {
        const theme = buildTheme("dark");
        expect(theme.palette.mode).toBe("dark");
    });

    it("uses the original primary colour (#A74A4A) in light mode", () => {
        const theme = buildTheme("light");
        expect(theme.palette.primary.main).toBe("#A74A4A");
    });

    it("uses the dark-mode primary colour (#D58881) in dark mode", () => {
        const theme = buildTheme("dark");
        expect(theme.palette.primary.main).toBe("#D58881");
    });

    it("sets light background.default to #ECECEC", () => {
        const theme = buildTheme("light");
        expect(theme.palette.background.default).toBe("#ECECEC");
    });

    it("sets dark background.default to #1E1E1E", () => {
        const theme = buildTheme("dark");
        expect(theme.palette.background.default).toBe("#1E1E1E");
    });

    it("includes typography with Roboto font family", () => {
        const theme = buildTheme("light");
        expect(theme.typography.fontFamily).toContain("Roboto");
    });
});

describe("getSurfaceVariant", () => {
    it("returns #DAC7B5 for light mode", () => {
        expect(getSurfaceVariant("light")).toBe("#DAC7B5");
    });

    it("returns #3A3230 for dark mode", () => {
        expect(getSurfaceVariant("dark")).toBe("#3A3230");
    });
});

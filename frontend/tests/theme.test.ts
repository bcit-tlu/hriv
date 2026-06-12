/**
 * Unit tests for theme.ts – buildTheme() and getSurfaceVariant().
 */

import { describe, it, expect } from "vitest";
import { buildTheme, getGroupChipColors, getSurfaceVariant, getVisibilityColors } from "../src/theme";

describe("buildTheme", () => {
    it("returns a theme with palette.mode === 'light' for light mode", () => {
        const theme = buildTheme("light");
        expect(theme.palette.mode).toBe("light");
    });

    it("returns a theme with palette.mode === 'dark' for dark mode", () => {
        const theme = buildTheme("dark");
        expect(theme.palette.mode).toBe("dark");
    });

    it("uses the primary colour (#A74A4A) in light mode", () => {
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

describe("getVisibilityColors", () => {
    it("returns light-mode visibility colours", () => {
        const c = getVisibilityColors("light");
        expect(c.active).toBe("rgba(0,0,0,0.45)");
        expect(c.inactive).toBe("#3E3C3Ab3");
        expect(c.inactiveChipBg).toBe("#6B6966");
    });

    it("returns dark-mode visibility colours", () => {
        const c = getVisibilityColors("dark");
        expect(c.active).toBe("rgba(255,255,255,0.70)");
        expect(c.inactive).toBe("#E0DDD999");
        expect(c.inactiveChipBg).toBe("#6B6966");
    });
});

describe("getGroupChipColors", () => {
    it("returns light-mode group colours based on the secondary palette", () => {
        const c = getGroupChipColors("light");
        expect(c.solidBg).toBe("#7F665D");
        expect(c.solidText).toBe("#FFFFFF");
        expect(c.subtleBg).toBe("rgba(127, 102, 93, 0.16)");
        expect(c.subtleText).toBe("#3E3C3A");
    });

    it("returns dark-mode group colours based on the secondary palette", () => {
        const c = getGroupChipColors("dark");
        expect(c.solidBg).toBe("#A89288");
        expect(c.solidText).toBe("#1E1E1E");
        expect(c.subtleBg).toBe("rgba(168, 146, 136, 0.16)");
        expect(c.subtleText).toBe("#E0DDD9");
    });
});

import { createContext } from "react";

/** The effective, resolved colour mode actually used to render the UI. */
export type ColorMode = "light" | "dark";

/**
 * The user's colour-mode preference.
 *
 * - `"light"` / `"dark"` – explicit override, persisted in localStorage.
 * - `"auto"` – follow the operating system (`prefers-color-scheme`).
 */
export type ColorModePreference = "light" | "dark" | "auto";

export interface ColorModeContextValue {
    /** The resolved mode (with `"auto"` collapsed to the current OS value). */
    mode: ColorMode;
    /** The user's stored preference, including `"auto"`. */
    preference: ColorModePreference;
    /** Explicitly set the preference (clears localStorage when `"auto"`). */
    setPreference: (preference: ColorModePreference) => void;
    /** Cycle preference through Light → Dark → Auto → Light. */
    toggleMode: () => void;
}

export const ColorModeContext = createContext<ColorModeContextValue>({
    mode: "light",
    preference: "auto",
    setPreference: () => {},
    toggleMode: () => {},
});

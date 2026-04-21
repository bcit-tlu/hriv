import {
    useState,
    useMemo,
    useCallback,
    useEffect,
    type ReactNode,
} from "react";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { buildTheme } from "./theme";
import {
    ColorModeContext,
    type ColorMode,
    type ColorModePreference,
} from "./colorModeContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "hriv-color-mode";

/** Read the stored user preference; missing / invalid values collapse to "auto". */
function getInitialPreference(): ColorModePreference {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "dark" || stored === "light") return stored;
    } catch {
        // localStorage may be unavailable (e.g. private browsing)
    }
    return "auto";
}

/** Read the current OS-level colour-scheme preference. */
function getSystemMode(): ColorMode {
    if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
        return "dark";
    }
    return "light";
}

/** Persist (or clear, for "auto") the preference in localStorage. */
function persistPreference(preference: ColorModePreference): void {
    try {
        if (preference === "auto") {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, preference);
        }
    } catch {
        // ignore
    }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ColorModeProviderProps {
    children: ReactNode;
}

export default function ColorModeProvider({ children }: ColorModeProviderProps) {
    const [preference, setPreferenceState] = useState<ColorModePreference>(
        getInitialPreference,
    );
    const [systemMode, setSystemMode] = useState<ColorMode>(getSystemMode);

    const setPreference = useCallback((next: ColorModePreference) => {
        persistPreference(next);
        setPreferenceState(next);
    }, []);

    // Cycle: Light → Dark → Auto → Light …
    const toggleMode = useCallback(() => {
        setPreferenceState((prev) => {
            const next: ColorModePreference =
                prev === "light" ? "dark" : prev === "dark" ? "auto" : "light";
            persistPreference(next);
            return next;
        });
    }, []);

    // Track OS-level preference so "auto" stays in sync when the system theme
    // changes (or when the user switches to "auto" after an OS change).
    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) => {
            setSystemMode(e.matches ? "dark" : "light");
        };
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    const mode: ColorMode = preference === "auto" ? systemMode : preference;

    const theme = useMemo(() => buildTheme(mode), [mode]);
    const ctx = useMemo(
        () => ({ mode, preference, setPreference, toggleMode }),
        [mode, preference, setPreference, toggleMode],
    );

    return (
        <ColorModeContext.Provider value={ctx}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                {children}
            </ThemeProvider>
        </ColorModeContext.Provider>
    );
}

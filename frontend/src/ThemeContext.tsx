import {
    useState,
    useMemo,
    useCallback,
    useEffect,
    type ReactNode,
} from "react";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { buildTheme } from "./theme";
import { ColorModeContext, type ColorMode } from "./colorModeContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "hriv-color-mode";

/** Read the stored preference, falling back to the OS preference. */
function getInitialMode(): ColorMode {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "dark" || stored === "light") return stored;
    } catch {
        // localStorage may be unavailable (e.g. private browsing)
    }
    if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
        return "dark";
    }
    return "light";
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ColorModeProviderProps {
    children: ReactNode;
}

export default function ColorModeProvider({ children }: ColorModeProviderProps) {
    const [mode, setMode] = useState<ColorMode>(getInitialMode);

    const toggleMode = useCallback(() => {
        setMode((prev) => {
            const next = prev === "light" ? "dark" : "light";
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch {
                // ignore
            }
            return next;
        });
    }, []);

    // Listen for OS-level preference changes so the UI stays in sync when no
    // explicit user choice has been persisted.
    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) => {
            // Only follow the OS if the user hasn't explicitly picked a mode
            let hasStored = false;
            try {
                hasStored = !!localStorage.getItem(STORAGE_KEY);
            } catch {
                // localStorage may be unavailable
            }
            if (!hasStored) {
                setMode(e.matches ? "dark" : "light");
            }
        };
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    const theme = useMemo(() => buildTheme(mode), [mode]);
    const ctx = useMemo(() => ({ mode, toggleMode }), [mode, toggleMode]);

    return (
        <ColorModeContext.Provider value={ctx}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                {children}
            </ThemeProvider>
        </ColorModeContext.Provider>
    );
}

import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import type { SxProps, Theme } from "@mui/material/styles";
import BrightnessAutoIcon from "@mui/icons-material/BrightnessAuto";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import { useColorMode } from "../useColorMode";
import type {
    ColorMode,
    ColorModePreference,
} from "../colorModeContext";

/** Describe the current preference and what the next click will do. */
function tooltipFor(preference: ColorModePreference, mode: ColorMode): string {
    switch (preference) {
        case "light":
            return "Theme: Light (click for Dark)";
        case "dark":
            return "Theme: Dark (click for Auto)";
        case "auto":
            return `Theme: Auto – follows system (${mode}) (click for Light)`;
    }
}

/** Icon representing the current preference. */
function iconFor(preference: ColorModePreference) {
    switch (preference) {
        case "light":
            return <LightModeIcon />;
        case "dark":
            return <DarkModeIcon />;
        case "auto":
            return <BrightnessAutoIcon />;
    }
}

interface ColorModeToggleProps {
    /** Optional sx overrides applied to the underlying IconButton. */
    iconButtonSx?: SxProps<Theme>;
}

/**
 * Three-way theme toggle button. Cycles Light → Dark → Auto on click.
 * "Auto" removes the persisted preference so the UI follows the OS
 * `prefers-color-scheme` setting.
 */
export default function ColorModeToggle({ iconButtonSx }: ColorModeToggleProps) {
    const { mode, preference, toggleMode } = useColorMode();
    return (
        <Tooltip title={tooltipFor(preference, mode)}>
            <IconButton
                onClick={toggleMode}
                aria-label="Toggle theme"
                sx={iconButtonSx}
            >
                {iconFor(preference)}
            </IconButton>
        </Tooltip>
    );
}

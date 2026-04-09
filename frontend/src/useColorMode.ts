import { useContext } from "react";
import { ColorModeContext, type ColorModeContextValue } from "./colorModeContext";

/** Hook to read and toggle the current colour mode from any component. */
export function useColorMode(): ColorModeContextValue {
    return useContext(ColorModeContext);
}

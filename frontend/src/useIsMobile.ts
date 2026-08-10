import useMediaQuery from '@mui/material/useMediaQuery'

/**
 * True when the app should render its mobile layout.
 *
 * Detecting "mobile" by viewport *width* alone (the old
 * `theme.breakpoints.down('sm')`) breaks when a phone is rotated to landscape:
 * an iPhone 14 Pro Max is 932px wide in landscape, well past the 600px `sm`
 * breakpoint, so every screen flipped to the desktop layout.
 *
 * This query is a two-clause list (comma = OR):
 *  - `(max-width: 599.95px)` — the original behaviour: portrait phones and any
 *    narrow viewport. `599.95px` matches MUI's `down('sm')` exactly.
 *  - `(pointer: coarse) and (max-height: 599.95px)` — adds *landscape phones*,
 *    whose width is large but whose height is still phone-sized. Gating on a
 *    coarse (touch) pointer means a merely short *desktop* window (fine pointer)
 *    does not flip into the mobile layout.
 *
 * Tablets (coarse pointer but a shortest side > 600px in either orientation)
 * keep the desktop layout, as before.
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 599.95px), (pointer: coarse) and (max-height: 599.95px)')
}

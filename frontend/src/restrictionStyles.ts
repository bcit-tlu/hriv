import type { SxProps, Theme } from '@mui/material/styles'

type RestrictionBaseSx =
  | Record<string, unknown>
  | ((theme: Theme) => Record<string, unknown>)

export const INHERITED_RESTRICTION_OPACITY = 0.6

export function getInheritedRestrictionOpacity(inherited: boolean): number {
  return inherited ? INHERITED_RESTRICTION_OPACITY : 1
}

export function getInheritedRestrictionSx(
  inherited: boolean,
  base?: RestrictionBaseSx,
): SxProps<Theme> | undefined {
  if (!inherited) return base
  if (base == null) return { opacity: INHERITED_RESTRICTION_OPACITY }
  return [{ opacity: INHERITED_RESTRICTION_OPACITY }, base]
}

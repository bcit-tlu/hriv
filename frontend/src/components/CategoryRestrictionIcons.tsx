import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import LockIcon from '@mui/icons-material/Lock'
import { getInheritedRestrictionOpacity } from '../restrictionStyles'

interface CategoryRestrictionIconsProps {
  hasProgramRestriction: boolean
  inheritedProgramRestriction: boolean
  hasGroupRestriction: boolean
  inheritedGroupRestriction: boolean
  hidden: boolean
  onProgramClick?: () => void
  onGroupClick?: () => void
}

function renderIcon({
  directLabel,
  inheritedLabel,
  inherited,
  hidden,
  color,
  onClick,
}: {
  directLabel: string
  inheritedLabel: string
  inherited: boolean
  hidden: boolean
  color: string
  onClick?: () => void
}) {
  const label = inherited ? inheritedLabel : directLabel
  const icon = (
    <LockIcon
      sx={{
        fontSize: 14,
        color: hidden ? 'action.active' : color,
        opacity: getInheritedRestrictionOpacity(inherited),
      }}
    />
  )

  if (onClick) {
    return (
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          sx={{ p: 0, ml: 0.5, verticalAlign: 'middle' }}
        >
          {icon}
        </IconButton>
      </Tooltip>
    )
  }

  return (
    <Tooltip title={label}>
      <span
        role="img"
        aria-label={label}
        style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4 }}
      >
        {icon}
      </span>
    </Tooltip>
  )
}

export default function CategoryRestrictionIcons({
  hasProgramRestriction,
  inheritedProgramRestriction,
  hasGroupRestriction,
  inheritedGroupRestriction,
  hidden,
  onProgramClick,
  onGroupClick,
}: CategoryRestrictionIconsProps) {
  return (
    <>
      {hasProgramRestriction &&
        renderIcon({
          directLabel: 'Restricted to specific programs',
          inheritedLabel: 'Program restriction inherited from parent',
          inherited: inheritedProgramRestriction,
          hidden,
          color: 'primary.main',
          onClick: onProgramClick,
        })}
      {hasGroupRestriction &&
        renderIcon({
          directLabel: 'Restricted to specific groups',
          inheritedLabel: 'Group restriction inherited from parent',
          inherited: inheritedGroupRestriction,
          hidden,
          color: 'secondary.main',
          onClick: onGroupClick,
        })}
    </>
  )
}

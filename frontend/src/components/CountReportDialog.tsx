/**
 * Object count report dialog (epic #1661, #1667).
 *
 * Figma-style modal: preview image with the group-coloured outlines drawn
 * over it (white halo + colour stroke, clipped to the selection), a "Group
 * n" legend, and a total row. Groups are appearance clusters, never named
 * cell types. No export, no editing, no show/hide toggles.
 *
 * ``container`` lets the caller mount the dialog inside the OSD viewer so
 * it stays visible in full-page mode.
 */

import CloseIcon from '@mui/icons-material/Close'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'

import type { ApiCountObject, ApiCountSelection } from '../api'
import { countGroupColor, countGroupLabel } from '../countPalette'
import { modeLabel } from '../countingUi'

export interface CountReportDialogProps {
  open: boolean
  onClose: () => void
  /** e.g. "Selection 2". */
  label: string
  mode: string
  selection: ApiCountSelection
  total: number
  groups: { group: number; count: number }[]
  objects: ApiCountObject[]
  preview: string | null
  onLearnMore: () => void
  /** Mount node — pass the OSD container to survive full-page mode. */
  container?: HTMLElement | (() => HTMLElement)
}

function SelectionOutlines({
  selection,
  objects,
}: {
  selection: ApiCountSelection
  objects: ApiCountObject[]
}) {
  const vb = `${selection.x} ${selection.y} ${selection.width} ${selection.height}`
  return (
    <Box
      component="svg"
      viewBox={vb}
      preserveAspectRatio="none"
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
      }}
    >
      <defs>
        <clipPath id="count-report-clip">
          <rect x={selection.x} y={selection.y} width={selection.width} height={selection.height} />
        </clipPath>
      </defs>
      <g clipPath="url(#count-report-clip)">
        {objects.map((obj, i) => {
          const pts = obj.polygon.map(([x, y]) => `${x},${y}`).join(' ')
          return (
            <g key={i}>
              <polygon
                points={pts}
                fill="none"
                stroke="#FFFFFF"
                strokeOpacity={0.6}
                strokeWidth={4}
                vectorEffect="non-scaling-stroke"
              />
              <polygon
                points={pts}
                fill="none"
                stroke={countGroupColor(obj.group)}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
      </g>
    </Box>
  )
}

export default function CountReportDialog({
  open,
  onClose,
  label,
  mode,
  selection,
  total,
  groups,
  objects,
  preview,
  onLearnMore,
  container,
}: CountReportDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      container={container}
      aria-labelledby="count-report-title"
      slotProps={{
        paper: {
          sx: {
            width: 'min(860px, calc(100% - 32px))',
            m: 2,
            maxHeight: 'calc(100% - 32px)',
          },
        },
      }}
    >
      <DialogTitle
        id="count-report-title"
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          pb: 1,
        }}
      >
        <Box>
          <Typography variant="h6" component="span" sx={{ display: 'block' }}>
            Object count report
          </Typography>
          <Typography variant="body2" color="text.secondary" component="span">
            {label} · {modeLabel(mode)}
          </Typography>
        </Box>
        <IconButton aria-label="Close report" onClick={onClose} sx={{ mt: -0.5, mr: -1 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: { xs: 2, sm: 3 } }}>
        <Paper
          variant="outlined"
          sx={{
            overflow: 'hidden',
            bgcolor: 'grey.900',
            position: 'relative',
            mx: 'auto',
            maxWidth: 690,
            aspectRatio: `${selection.width} / ${selection.height}`,
          }}
        >
          {preview ? (
            <Box
              component="img"
              src={preview}
              alt={`${label} with colour-coded object outlines`}
              sx={{
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit: 'cover',
              }}
            />
          ) : null}
          <SelectionOutlines selection={selection} objects={objects} />
          <Chip
            size="small"
            label={total === 1 ? '1 object found' : `${total} objects found`}
            sx={{
              position: 'absolute',
              top: 12,
              right: 12,
              // Theme-aware chip surface: `common.white` + `text.primary`
              // is white-on-white in dark mode.
              bgcolor: 'background.paper',
              color: 'text.primary',
              fontWeight: 600,
              boxShadow: 3,
            }}
          />
        </Paper>

        <Typography variant="subtitle2" component="div" sx={{ mt: 3, mb: 1.5 }}>
          Objects identified
        </Typography>
        {total === 0 ? (
          <Alert severity="info">No objects found in this selection.</Alert>
        ) : (
          <Paper variant="outlined">
            {groups.map((item, index) => (
              <Box key={item.group}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.35 }}>
                  <Box
                    role="img"
                    aria-label={`${countGroupLabel(item.group)} colour swatch`}
                    sx={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      bgcolor: countGroupColor(item.group),
                      boxShadow: (theme) =>
                        `inset 0 0 0 1px ${alpha(theme.palette.common.black, 0.12)}`,
                    }}
                  />
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>
                    {countGroupLabel(item.group)}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {item.count}
                  </Typography>
                </Stack>
                {index < groups.length - 1 && <Divider />}
              </Box>
            ))}
            <Divider />
            <Stack direction="row" sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}>
              <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 700 }}>
                Total objects
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
              >
                {total}
              </Typography>
            </Stack>
          </Paper>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Groups are based on appearance only, not cell type. Counts are computer-generated and may
          need review.{' '}
          <Link component="button" onClick={onLearnMore} underline="hover">
            Learn more about object counting
          </Link>
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

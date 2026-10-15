import { useRef } from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Slide from '@mui/material/Slide'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import type { ImageItem, ImageSourceInfo } from '../types'
import { formatFileSize } from '../formatUtils'
import type { MeasurementConfig } from './imageViewerUtils'

export interface ImageDetailsDrawerProps {
  image: Pick<ImageItem, 'copyright' | 'createdAt' | 'updatedAt' | 'width' | 'height' | 'fileSize'>
  programNames: string[]
  groupNames: string[]
  measurement?: MeasurementConfig | null
  sourceInfo?: ImageSourceInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Disables the trigger (e.g. canvas edit mode). The parent also forces open=false. */
  disabled?: boolean
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <Typography variant="body2" color="text.secondary" noWrap title={`${label} ${value}`}>
      <strong>{label}</strong> {value}
    </Typography>
  )
}

/**
 * Right-anchored "Image details" overlay drawer for the regular image viewer
 * (#1677). Rendered inside the OSD viewport via ImageViewer's `viewportOverlay`
 * portal — positioned children anchor to `viewer.container` (position:
 * relative). Both top-level children carry `data-hriv-canvas-ui` so
 * ImageViewer's selection tracker skips presses inside them.
 *
 * Holds only the metadata field list; notes, collections, and the viewer
 * instructions live in `ImageViewerInfoBar` below the viewer.
 */
export default function ImageDetailsDrawer({
  image,
  programNames,
  groupNames,
  measurement,
  sourceInfo,
  open,
  onOpenChange,
  disabled = false,
}: ImageDetailsDrawerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const fields: { label: string; value: string }[] = []
  if (image.copyright) fields.push({ label: 'Copyright:', value: image.copyright })
  if (programNames.length > 0)
    fields.push({
      label: `Program${programNames.length > 1 ? 's' : ''}:`,
      value: programNames.join(', '),
    })
  if (groupNames.length > 0)
    fields.push({
      label: `Group${groupNames.length > 1 ? 's' : ''}:`,
      value: groupNames.join(', '),
    })
  if (image.createdAt)
    fields.push({ label: 'Created:', value: new Date(image.createdAt).toLocaleString() })
  if (image.updatedAt)
    fields.push({ label: 'Modified:', value: new Date(image.updatedAt).toLocaleString() })
  if (image.width != null && image.height != null)
    fields.push({ label: 'Dimensions:', value: `${image.width} × ${image.height}` })
  if (image.fileSize != null) fields.push({ label: 'Size:', value: formatFileSize(image.fileSize) })
  if (measurement) {
    const value =
      measurement.scale && measurement.unit
        ? `${measurement.scale} px/${measurement.unit}`
        : measurement.scale
          ? `${measurement.scale} px`
          : (measurement.unit ?? '')
    if (value) fields.push({ label: 'Measurement:', value })
  }
  if (sourceInfo?.originalFilename != null)
    fields.push({ label: 'Original file:', value: sourceInfo.originalFilename })
  if (sourceInfo?.fileType != null) fields.push({ label: 'File type:', value: sourceInfo.fileType })
  if (sourceInfo?.uploadedByName != null)
    fields.push({ label: 'Uploaded by:', value: sourceInfo.uploadedByName })

  const close = () => {
    onOpenChange(false)
    triggerRef.current?.focus()
  }

  return (
    <>
      <Tooltip title="Image details" slotProps={{ popper: { disablePortal: true } }}>
        <IconButton
          ref={triggerRef}
          data-hriv-canvas-ui
          aria-label="Image details"
          aria-expanded={open}
          aria-controls="image-details-drawer"
          disabled={disabled}
          size="small"
          onClick={() => onOpenChange(!open)}
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 26,
            bgcolor: 'rgba(0,0,0,0.6)',
            color: 'common.white',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
          }}
        >
          <InfoOutlinedIcon />
        </IconButton>
      </Tooltip>
      <Slide
        direction="left"
        in={open}
        mountOnEnter
        unmountOnExit
        onEntered={() => closeRef.current?.focus()}
      >
        <Paper
          component="aside"
          id="image-details-drawer"
          aria-labelledby="image-details-drawer-title"
          elevation={8}
          square
          data-hriv-canvas-ui
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
          sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 30,
            width: 'max-content',
            minWidth: 260,
            maxWidth: 'min(440px, calc(100% - 48px))',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              py: 1,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="subtitle1" component="h2" id="image-details-drawer-title">
              Image details
            </Typography>
            <IconButton
              ref={closeRef}
              aria-label="Close image details"
              size="small"
              onClick={close}
            >
              <CloseIcon />
            </IconButton>
          </Box>
          <Box sx={{ overflowY: 'auto', px: 2, py: 1.5 }}>
            <Stack spacing={0.75}>
              {fields.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No details available.
                </Typography>
              ) : (
                fields.map((field) => (
                  <DetailField key={field.label} label={field.label} value={field.value} />
                ))
              )}
            </Stack>
          </Box>
        </Paper>
      </Slide>
    </>
  )
}

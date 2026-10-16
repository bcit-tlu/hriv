import { useRef } from 'react'
import type { RefObject } from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Slide from '@mui/material/Slide'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import type { ImageItem, ImageSourceInfo } from '../types'
import { formatFileSize } from '../formatUtils'
import type { MeasurementConfig } from './imageViewerUtils'

export interface ImageDetailsTriggerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Disables the trigger (e.g. canvas edit mode). The parent also forces open=false. */
  disabled?: boolean
  /** Shared with the panel so it can restore focus on close. */
  triggerRef: RefObject<HTMLButtonElement | null>
}

/**
 * The "i" trigger for `ImageDetailsDrawer`. Styled like the OSD toolbar
 * icons — same 48px svg assets with rest/hover/pressed states and a native
 * `title` tooltip — and mounted via ImageViewer's `viewportControl` OSD
 * control so it auto-fades with the toolbar.
 */
export function ImageDetailsTrigger({
  open,
  onOpenChange,
  disabled = false,
  triggerRef,
}: ImageDetailsTriggerProps) {
  return (
    <Box
      component="button"
      type="button"
      ref={triggerRef}
      data-hriv-canvas-ui
      title="Image details"
      aria-label="Image details"
      aria-expanded={open}
      aria-controls="image-details-drawer"
      disabled={disabled}
      onClick={() => onOpenChange(!open)}
      sx={{
        width: 48,
        height: 48,
        p: 0,
        border: 'none',
        borderRadius: 0,
        cursor: 'pointer',
        backgroundImage: 'url(/openseadragon-svg-icons/info_rest.svg)',
        backgroundSize: '100% 100%',
        '&:hover:not(:disabled), &:focus-visible': {
          backgroundImage: 'url(/openseadragon-svg-icons/info_hover.svg)',
        },
        '&:active:not(:disabled)': {
          backgroundImage: 'url(/openseadragon-svg-icons/info_pressed.svg)',
        },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'common.white',
          outlineOffset: '-2px',
        },
        '&:disabled': {
          opacity: 0.3,
          cursor: 'not-allowed',
        },
      }}
    />
  )
}

export interface ImageDetailsDrawerProps {
  image: Pick<ImageItem, 'copyright' | 'createdAt' | 'updatedAt' | 'width' | 'height' | 'fileSize'>
  programNames: string[]
  groupNames: string[]
  measurement?: MeasurementConfig | null
  sourceInfo?: ImageSourceInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Shared with `ImageDetailsTrigger` so the panel can restore focus on close. */
  triggerRef: RefObject<HTMLButtonElement | null>
}

function DetailField({
  label,
  value,
  title,
  tooltip,
}: {
  label: string
  value: string
  title?: string
  /** Tooltip shown on hover, tap or focus (touch-friendly timestamps). */
  tooltip?: string
}) {
  const text = (
    <Typography
      variant="body2"
      color="text.secondary"
      noWrap
      title={tooltip ? undefined : (title ?? `${label} ${value}`)}
      tabIndex={tooltip ? 0 : undefined}
    >
      <strong>{label}</strong> {value}
    </Typography>
  )
  if (!tooltip) return text
  return (
    <Tooltip
      title={tooltip}
      describeChild
      enterTouchDelay={0}
      leaveTouchDelay={3000}
      slotProps={{ popper: { disablePortal: true } }}
    >
      {text}
    </Tooltip>
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
  triggerRef,
}: ImageDetailsDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  const fields: { label: string; value: string; title?: string; tooltip?: string }[] = []
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
  // Dates show the long-form date; the native title keeps the exact timestamp.
  if (image.createdAt)
    fields.push({
      label: 'Created:',
      value: new Date(image.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      tooltip: `Created: ${new Date(image.createdAt).toLocaleString()}`,
    })
  if (image.updatedAt)
    fields.push({
      label: 'Modified:',
      value: new Date(image.updatedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      tooltip: `Modified: ${new Date(image.updatedAt).toLocaleString()}`,
    })
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
          <IconButton ref={closeRef} aria-label="Close image details" size="small" onClick={close}>
            <CloseIcon />
          </IconButton>
        </Box>
        {/* tabIndex makes the scroll region keyboard-scrollable (a11y). */}
        <Box tabIndex={0} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1.5 }}>
          <Stack spacing={0.75}>
            {fields.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No details available.
              </Typography>
            ) : (
              fields.map((field) => (
                <DetailField
                  key={field.label}
                  label={field.label}
                  value={field.value}
                  title={field.title}
                  tooltip={field.tooltip}
                />
              ))
            )}
          </Stack>
        </Box>
        {/* Footer instructions. `contain: inline-size` keeps the wrapping
              text out of the drawer's max-content width calculation. */}
        <Box
          role="region"
          aria-labelledby="image-details-viewer-controls"
          tabIndex={0}
          sx={{
            flexShrink: 0,
            maxHeight: '50%',
            overflowY: 'auto',
            borderTop: 1,
            borderColor: 'divider',
            px: 2,
            py: 1.5,
            contain: 'inline-size',
          }}
        >
          <Typography
            variant="subtitle2"
            component="h3"
            id="image-details-viewer-controls"
            sx={{ mb: 0.5 }}
          >
            Viewer controls
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {[
              'Scroll or tap to zoom',
              'Drag to move/pan',
              'Bottom left buttons control view',
              'Bottom right mini-map shows current view',
            ].map((item) => (
              <Typography
                key={item}
                component="li"
                variant="body2"
                color="text.secondary"
                sx={{ '& + li': { mt: 0.5 } }}
              >
                {item}
              </Typography>
            ))}
          </Box>
        </Box>
      </Paper>
    </Slide>
  )
}

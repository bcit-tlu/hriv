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
import LockIcon from '@mui/icons-material/Lock'
import type { ImageItem, ImageSourceInfo } from '../types'
import { formatFileSize } from '../formatUtils'
import type { MeasurementConfig } from './imageViewerUtils'
import { objectiveFromMetadata, objectiveLabel } from '../measurementUnits'
import { INSTRUCTOR_NOTE_VISIBILITY } from './InstructorNoteField'

export interface ImageDetailsTriggerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Disables the trigger (e.g. canvas edit mode). The parent also forces open=false. */
  disabled?: boolean
  /** Shared with the panel so it can restore focus on close. */
  triggerRef: RefObject<HTMLButtonElement | null>
  /**
   * `id` of the drawer it controls — defaults to the canonical
   * `image-details-drawer`; collections panes pass a unique one (#1862) so
   * two open drawers never share an id.
   */
  drawerId?: string
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
  drawerId = 'image-details-drawer',
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
      aria-controls={drawerId}
      disabled={disabled}
      onClick={() => onOpenChange(!open)}
      sx={{
        width: 48,
        height: 48,
        p: 0,
        border: 'none',
        borderRadius: 0,
        cursor: 'pointer',
        appearance: 'none',
        // Native buttons paint a ButtonFace grey that shows through the svg's
        // translucent black; keep the fill transparent like the OSD icons.
        backgroundColor: 'transparent',
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
  image: Pick<
    ImageItem,
    | 'instructorNote'
    | 'copyright'
    | 'createdAt'
    | 'updatedAt'
    | 'width'
    | 'height'
    | 'fileSize'
    | 'metadataExtra'
  >
  programNames: string[]
  groupNames: string[]
  measurement?: MeasurementConfig | null
  sourceInfo?: ImageSourceInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Shared with `ImageDetailsTrigger` so the panel can restore focus on close. */
  triggerRef: RefObject<HTMLButtonElement | null>
  /**
   * `id` for the panel — defaults to `image-details-drawer`; collections
   * panes pass a unique one (#1862) so two open drawers never share an id.
   * The title and viewer-controls ids derive from it.
   */
  drawerId?: string
  /**
   * Member context label (e.g. the image name) qualifying the landmark
   * names — collection panes pass it (#1862) so two open drawers are
   * distinguishable to assistive tech (`landmark-unique`). Unset, the
   * landmarks keep their plain `aria-labelledby` names.
   */
  drawerLabel?: string
}

function DetailField({
  label,
  value,
  title,
  tooltip,
  dense = false,
}: {
  label: string
  value: string
  title?: string
  /** Tooltip shown on hover, tap or focus (touch-friendly timestamps). */
  tooltip?: string
  dense?: boolean
}) {
  const text = (
    <Typography
      variant={dense ? 'caption' : 'body2'}
      component="p"
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
 * Holds the metadata field list, topped by the staff-only instructor note
 * when the API sends one (never for students). The description and
 * collections live in `ImageViewerInfoBar` below the viewer; the viewer
 * instructions sit in this drawer's footer.
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
  drawerId = 'image-details-drawer',
  drawerLabel,
}: ImageDetailsDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = `${drawerId}-title`
  const controlsId = `${drawerId}-viewer-controls`
  const asideLabel = drawerLabel ? `Image details — ${drawerLabel}` : undefined
  const controlsLabel = drawerLabel ? `Viewer controls — ${drawerLabel}` : undefined

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
        id={drawerId}
        aria-label={asideLabel}
        aria-labelledby={asideLabel ? undefined : titleId}
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
          <Typography variant="subtitle1" component="h2" id={titleId}>
            Image details
          </Typography>
          <IconButton ref={closeRef} aria-label="Close image details" size="small" onClick={close}>
            <CloseIcon />
          </IconButton>
        </Box>
        {/* tabIndex makes the scroll region keyboard-scrollable (a11y). */}
        <Box tabIndex={0} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1.5 }}>
          <ImageDetailsContent
            image={image}
            programNames={programNames}
            groupNames={groupNames}
            measurement={measurement}
            sourceInfo={sourceInfo}
          />
        </Box>
        {/* Footer instructions. `contain: inline-size` keeps the wrapping
              text out of the drawer's max-content width calculation. */}
        <Box
          role="region"
          aria-label={controlsLabel}
          aria-labelledby={controlsLabel ? undefined : controlsId}
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
          <Typography variant="subtitle2" component="h3" id={controlsId} sx={{ mb: 0.5 }}>
            Viewer controls
          </Typography>
          <ViewerControlHints />
        </Box>
      </Paper>
    </Slide>
  )
}

export function ImageDetailsContent({
  image,
  programNames,
  groupNames,
  measurement,
  sourceInfo,
  dense = false,
  showAll = false,
}: Pick<
  ImageDetailsDrawerProps,
  'image' | 'programNames' | 'groupNames' | 'measurement' | 'sourceInfo'
> & {
  dense?: boolean
  /** List every field, marking absent values "—" instead of omitting them. */
  showAll?: boolean
}) {
  const instructorNote = image.instructorNote?.trim() ?? ''
  const fields: { label: string; value: string; title?: string; tooltip?: string }[] = []
  const add = (
    label: string,
    value: string | null | undefined,
    extra: { title?: string; tooltip?: string } = {},
  ) => {
    if (value) fields.push({ label, value, ...extra })
    else if (showAll) fields.push({ label, value: '—', title: `${label} not recorded` })
  }
  const longDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  add('Copyright:', image.copyright)
  add(
    `Program${programNames.length > 1 ? 's' : ''}:`,
    programNames.length > 0 ? programNames.join(', ') : null,
  )
  add(
    `Group${groupNames.length > 1 ? 's' : ''}:`,
    groupNames.length > 0 ? groupNames.join(', ') : null,
  )
  // Dates show the long-form date; the tooltip keeps the exact timestamp.
  add('Created:', image.createdAt ? longDate(image.createdAt) : null, {
    tooltip: image.createdAt ? `Created: ${new Date(image.createdAt).toLocaleString()}` : undefined,
  })
  add('Modified:', image.updatedAt ? longDate(image.updatedAt) : null, {
    tooltip: image.updatedAt
      ? `Modified: ${new Date(image.updatedAt).toLocaleString()}`
      : undefined,
  })
  add(
    'Dimensions:',
    image.width != null && image.height != null ? `${image.width} × ${image.height}` : null,
  )
  add('Size:', image.fileSize != null ? formatFileSize(image.fileSize) : null)
  add(
    'Measurement:',
    !measurement
      ? null
      : measurement.scale && measurement.unit
        ? `${measurement.scale} px/${measurement.unit}`
        : measurement.scale
          ? `${measurement.scale} px`
          : measurement.unit,
  )
  const objective = objectiveFromMetadata(image.metadataExtra)
  add('Objective:', objective ? objectiveLabel(objective) : null)
  add('Original file:', sourceInfo?.originalFilename)
  add('File type:', sourceInfo?.fileType)
  add('Uploaded by:', sourceInfo?.uploadedByName)

  return (
    <Stack spacing={dense ? 0.5 : 0.75}>
      {instructorNote !== '' && (
        // Wraps (unlike the single-line fields): it can run to 500 characters.
        <Typography
          variant={dense ? 'caption' : 'body2'}
          component="p"
          color="text.secondary"
          data-testid="image-details-instructor-note"
          sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          <LockIcon
            fontSize="inherit"
            titleAccess={INSTRUCTOR_NOTE_VISIBILITY}
            sx={{ verticalAlign: 'text-bottom', mr: 0.5 }}
          />
          <strong>Instructor note:</strong> {instructorNote}
        </Typography>
      )}
      {fields.length === 0 && instructorNote === '' ? (
        <Typography variant={dense ? 'caption' : 'body2'} component="p" color="text.secondary">
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
            dense={dense}
          />
        ))
      )}
    </Stack>
  )
}

export function ViewerControlHints({ dense = false }: { dense?: boolean }) {
  return (
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
          variant={dense ? 'caption' : 'body2'}
          color="text.secondary"
          sx={{ '& + li': { mt: dense ? 0.25 : 0.5 } }}
        >
          {item}
        </Typography>
      ))}
    </Box>
  )
}

import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { ImageItem } from '../types'
import { formatFileSize } from '../formatUtils'
import type { MeasurementConfig } from './imageViewerUtils'
import NoteDisplay from './NoteDisplay'

export interface ImageInfoAccordionProps {
  image: Pick<
    ImageItem,
    'id' | 'copyright' | 'note' | 'createdAt' | 'updatedAt' | 'width' | 'height' | 'fileSize'
  >
  programNames: string[]
  groupNames: string[]
  measurement?: MeasurementConfig | null
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

export default function ImageInfoAccordion({
  image,
  programNames,
  groupNames,
  measurement,
  expanded,
  onExpandedChange,
}: ImageInfoAccordionProps) {
  const hasClassification = image.copyright || programNames.length > 0 || groupNames.length > 0
  const hasFileDetails =
    image.createdAt ||
    image.updatedAt ||
    (image.width != null && image.height != null) ||
    image.fileSize != null ||
    measurement

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, nextExpanded) => onExpandedChange(nextExpanded)}
      disableGutters
      elevation={0}
      variant="outlined"
      sx={{
        mt: 2,
        borderRadius: 2,
        bgcolor: 'background.paper',
        '&::before': { display: 'none' },
        '&.MuiAccordion-root:first-of-type, &.MuiAccordion-root:last-of-type': {
          borderRadius: 2,
        },
      }}
      slotProps={{ transition: { unmountOnExit: false } }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        id="image-info-header"
        aria-controls="image-info-content"
      >
        <Typography component="span" variant="subtitle2">
          Image information
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          {hasClassification && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                columnGap: '2em',
                rowGap: 1.5,
              }}
            >
              {image.copyright && (
                <Typography variant="body2" color="text.secondary" component="span">
                  <strong>Copyright:</strong> {image.copyright}
                </Typography>
              )}
              {programNames.length > 0 && (
                <Typography variant="body2" color="text.secondary" component="span">
                  <strong>Program{programNames.length > 1 ? 's' : ''}:</strong>{' '}
                  {programNames.join(', ')}
                </Typography>
              )}
              {groupNames.length > 0 && (
                <Typography variant="body2" color="text.secondary" component="span">
                  <strong>Group{groupNames.length > 1 ? 's' : ''}:</strong> {groupNames.join(', ')}
                </Typography>
              )}
            </Box>
          )}
          {image.note && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                width: '100%',
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                component="div"
                sx={{ whiteSpace: 'nowrap' }}
              >
                <strong>Note:&nbsp;</strong>
              </Typography>
              <Box sx={{ flex: '1 1 60%', minWidth: 0, maxWidth: { xs: '100%', sm: '60%' } }}>
                <NoteDisplay key={image.id} note={image.note} />
              </Box>
            </Box>
          )}
          {hasFileDetails && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                columnGap: '2em',
                rowGap: 1.5,
              }}
            >
              {image.createdAt && (
                <Typography variant="body2" color="text.secondary" component="span">
                  <strong>Created:</strong> {new Date(image.createdAt).toLocaleString()}
                </Typography>
              )}
              {image.updatedAt && (
                <Typography variant="body2" color="text.secondary" component="span">
                  <strong>Modified:</strong> {new Date(image.updatedAt).toLocaleString()}
                </Typography>
              )}
              {image.width != null && image.height != null && (
                <Typography variant="body2" color="text.secondary" component="span">
                  <strong>Dimensions:</strong> {image.width} &times; {image.height}
                </Typography>
              )}
              {image.fileSize != null && (
                <Typography variant="body2" color="text.secondary" component="span">
                  <strong>Size:</strong> {formatFileSize(image.fileSize)}
                </Typography>
              )}
              {measurement && (
                <Typography variant="body2" color="text.secondary" component="span">
                  <strong>Measurement:</strong>{' '}
                  {measurement.scale && measurement.unit
                    ? `${measurement.scale} px/${measurement.unit}`
                    : measurement.scale
                      ? `${measurement.scale} px`
                      : (measurement.unit ?? '')}
                </Typography>
              )}
            </Box>
          )}
          <Typography variant="body2" color="text.secondary">
            Scroll or tap to zoom, and drag to pan. Buttons in the bottom left corner control the
            view. On touch-devices, pinch-turn to rotate. The mini-map in the bottom-right corner
            shows your current viewport.
          </Typography>
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}

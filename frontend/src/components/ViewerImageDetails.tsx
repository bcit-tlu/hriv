import type { ImageItem } from '../types'
import { useImageSourceInfo } from '../useImageSourceInfo'
import { ImageDetailsContent } from './ImageDetailsDrawer'
import type { MeasurementConfig } from './imageViewerUtils'

export default function ViewerImageDetails({
  image,
  programNames,
  groupNames,
  measurement,
}: {
  image: ImageItem
  programNames: string[]
  groupNames: string[]
  measurement?: MeasurementConfig | null
}) {
  const sourceInfo = useImageSourceInfo(image.id, image.version, true)
  return (
    <ImageDetailsContent
      image={image}
      programNames={programNames}
      groupNames={groupNames}
      measurement={measurement}
      sourceInfo={sourceInfo}
    />
  )
}

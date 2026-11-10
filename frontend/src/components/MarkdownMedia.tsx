import { useState } from 'react'

export function MediaPlaceholder({ alt, fallback }: { alt: string; fallback: string }) {
  return (
    <span className="md-media-missing" role="img" aria-label={alt || fallback}>
      {alt || fallback}
    </span>
  )
}

/** `<img>` that swaps to the alt-text placeholder when the source fails to load. */
export function MarkdownImage({
  src,
  alt,
  caption = false,
}: {
  src: string
  alt: string
  /** Block images render the alt text as a figcaption while the image is showing. */
  caption?: boolean
}) {
  // Track which source failed so a new src (e.g. a refreshed token) retries the load.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) return <MediaPlaceholder alt={alt} fallback="Image unavailable" />
  return (
    <>
      <img src={src} alt={alt} loading="lazy" onError={() => setFailedSrc(src)} />
      {caption && alt ? <figcaption>{alt}</figcaption> : null}
    </>
  )
}

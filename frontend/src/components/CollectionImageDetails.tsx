import { createContext, useContext, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { ImageItem, ImageSourceInfo } from '../types'
import type { MeasurementConfig } from './imageViewerUtils'
import { useImageSourceInfo } from '../useImageSourceInfo'
import ImageDetailsDrawer, { ImageDetailsTrigger } from './ImageDetailsDrawer'

/** Resolved program/group display names for one collection member. */
export interface MemberInfoNames {
  programNames: string[]
  groupNames: string[]
}

interface CollectionImageDetailsContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  disabled: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
  image: ImageItem
  programNames: string[]
  groupNames: string[]
  measurement?: MeasurementConfig | null
  sourceInfo: ImageSourceInfo | null
  /** Unique drawer id — synchronized panes can have two drawers open at once. */
  drawerId: string
  /** Member name qualifying the landmark names so open panes' drawers are distinguishable. */
  drawerLabel: string
}

const CollectionImageDetailsContext = createContext<CollectionImageDetailsContextValue | null>(null)

export interface CollectionImageDetailsProps {
  image: ImageItem
  programNames: string[]
  groupNames: string[]
  measurement?: MeasurementConfig | null
  /** Disables the trigger (e.g. canvas edit mode, #1863) and forces the drawer closed. */
  disabled?: boolean
  children: ReactNode
}

/**
 * Shared open state for the image-details affordance inside a collection
 * viewer (#1862). The trigger and drawer mount in *different* ImageViewer
 * slots — `viewportControl` and `viewportOverlay` — so a context carries the
 * state between them; wrap each pane's `ImageViewer` in this provider and
 * place `<CollectionImageDetailsTrigger/>` / `<CollectionImageDetailsDrawer/>`
 * into the slots. Per-pane providers keep synchronized panes independent.
 */
export function CollectionImageDetails({
  image,
  programNames,
  groupNames,
  measurement,
  disabled = false,
  children,
}: CollectionImageDetailsProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const drawerId = `collection-details-${useId()}`
  const drawerLabel = image.name
  const sourceInfo = useImageSourceInfo(image.id, image.version, open)

  // A canvas-edit session (or any future `disabled` cause) closes the
  // drawer — same contract as the App's onCanvasEditModeChange handler.
  // State adjusted during render so the lint rule on effect setState is
  // satisfied; the drawer stays closed when `disabled` lifts.
  const [wasDisabled, setWasDisabled] = useState(disabled)
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled)
    if (disabled && open) setOpen(false)
  }

  const value = useMemo<CollectionImageDetailsContextValue>(
    () => ({
      open,
      setOpen,
      disabled,
      triggerRef,
      image,
      programNames,
      groupNames,
      measurement,
      sourceInfo,
      drawerId,
      drawerLabel,
    }),
    [
      open,
      disabled,
      image,
      programNames,
      groupNames,
      measurement,
      sourceInfo,
      drawerId,
      drawerLabel,
    ],
  )
  return (
    <CollectionImageDetailsContext.Provider value={value}>
      {children}
    </CollectionImageDetailsContext.Provider>
  )
}

/** `ImageDetailsTrigger` bound to the enclosing `CollectionImageDetails`. */
export function CollectionImageDetailsTrigger() {
  const ctx = useContext(CollectionImageDetailsContext)
  if (!ctx) return null
  return (
    <ImageDetailsTrigger
      open={ctx.open}
      onOpenChange={ctx.setOpen}
      disabled={ctx.disabled}
      triggerRef={ctx.triggerRef}
      drawerId={ctx.drawerId}
    />
  )
}

/** `ImageDetailsDrawer` bound to the enclosing `CollectionImageDetails`. */
export function CollectionImageDetailsDrawer() {
  const ctx = useContext(CollectionImageDetailsContext)
  if (!ctx) return null
  return (
    <ImageDetailsDrawer
      image={ctx.image}
      programNames={ctx.programNames}
      groupNames={ctx.groupNames}
      measurement={ctx.measurement}
      sourceInfo={ctx.sourceInfo}
      open={ctx.open}
      onOpenChange={ctx.setOpen}
      triggerRef={ctx.triggerRef}
      drawerId={ctx.drawerId}
      drawerLabel={ctx.drawerLabel}
    />
  )
}

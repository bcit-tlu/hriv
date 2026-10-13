import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import { ApiError, fetchCollectionGraph, userMessage, type ApiCollectionGraph } from '../api'
import CollectionsGraph, { type GraphTooltipInfo } from '../collectionsGraph/CollectionsGraph'
import { buildCollectionGraphModel } from '../collectionsGraph/buildCollectionModel'
import type { GraphModel, GraphNode } from '../collectionsGraph/types'
import type { CategoryPathSegment } from './CategoryBreadcrumb'

type GraphOrder = 1 | 2 | 3

interface Perspective {
  id: number
  name: string
}

export interface CollectionGraphDialogProps {
  open: boolean
  /** The collection the page's detail view is showing — the stack root. */
  collectionId: number
  collectionName: string
  /** Page category paths — category tooltip labels fall back to the
   *  payload's `path` when absent here. */
  categoryPaths: Map<number, CategoryPathSegment>
  onClose: () => void
  /** Page's image opener (fetches the full record then opens the viewer). */
  onOpenImage: (imageId: number) => void
  /** Page's collection opener — used by the "Open collection" action so a
   *  navigated perspective can become the real detail view. */
  onOpenCollection: (id: number) => void
  /** Story/tests inject a stub instead of hitting the API. */
  fetchGraph?: typeof fetchCollectionGraph
  /** Forwarded to CollectionsGraph — stories stop the sim for snapshots. */
  simulate?: boolean
}

/**
 * Local hub-and-spoke graph for one collection (#1630): hub = the
 * collection, spokes = its images, 2nd order adds related collections
 * (click pushes a new perspective), 3rd order adds member categories. The
 * breadcrumb stack is dialog-local — the page URL/detail never change.
 */
export default function CollectionGraphDialog({
  open,
  collectionId,
  collectionName,
  categoryPaths,
  onClose,
  onOpenImage,
  onOpenCollection,
  fetchGraph = fetchCollectionGraph,
  simulate = true,
}: CollectionGraphDialogProps) {
  const [stack, setStack] = useState<Perspective[]>([])
  const [order, setOrder] = useState<GraphOrder>(1)
  const [payload, setPayload] = useState<ApiCollectionGraph | null>(null)
  const [model, setModel] = useState<GraphModel | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gonePerspective, setGonePerspective] = useState(false)
  // Stale-response guard: perspective/order changes bump the epoch so a
  // late fetch cannot overwrite a newer perspective (#1636 pattern).
  const epochRef = useRef(0)

  const current = stack[stack.length - 1] ?? { id: collectionId, name: collectionName }
  const currentId = current.id

  // Render-phase adjustments: reset the perspective each time the dialog is
  // (re)opened, and mark the fetch pending when the perspective/order changes.
  const [openedFor, setOpenedFor] = useState<number | null>(null)
  if (open && openedFor !== collectionId) {
    setOpenedFor(collectionId)
    setStack([{ id: collectionId, name: collectionName }])
    setOrder(1)
    setGonePerspective(false)
  } else if (!open && openedFor !== null) {
    setOpenedFor(null)
  }
  const [pendingKey, setPendingKey] = useState('')
  const fetchKey = `${currentId}:${order}`
  if (open && pendingKey !== fetchKey) {
    const prevId = Number(pendingKey.split(':')[0])
    setPendingKey(fetchKey)
    setLoading(true)
    setError(null)
    if (pendingKey !== '' && prevId !== currentId) {
      // Perspective switch: drop the stale model so the remounted graph
      // cannot fit to the old hub's layout while the fetch is in flight.
      // Order-only changes keep it (positions carry over via `prev`).
      setModel(null)
      setPayload(null)
    }
  } else if (!open && pendingKey !== '') {
    setPendingKey('')
  }

  useEffect(() => {
    // Skip the transient render before the reset adjustment above applies.
    if (!open || openedFor !== collectionId || pendingKey !== fetchKey) return
    const epoch = ++epochRef.current
    fetchGraph(currentId, order)
      .then((p) => {
        if (epoch !== epochRef.current) return
        setPayload(p)
        setGonePerspective(false)
        // Order toggles keep the perspective (same hub id) → positions
        // carry over; a perspective switch starts fresh.
        setModel((prev) =>
          buildCollectionGraphModel(
            p,
            prev != null && prev.nodes[0]?.id === p.collection.id ? prev : undefined,
          ),
        )
      })
      .catch((err: unknown) => {
        if (epoch !== epochRef.current) return
        if (err instanceof ApiError && err.status === 404) {
          setGonePerspective(true)
          setError('This collection is no longer available.')
        } else {
          setError(userMessage(err, 'Failed to load the collection graph.'))
        }
        setPayload(null)
        setModel(null)
      })
      .finally(() => {
        if (epoch === epochRef.current) setLoading(false)
      })
  }, [open, currentId, order, fetchGraph, openedFor, collectionId, pendingKey, fetchKey])

  const handleNodeOpen = (id: number) => {
    if (id === currentId) return
    const rel = payload?.related_collections.find((c) => c.id === id)
    setStack((s) => [...s, { id, name: rel?.name ?? `Collection ${id}` }])
  }

  const popTo = (index: number) => setStack((s) => s.slice(0, index + 1))

  const handleImageOpen = (imageId: number) => {
    onClose()
    onOpenImage(imageId)
  }

  const tooltipInfo: GraphTooltipInfo = {
    categoryLabel: (categoryId) => {
      if (categoryId == null) return ''
      const seg = categoryPaths.get(categoryId)
      if (seg) return [...seg.ancestors, seg.category].map((c) => c.label).join(' › ')
      return payload?.categories.find((c) => c.id === categoryId)?.path ?? ''
    },
    // The local payload carries no owner data.
    ownerLabel: () => undefined,
    collectionName: (id) => {
      if (id === currentId) return current.name
      return (
        payload?.related_collections.find((c) => c.id === id)?.name ??
        stack.find((p) => p.id === id)?.name
      )
    },
  }

  // Image labels drop the hub collection's name prefix ("Slide 23-702
  // TRAN Elliot Image 12" → "Image 12") — the labelFor hook (#1630).
  const labelFor = (n: GraphNode): string => {
    if (n.kind !== 'image') return n.label
    const prefix = `${current.name} `
    return n.label.startsWith(prefix) ? n.label.slice(prefix.length) : n.label
  }

  const ms = model?.stats
  const statsCaption = ms
    ? `${ms.images} ${ms.images === 1 ? 'image' : 'images'}` +
      (ms.order >= 2
        ? ` · ${ms.shared} shared · ${ms.relatedCollections ?? 0} related ${
            (ms.relatedCollections ?? 0) === 1 ? 'collection' : 'collections'
          }`
        : '') +
      (ms.order >= 3
        ? ` · ${ms.categories} ${ms.categories === 1 ? 'category' : 'categories'}`
        : '')
    : undefined

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      data-testid="collection-graph-dialog"
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
        <Typography
          component="span"
          variant="inherit"
          noWrap
          sx={{ flexGrow: 1, minWidth: 0, fontSize: 'inherit', fontWeight: 'inherit' }}
        >
          {current.name} — graph
        </Typography>
        {currentId !== collectionId && (
          <Button
            size="small"
            data-testid="collection-graph-open-collection"
            onClick={() => {
              onClose()
              onOpenCollection(currentId)
            }}
          >
            Open collection
          </Button>
        )}
        <IconButton
          aria-label="Close graph"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <Box sx={{ px: 3, pb: 2 }}>
        <Breadcrumbs
          aria-label="graph perspective"
          data-testid="collection-graph-crumbs"
          sx={{ mb: 1 }}
        >
          {stack.map((p, i) =>
            i === stack.length - 1 ? (
              <Typography key={p.id} variant="body2" color="text.primary">
                {p.name}
              </Typography>
            ) : (
              <Link
                key={p.id}
                component="button"
                variant="body2"
                underline="hover"
                color="inherit"
                onClick={() => popTo(i)}
                sx={{ cursor: 'pointer' }}
              >
                {p.name}
              </Link>
            ),
          )}
        </Breadcrumbs>
        <Box sx={{ position: 'relative', height: '70vh' }}>
          {error && (
            <Alert
              severity="error"
              sx={{ mb: 1 }}
              action={
                gonePerspective && stack.length > 1 ? (
                  <Button color="inherit" size="small" onClick={() => popTo(stack.length - 2)}>
                    Back
                  </Button>
                ) : undefined
              }
            >
              {error}
            </Alert>
          )}
          {model && (
            // Remount per perspective so each collection gets its own
            // fit-once (#1630); order toggles keep positions + transform.
            <CollectionsGraph
              key={currentId}
              model={model}
              onOpenCollection={handleNodeOpen}
              onOpenImage={handleImageOpen}
              tooltipInfo={tooltipInfo}
              labelFor={labelFor}
              labelThresholds={{ image: 1 }}
              statsCaption={statsCaption}
              simulate={simulate}
              overlay={
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={order}
                  onChange={(_, v: GraphOrder | null) => {
                    if (v) setOrder(v)
                  }}
                  aria-label="Graph order"
                  data-testid="collection-graph-order"
                >
                  <Tooltip title="Images">
                    <ToggleButton value={1} aria-label="1st order">
                      1st
                    </ToggleButton>
                  </Tooltip>
                  <Tooltip title="+ related collections">
                    <ToggleButton value={2} aria-label="2nd order">
                      2nd
                    </ToggleButton>
                  </Tooltip>
                  <Tooltip title="+ categories">
                    <ToggleButton value={3} aria-label="3rd order">
                      3rd
                    </ToggleButton>
                  </Tooltip>
                </ToggleButtonGroup>
              }
            />
          )}
          {loading && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CircularProgress aria-label="Loading collection graph" />
            </Box>
          )}
        </Box>
      </Box>
    </Dialog>
  )
}

import { useState, useCallback, useMemo } from 'react'
import {
  collectionConflictCurrent,
  createCategory as apiCreateCategory,
  deleteCategory as apiDeleteCategory,
  updateCategory as apiUpdateCategory,
  updateImage as apiUpdateImage,
  userMessage,
} from './api'
import { apiCollectionToCollection, collectionFullMessage } from './collectionUtils'
import type { AddToCollectionResult } from './useAddToCollection'
import { tileOrderingCoordinator, type ScopeId } from './tileOrdering'
import type { ParentMove, ScopeOrder } from './components/manageCategoriesDialogUtils'
import { computeMoveRestrictionChange, narrowGroupIds, narrowProgramIds } from './categoryUtils'
import { emitEvent } from './observability'
import type { MoveRestrictionChange } from './categoryUtils'
import { findCollectionInTree, findImageInTree, findCategoryPath } from './treeUtils'
import type { Category, Collection, CollectionSummary, ImageItem, Role } from './types'

export interface PendingMoveConfirm {
  categoryId: number
  categoryLabel: string
  newParentId: number | null
  destinationLabel: string
  change: MoveRestrictionChange
  /** Whether the move was initiated from the MoveCategoryDialog, Browse DnD, or Manage DnD. */
  source: 'dialog' | 'dnd' | 'manage'
  manageReorder?: {
    moves: ParentMove[]
    scopes: ScopeOrder[]
    resolve: () => void
    reject: (reason?: unknown) => void
  }
}

function moveDestinationLabel(parentId: number | null, ancestorPath: Category[]): string {
  if (parentId === null) return 'root'
  return ancestorPath.at(-1)?.label ?? 'category'
}

export interface UseCategoryActionsDeps {
  categories: Category[]
  uncategorizedImages: ImageItem[]
  loadCategories: () => Promise<unknown>
  loadUncategorizedImages: (opts?: { signal?: AbortSignal }) => Promise<unknown>
  /**
   * Performs `POST /api/collections/{id}/move` (#1527) and keeps the
   * Collections-page list/detail state in sync (`useCollectionsData.move`).
   * Absent while collections are disabled — the move handlers no-op then.
   */
  moveCollectionApi?: (
    id: number,
    categoryId: number | null,
    version: number,
  ) => Promise<Collection>
  /**
   * Adds member images to a collection with dedupe + role-aware capacity
   * checks (`useCollectionsData.addImages`; #1530). Absent while collections
   * are disabled — the drop-add handler no-ops then.
   */
  addImagesToCollectionApi?: (
    collectionId: number,
    imageIds: number[],
    role?: Role | null,
  ) => Promise<AddToCollectionResult>
  /**
   * Removes member images from a collection — the undo path for the Browse
   * drop-add gesture (`useCollectionsData.removeImages`; #1530). `base` pins
   * the version the removal expects, so undo conflicts rather than rebasing
   * over another editor's intervening membership change.
   */
  removeImagesFromCollectionApi?: (
    collectionId: number,
    imageIds: number[],
    base?: Collection,
  ) => Promise<Collection>
  currentCategories: Category[]
  currentUserRole?: Role | null
  ancestorProgramIds: number[]
  ancestorGroupIds: number[]
  /** Live ancestry of the breadcrumb leaf (`useBrowseData.liveCategoryPath`). */
  liveCategoryPath: Category[]
  path: Category[]
  setPath: React.Dispatch<React.SetStateAction<Category[]>>
  editNameCategory: Category | null
  setErrorSnack: React.Dispatch<React.SetStateAction<string | null>>
  /** Surfaces non-blocking category advisories (e.g. program/group intersection). */
  setWarningSnack?: React.Dispatch<React.SetStateAction<string | null>>
  /** Surfaces informational notices (e.g. image already a collection member). */
  setInfoSnack?: React.Dispatch<React.SetStateAction<string | null>>
  setMoveSnack: React.Dispatch<React.SetStateAction<{ message: string; onUndo: () => void } | null>>
}

type CategoryStatusUpdate = 'active' | 'hidden'

export function useCategoryActions({
  categories,
  uncategorizedImages,
  loadCategories,
  loadUncategorizedImages,
  moveCollectionApi,
  addImagesToCollectionApi,
  removeImagesFromCollectionApi,
  currentCategories,
  currentUserRole,
  ancestorProgramIds,
  ancestorGroupIds,
  liveCategoryPath,
  path,
  setPath,
  editNameCategory,
  setErrorSnack,
  setWarningSnack,
  setInfoSnack,
  setMoveSnack,
}: UseCategoryActionsDeps) {
  const getAncestorPathForParent = useCallback(
    (parentId: number | null): Category[] => {
      if (parentId === null) return []
      return findCategoryPath(categories, parentId) ?? []
    },
    [categories],
  )
  const [moveCatOpen, setMoveCatOpen] = useState(false)
  const [movingCategory, setMovingCategory] = useState<Category | null>(null)
  const [moveCollectionOpen, setMoveCollectionOpen] = useState(false)
  const [movingCollection, setMovingCollection] = useState<CollectionSummary | null>(null)
  const [pendingMoveConfirm, setPendingMoveConfirm] = useState<PendingMoveConfirm | null>(null)

  const editCategoryContext = useMemo(() => {
    const fallback = {
      siblingNames: [] as string[],
      inheritedProgramIds: [] as number[],
      inheritedGroupIds: [] as number[],
      freshLabel: editNameCategory?.label ?? '',
      freshProgramIds: editNameCategory?.programIds ?? [],
      freshGroupIds: editNameCategory?.groupIds ?? [],
      freshChildren: editNameCategory?.children ?? [],
    }
    if (!editNameCategory) return fallback
    const isBreadcrumbCategory = path.length > 0 && path[path.length - 1].id === editNameCategory.id
    if (isBreadcrumbCategory) {
      // Read from the leaf's live ancestry, not the `path` snapshots, so a
      // reparent/rename since navigation yields the current parent's siblings
      // and inherited restrictions.
      const freshCat = liveCategoryPath[liveCategoryPath.length - 1]
      if (freshCat?.id !== editNameCategory.id) return fallback
      const liveAncestors = liveCategoryPath.slice(0, -1)
      const parentChildren =
        liveAncestors.length > 0 ? liveAncestors[liveAncestors.length - 1].children : categories
      const siblingNames = parentChildren
        .filter((c) => c.id !== editNameCategory.id)
        .map((c) => c.label)
      return {
        siblingNames,
        inheritedProgramIds: narrowProgramIds(liveAncestors),
        inheritedGroupIds: narrowGroupIds(liveAncestors),
        freshLabel: freshCat.label,
        freshProgramIds: freshCat.programIds,
        freshGroupIds: freshCat.groupIds,
        freshChildren: freshCat.children,
      }
    }
    const freshChild = currentCategories.find((c) => c.id === editNameCategory.id)
    return {
      siblingNames: currentCategories
        .filter((c) => c.id !== editNameCategory.id)
        .map((c) => c.label),
      inheritedProgramIds: ancestorProgramIds,
      inheritedGroupIds: ancestorGroupIds,
      freshLabel: freshChild?.label ?? editNameCategory.label,
      freshProgramIds: freshChild?.programIds ?? editNameCategory.programIds,
      freshGroupIds: freshChild?.groupIds ?? editNameCategory.groupIds,
      freshChildren: freshChild?.children ?? editNameCategory.children,
    }
  }, [
    editNameCategory,
    path,
    categories,
    currentCategories,
    ancestorProgramIds,
    ancestorGroupIds,
    liveCategoryPath,
  ])

  const addCategoryInline = useCallback(
    async (
      label: string,
      parentId: number | null,
      programIds?: number[],
      groupIds?: number[],
    ): Promise<number | void> => {
      const body: Parameters<typeof apiCreateCategory>[0] = {
        label,
        parent_id: parentId,
      }
      if (programIds !== undefined) body.program_ids = programIds
      if (groupIds !== undefined) body.group_ids = groupIds
      const created = await apiCreateCategory(body)
      emitEvent({
        event: 'category.created',
        action: 'create',
        outcome: 'success',
        category_id: created.id,
      })
      if (created.warnings?.length && setWarningSnack) {
        setWarningSnack(created.warnings.map((w) => w.message).join(' '))
      }
      await loadCategories()
      loadUncategorizedImages()
      return created.id
    },
    [loadCategories, loadUncategorizedImages, setWarningSnack],
  )

  const deleteCategoryInline = useCallback(
    async (categoryId: number) => {
      try {
        await apiDeleteCategory(categoryId)
        setPath((prev) => {
          const idx = prev.findIndex((seg) => seg.id === categoryId)
          return idx >= 0 ? prev.slice(0, idx) : prev
        })
        await loadCategories()
        loadUncategorizedImages()
      } catch (err) {
        console.error('Failed to delete category', err)
        setErrorSnack(userMessage(err, 'Failed to delete category.'))
      }
    },
    [loadCategories, loadUncategorizedImages, setPath, setErrorSnack],
  )

  const editCategoryInline = useCallback(
    async (
      categoryId: number,
      newLabel: string,
      programIds?: number[],
      groupIds?: number[],
      status?: CategoryStatusUpdate,
    ) => {
      const body: Parameters<typeof apiUpdateCategory>[1] = {
        label: newLabel,
      }
      if (programIds !== undefined) body.program_ids = programIds
      if (groupIds !== undefined) body.group_ids = groupIds
      if (status !== undefined) body.status = status
      const catPath = findCategoryPath(categories, categoryId)
      const version = catPath?.at(-1)?.version
      const updated = await apiUpdateCategory(categoryId, body, version)
      if (updated.warnings?.length && setWarningSnack) {
        setWarningSnack(updated.warnings.map((w) => w.message).join(' '))
      }
      await loadCategories()
    },
    [categories, loadCategories, setWarningSnack],
  )

  const toggleCategoryVisibility = useCallback(
    async (categoryId: number) => {
      try {
        const catPath = findCategoryPath(categories, categoryId)
        const current = catPath?.[catPath.length - 1]
        const newStatus: CategoryStatusUpdate = current?.status === 'hidden' ? 'active' : 'hidden'
        const updated = await apiUpdateCategory(
          categoryId,
          {
            status: newStatus,
          },
          current?.version,
        )
        await loadCategories()
        setPath((prev) =>
          prev.map((p) =>
            p.id === categoryId
              ? {
                  ...p,
                  status: updated.status ?? newStatus,
                  version: updated.version,
                }
              : p,
          ),
        )
      } catch (err) {
        console.error('Failed to toggle category visibility', err)
        setErrorSnack(userMessage(err, 'Failed to toggle category visibility.'))
      }
    },
    [categories, loadCategories, setErrorSnack, setPath],
  )

  // All scopes touched by the most recent Manage Categories reorder, for
  // the dialog's save-state indicator (a cross-parent move touches both the
  // source and destination scopes). Null until the first dialog reorder.
  const [manageReorderScopes, setManageReorderScopes] = useState<ScopeId[] | null>(null)

  /**
   * Persist a Manage Categories drop through the shared ordering contract
   * (epic #975, issue #982): parent changes go through the versioned
   * category PATCH (same as Browse moves), then the full interleaved order
   * of every affected scope is reported to the tile-ordering coordinator,
   * which persists it atomically via PUT /api/tile-order with CAS revisions
   * and explicit conflict handling.
   */
  const persistManageReorder = useCallback(
    async (moves: ParentMove[], scopes: ScopeOrder[]) => {
      for (const move of moves) {
        const catPath = findCategoryPath(categories, move.categoryId)
        const version = catPath?.at(-1)?.version
        // Distinguish "parent is root" (path found, length 1) from "path not
        // found" (stale tree): the latter must not invalidate the root scope
        // in place of the unknown real source scope.
        const oldParentId = catPath ? (catPath.at(-2)?.id ?? null) : undefined
        try {
          await apiUpdateCategory(move.categoryId, { parent_id: move.newParentId }, version)
        } catch (err) {
          console.error('Failed to move category', err)
          setErrorSnack(userMessage(err, 'Failed to move category.'))
          throw err
        }
        // The parent-move PATCH bumps the tile-order revision of both scopes
        // server-side, so any revision the coordinator still caches for them
        // is stale and would make the reportOrder below falsely 409.
        if (oldParentId !== undefined) {
          tileOrderingCoordinator.invalidateRevision(oldParentId)
        } else {
          // Unknown source scope (stale tree): the PATCH still bumped it
          // server-side, so invalidate every scope we are about to report —
          // over-invalidating only costs a re-seeding GET, while a missed
          // scope would 409 with a token the client knows is stale.
          for (const { scope } of scopes) {
            tileOrderingCoordinator.invalidateRevision(scope)
          }
        }
        tileOrderingCoordinator.invalidateRevision(move.newParentId)
      }
      for (const { scope, order, dragContext } of scopes) {
        tileOrderingCoordinator.reportOrder(scope, order, undefined, dragContext)
      }
      if (scopes.length > 0) {
        // Merge with previously tracked scopes that have not settled yet so
        // an earlier failed/conflicted save stays reachable from the
        // indicator; settled scopes are pruned by the clear-when-settled
        // effect in App.
        setManageReorderScopes((prev) => {
          const next = scopes.map((s) => s.scope)
          const nextKeys = new Set(next)
          for (const scope of prev ?? []) {
            const status = tileOrderingCoordinator.getScope(scope).status
            if (!nextKeys.has(scope) && status !== 'saved' && status !== 'idle') {
              next.push(scope)
            }
          }
          return next
        })
      }
    },
    [categories, setErrorSnack],
  )

  const reorderTilesFromManage = useCallback(
    async (moves: ParentMove[], scopes: ScopeOrder[]) => {
      const restrictionChangingMove = moves.find((move) => {
        const catPath = findCategoryPath(categories, move.categoryId)
        const category = catPath?.at(-1)
        if (!catPath || !category) return false
        const currentAncestors = catPath.slice(0, -1)
        const newAncestors = getAncestorPathForParent(move.newParentId)
        return computeMoveRestrictionChange(category, currentAncestors, newAncestors).hasChange
      })

      if (restrictionChangingMove) {
        const catPath = findCategoryPath(categories, restrictionChangingMove.categoryId)
        const category = catPath?.at(-1)
        if (catPath && category) {
          const currentAncestors = catPath.slice(0, -1)
          const newAncestors = getAncestorPathForParent(restrictionChangingMove.newParentId)
          const change = computeMoveRestrictionChange(category, currentAncestors, newAncestors)

          return new Promise<void>((resolve, reject) => {
            setPendingMoveConfirm({
              categoryId: restrictionChangingMove.categoryId,
              categoryLabel: category.label,
              newParentId: restrictionChangingMove.newParentId,
              destinationLabel: moveDestinationLabel(
                restrictionChangingMove.newParentId,
                newAncestors,
              ),
              change,
              source: 'manage',
              manageReorder: { moves, scopes, resolve, reject },
            })
          })
        }
      }

      await persistManageReorder(moves, scopes)
    },
    [categories, getAncestorPathForParent, persistManageReorder],
  )

  const doMoveCategory = useCallback(
    async (categoryId: number, newParentId: number | null) => {
      try {
        const catPath = findCategoryPath(categories, categoryId)
        const version = catPath?.at(-1)?.version
        // Distinguish "parent is root" (path found, length 1) from "path not
        // found" (stale tree): the latter must not invalidate the root scope
        // in place of the unknown real source scope.
        const oldParentId = catPath ? (catPath.at(-2)?.id ?? null) : undefined
        await apiUpdateCategory(categoryId, { parent_id: newParentId }, version)
        // The membership PATCH bumps both scopes' tile-order revisions
        // server-side, so any cached revision is stale.
        if (oldParentId !== undefined) {
          tileOrderingCoordinator.invalidateRevision(oldParentId)
        }
        tileOrderingCoordinator.invalidateRevision(newParentId)
        setMoveCatOpen(false)
        setMovingCategory(null)
        await loadCategories()
      } catch (err) {
        console.error('Failed to move category', err)
        setErrorSnack(userMessage(err, 'Failed to move category.'))
      }
    },
    [categories, loadCategories, setErrorSnack],
  )

  const handleMoveCategory = useCallback(
    async (categoryId: number, newParentId: number | null) => {
      const catPath = findCategoryPath(categories, categoryId)
      const category = catPath?.at(-1)
      if (!category) {
        await doMoveCategory(categoryId, newParentId)
        return
      }
      const currentAncestors = catPath ? catPath.slice(0, -1) : []
      const newAncestors = getAncestorPathForParent(newParentId)
      const change = computeMoveRestrictionChange(category, currentAncestors, newAncestors)
      if (change.hasChange) {
        setPendingMoveConfirm({
          categoryId,
          categoryLabel: category.label,
          newParentId,
          destinationLabel: moveDestinationLabel(newParentId, newAncestors),
          change,
          source: 'dialog',
        })
        return
      }
      await doMoveCategory(categoryId, newParentId)
    },
    [categories, doMoveCategory, getAncestorPathForParent],
  )

  const handleRequestMoveCategory = useCallback((cat: Category) => {
    setMovingCategory(cat)
    setMoveCatOpen(true)
  }, [])

  const handleDropImageOnCategory = useCallback(
    async (imageId: number, categoryId: number) => {
      try {
        const found = findImageInTree(categories, imageId)
        const img = found?.image ?? uncategorizedImages.find((i) => i.id === imageId)
        if (!img) return
        if (img.categoryId === categoryId) return
        const prevCategoryId = img.categoryId ?? null
        const targetName = findCategoryPath(categories, categoryId)?.at(-1)?.label ?? 'category'
        const updated = await apiUpdateImage(imageId, { category_id: categoryId }, img.version)
        tileOrderingCoordinator.invalidateRevision(prevCategoryId)
        tileOrderingCoordinator.invalidateRevision(categoryId)
        await loadCategories()
        loadUncategorizedImages()
        setMoveSnack({
          message: `Moved \u201c${img.name}\u201d to \u201c${targetName}\u201d`,
          onUndo: async () => {
            try {
              setMoveSnack(null)
              await apiUpdateImage(imageId, { category_id: prevCategoryId }, updated.version)
              tileOrderingCoordinator.invalidateRevision(prevCategoryId)
              tileOrderingCoordinator.invalidateRevision(categoryId)
              await loadCategories()
              loadUncategorizedImages()
            } catch (undoErr) {
              setErrorSnack(userMessage(undoErr, 'Failed to undo move.'))
            }
          },
        })
      } catch (err) {
        console.error('Failed to move image via drag-and-drop', err)
        setErrorSnack(userMessage(err, 'Failed to move image to category.'))
      }
    },
    [
      categories,
      uncategorizedImages,
      loadCategories,
      loadUncategorizedImages,
      setMoveSnack,
      setErrorSnack,
    ],
  )

  const doDropCategoryOnCategory = useCallback(
    async (draggedCategoryId: number, targetCategoryId: number) => {
      try {
        const draggedPath = findCategoryPath(categories, draggedCategoryId)
        // undefined = path not found (stale tree); null = parent is root.
        // An unknown source scope must not invalidate root in its place.
        const prevParentId = draggedPath ? (draggedPath.at(-2)?.id ?? null) : undefined
        const draggedName = draggedPath?.at(-1)?.label ?? 'category'
        const targetPath = findCategoryPath(categories, targetCategoryId)
        const targetName = targetPath?.at(-1)?.label ?? 'category'
        const draggedVersion = draggedPath?.at(-1)?.version
        const resp = await apiUpdateCategory(
          draggedCategoryId,
          {
            parent_id: targetCategoryId,
          },
          draggedVersion,
        )
        if (prevParentId !== undefined) {
          tileOrderingCoordinator.invalidateRevision(prevParentId)
        }
        tileOrderingCoordinator.invalidateRevision(targetCategoryId)
        await loadCategories()
        setMoveSnack({
          message: `Moved \u201c${draggedName}\u201d into \u201c${targetName}\u201d`,
          onUndo: async () => {
            try {
              setMoveSnack(null)
              await apiUpdateCategory(
                draggedCategoryId,
                {
                  parent_id: prevParentId ?? null,
                },
                resp.version,
              )
              if (prevParentId !== undefined) {
                tileOrderingCoordinator.invalidateRevision(prevParentId)
              }
              tileOrderingCoordinator.invalidateRevision(targetCategoryId)
              await loadCategories()
            } catch (undoErr) {
              setErrorSnack(userMessage(undoErr, 'Failed to undo move.'))
            }
          },
        })
      } catch (err) {
        console.error('Failed to move category via drag-and-drop', err)
        setErrorSnack(userMessage(err, 'Failed to move category.'))
      }
    },
    [categories, loadCategories, setMoveSnack, setErrorSnack],
  )

  const handleDropCategoryOnCategory = useCallback(
    async (draggedCategoryId: number, targetCategoryId: number) => {
      const draggedPath = findCategoryPath(categories, draggedCategoryId)
      const category = draggedPath?.at(-1)
      if (!category) {
        await doDropCategoryOnCategory(draggedCategoryId, targetCategoryId)
        return
      }
      const currentAncestors = draggedPath ? draggedPath.slice(0, -1) : []
      const newAncestors = findCategoryPath(categories, targetCategoryId) ?? []
      const change = computeMoveRestrictionChange(category, currentAncestors, newAncestors)
      if (change.hasChange) {
        setPendingMoveConfirm({
          categoryId: draggedCategoryId,
          categoryLabel: category.label,
          newParentId: targetCategoryId,
          destinationLabel: moveDestinationLabel(targetCategoryId, newAncestors),
          change,
          source: 'dnd',
        })
        return
      }
      await doDropCategoryOnCategory(draggedCategoryId, targetCategoryId)
    },
    [categories, doDropCategoryOnCategory],
  )

  /**
   * File a collection into a category via `POST /collections/{id}/move`
   * (epic #1525 / #1529). Mirrors the image move: no restriction-confirm —
   * a collection is a leaf, so the category ancestor gate is the only
   * change, same as moving an image. The move bumps both scopes' tile-order
   * revisions server-side, so the coordinator's cached revisions are stale.
   */
  const doMoveCollection = useCallback(
    async (collection: CollectionSummary, newCategoryId: number | null) => {
      if (!moveCollectionApi) return
      const prevCategoryId = collection.categoryId ?? null
      if (prevCategoryId === newCategoryId) {
        setMoveCollectionOpen(false)
        setMovingCollection(null)
        return
      }
      const targetName =
        newCategoryId === null
          ? null
          : (findCategoryPath(categories, newCategoryId)?.at(-1)?.label ?? 'category')
      try {
        const updated = await moveCollectionApi(collection.id, newCategoryId, collection.version)
        if (prevCategoryId != null) tileOrderingCoordinator.invalidateRevision(prevCategoryId)
        if (newCategoryId != null) tileOrderingCoordinator.invalidateRevision(newCategoryId)
        setMoveCollectionOpen(false)
        setMovingCollection(null)
        await loadCategories()
        setMoveSnack({
          message:
            newCategoryId === null
              ? `Removed “${collection.name}” from Browse`
              : `Moved “${collection.name}” to “${targetName ?? 'category'}”`,
          onUndo: async () => {
            try {
              setMoveSnack(null)
              // Undo targets the pre-move scope with the version the move
              // response returned — the API bumps it on every write.
              await moveCollectionApi(collection.id, prevCategoryId, updated.version)
              if (prevCategoryId != null) tileOrderingCoordinator.invalidateRevision(prevCategoryId)
              if (newCategoryId != null) tileOrderingCoordinator.invalidateRevision(newCategoryId)
              await loadCategories()
            } catch (undoErr) {
              setErrorSnack(userMessage(undoErr, 'Failed to undo move.'))
            }
          },
        })
      } catch (err) {
        console.error('Failed to move collection', err)
        // A 409 carries the authoritative record — refresh the open dialog's
        // collection so a retry posts the fresh version instead of
        // re-failing on the stale one captured when it opened (#1529).
        const conflict = collectionConflictCurrent(err)
        if (conflict) setMovingCollection(apiCollectionToCollection(conflict))
        setErrorSnack(userMessage(err, 'Failed to move collection.'))
        // Edit-dialog filing chains on this (#1567): return the failure as
        // an Error so the caller can rethrow it — the editor stays open with
        // the real message instead of closing on a partial save. `true |
        // Error | undefined` keeps the result unambiguous for callers that
        // ignore it (move dialog, drag handlers).
        return err instanceof Error ? err : new Error('Failed to move collection.')
      }
      return true
    },
    [categories, moveCollectionApi, loadCategories, setMoveSnack, setErrorSnack],
  )

  /** Dialog entry point — the picker keeps the collection's current scope
   *  preselected so an unchanged "Move" is a no-op. */
  const handleRequestMoveCollection = useCallback((collection: CollectionSummary) => {
    setMovingCollection(collection)
    setMoveCollectionOpen(true)
  }, [])

  const handleMoveCollection = useCallback(
    async (newCategoryId: number | null) => {
      if (!movingCollection) return
      await doMoveCollection(movingCollection, newCategoryId)
    },
    [movingCollection, doMoveCollection],
  )

  /** Browse-grid drop: a `col-` tile dropped on a category's near-half move
   *  zone lands here (issue #1529). */
  const handleDropCollectionOnCategory = useCallback(
    async (collectionId: number, targetCategoryId: number) => {
      const found = findCollectionInTree(categories, collectionId)
      const col = found?.collection
      if (!col) return
      if (col.categoryId === targetCategoryId) return
      await doMoveCollection(col, targetCategoryId)
    },
    [categories, doMoveCollection],
  )

  /**
   * Browse-grid drop-add (issue #1530): an `img-` tile dropped on a
   * collection tile's near-half "Add to collection" zone lands here. The
   * injected API fetches the fresh record, dedupes, and enforces the
   * synchronized cap; membership adds change the tile's `imageCount`, so the
   * containing category tree refreshes after a successful add. Undo
   * removes just the added member via the whole-replace `PUT /images`.
   */
  const handleDropImageOnCollection = useCallback(
    async (imageId: number, collectionId: number) => {
      if (!addImagesToCollectionApi || !removeImagesFromCollectionApi) return
      const col = findCollectionInTree(categories, collectionId)?.collection
      // The drop zone only renders for `permissions.canEdit`; this guard
      // covers the stale-list window before that summary refreshes.
      if (!col || !col.permissions.canEdit) return
      try {
        const result = await addImagesToCollectionApi(collectionId, [imageId], currentUserRole)
        if (result.status === 'already') {
          setInfoSnack?.(`This image is already in "${result.collection.name}".`)
          return
        }
        if (result.status === 'full') {
          setErrorSnack(
            collectionFullMessage(result.collection.name, result.collection.type, 'image'),
          )
          return
        }
        const imgName =
          findImageInTree(categories, imageId)?.image.name ??
          uncategorizedImages.find((i) => i.id === imageId)?.name ??
          'image'
        await loadCategories()
        setMoveSnack({
          message: `Added “${imgName}” to “${result.collection.name}”.`,
          // Undo pins the post-add record's version: a later write to the
          // collection by another editor surfaces as a conflict instead of
          // the undo silently rebasing over it (repo undo convention).
          onUndo: async () => {
            try {
              setMoveSnack(null)
              await removeImagesFromCollectionApi(collectionId, [imageId], result.collection)
              await loadCategories()
            } catch (undoErr) {
              setErrorSnack(userMessage(undoErr, 'Failed to undo add to collection.'))
            }
          },
        })
      } catch (err) {
        console.error('Failed to add image to collection via drag-and-drop', err)
        setErrorSnack(userMessage(err, 'Failed to add to collection.'))
      }
    },
    [
      categories,
      uncategorizedImages,
      addImagesToCollectionApi,
      currentUserRole,
      removeImagesFromCollectionApi,
      loadCategories,
      setInfoSnack,
      setMoveSnack,
      setErrorSnack,
    ],
  )

  const handleSetCardImage = useCallback(
    async (categoryId: number, imageId: number | null) => {
      try {
        const findCat = (cats: Category[]): Category | null => {
          for (const c of cats) {
            if (c.id === categoryId) return c
            const found = findCat(c.children)
            if (found) return found
          }
          return null
        }
        const cat = findCat(categories)
        const existing = cat?.metadataExtra ?? {}
        await apiUpdateCategory(
          categoryId,
          {
            metadata_extra: { ...existing, card_image_id: imageId },
          },
          cat?.version,
        )
        await loadCategories()
      } catch (err) {
        console.error('Failed to set card image', err)
        setErrorSnack(userMessage(err, 'Failed to set card image.'))
      }
    },
    [loadCategories, categories, setErrorSnack],
  )

  const confirmPendingMove = useCallback(async () => {
    if (!pendingMoveConfirm) return
    const { categoryId, newParentId, source, manageReorder } = pendingMoveConfirm
    setPendingMoveConfirm(null)
    if (source === 'manage' && manageReorder) {
      try {
        await persistManageReorder(manageReorder.moves, manageReorder.scopes)
        manageReorder.resolve()
      } catch (err) {
        manageReorder.reject(err)
      }
    } else if (source === 'dnd' && newParentId !== null) {
      await doDropCategoryOnCategory(categoryId, newParentId)
    } else {
      await doMoveCategory(categoryId, newParentId)
    }
  }, [pendingMoveConfirm, persistManageReorder, doDropCategoryOnCategory, doMoveCategory])

  const cancelPendingMove = useCallback(() => {
    pendingMoveConfirm?.manageReorder?.reject(new Error('move confirmation cancelled'))
    setPendingMoveConfirm(null)
  }, [pendingMoveConfirm])

  const currentPendingMoveConfirm = useMemo(() => {
    if (!pendingMoveConfirm) return null
    const catPath = findCategoryPath(categories, pendingMoveConfirm.categoryId)
    const category = catPath?.at(-1)
    if (!catPath || !category) return pendingMoveConfirm

    const newAncestors = getAncestorPathForParent(pendingMoveConfirm.newParentId)
    if (pendingMoveConfirm.newParentId !== null && newAncestors.length === 0) {
      return pendingMoveConfirm
    }

    const change = computeMoveRestrictionChange(category, catPath.slice(0, -1), newAncestors)

    return {
      ...pendingMoveConfirm,
      categoryLabel: category.label,
      destinationLabel: moveDestinationLabel(pendingMoveConfirm.newParentId, newAncestors),
      change,
    }
  }, [categories, getAncestorPathForParent, pendingMoveConfirm])

  return {
    moveCatOpen,
    setMoveCatOpen,
    movingCategory,
    setMovingCategory,
    pendingMoveConfirm: currentPendingMoveConfirm,
    confirmPendingMove,
    cancelPendingMove,
    editCategoryContext,
    addCategoryInline,
    deleteCategoryInline,
    editCategoryInline,
    toggleCategoryVisibility,
    reorderTilesFromManage,
    manageReorderScopes,
    setManageReorderScopes,
    handleMoveCategory,
    handleRequestMoveCategory,
    handleDropImageOnCategory,
    handleDropCategoryOnCategory,
    moveCollectionOpen,
    setMoveCollectionOpen,
    movingCollection,
    setMovingCollection,
    handleRequestMoveCollection,
    handleMoveCollection,
    /**
     * Direct filing without the move dialog (#1566) — the Edit Collection
     * dialog's category picker saves through the same move path (snackbar +
     * undo + tile-order invalidation).
     */
    moveCollectionTo: doMoveCollection,
    handleDropCollectionOnCategory,
    handleDropImageOnCollection,
    handleSetCardImage,
  }
}

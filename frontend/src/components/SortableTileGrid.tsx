import { useCallback, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import {
    DragDropProvider,
    DragOverlay,
    useDroppable,
    PointerSensor,
    KeyboardSensor,
} from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { arrayMove } from "@dnd-kit/helpers";
import { directionBiased, pointerIntersection } from "@dnd-kit/collision";
import { CollisionPriority } from "@dnd-kit/abstract";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import type { Draggable } from "@dnd-kit/abstract";
import type { Category, ImageItem, Program } from "../types";
import CategoryTile from "./CategoryTile";
import ImageTile from "./ImageTile";
import FileDropZone from "./FileDropZone";
import { reorderImages, reorderCategories } from "../api";
import {
    buildTileItems,
    tileId,
    DROP_PREFIX,
    collectDescendantIds,
    findCategory,
} from "./sortableTileGridUtils";
import type { TileItem } from "./sortableTileGridUtils";

// ── Sortable wrapper ────────────────────────────────────────
// Per-droppable collision: directionBiased prevents jitter by
// only detecting collisions in the drag direction.

interface SortableItemProps {
    id: string;
    index: number;
    disabled: boolean;
    children: React.ReactNode;
}

function SortableItem({ id, index, disabled, children }: SortableItemProps) {
    const { ref, isDragSource } = useSortable({
        id,
        index,
        disabled,
        type: "tile",
        collisionDetector: directionBiased,
    });

    return (
        <div
            ref={ref}
            style={{
                opacity: isDragSource ? 0.5 : 1,
                position: "relative",
                width: "100%",
                maxWidth: 300,
                cursor: disabled ? undefined : isDragSource ? "grabbing" : "grab",
            }}
            onDragStart={(e) => e.preventDefault()}
        >
            {children}
        </div>
    );
}

// ── Droppable category zone (for move-into-category) ─────────
// Per-droppable collision: pointerIntersection activates only
// when the pointer is inside the rect — precise move detection.
// CollisionPriority.High ensures move wins over sortable reorder
// when the pointer is inside a category tile.

interface DroppableCategoryZoneProps {
    categoryId: number;
    disabled: boolean;
    /** Map from category ID → set of IDs blocked as drop targets for that source (self + descendants). */
    blockedIdsMap: Map<number, Set<number>>;
    children: React.ReactNode;
}

function DroppableCategoryZone({
    categoryId,
    disabled,
    blockedIdsMap,
    children,
}: DroppableCategoryZoneProps) {
    const acceptFilter = useCallback(
        (source: Draggable) => {
            const sourceId = String(source.id);
            if (!sourceId.startsWith("cat-")) return true;
            const catId = Number(sourceId.slice(4));
            const blockedTargets = blockedIdsMap.get(catId);
            return !blockedTargets?.has(categoryId);
        },
        [blockedIdsMap, categoryId],
    );

    const { ref, isDropTarget } = useDroppable({
        id: `${DROP_PREFIX}${categoryId}`,
        disabled,
        collisionDetector: pointerIntersection,
        collisionPriority: CollisionPriority.High,
        accept: acceptFilter,
    });

    return (
        <Box
            ref={ref}
            role="region"
            aria-label="Move into category"
            sx={{
                position: "relative",
                outline: "3px dashed",
                outlineColor: isDropTarget ? "primary.main" : "transparent",
                outlineOffset: 3,
                transform: isDropTarget ? "scale(1.03)" : "scale(1)",
                transition: "outline-color 0.2s, transform 0.15s",
                borderRadius: "inherit",
            }}
        >
            {children}
            {isDropTarget && (
                <Box
                    sx={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 1100,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: (theme) =>
                            alpha(theme.palette.background.paper, 0.82),
                        borderRadius: "inherit",
                        pointerEvents: "none",
                        gap: 0.5,
                    }}
                >
                    <Box
                        sx={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            bgcolor: "primary.main",
                            color: "primary.contrastText",
                        }}
                    >
                        <DriveFileMoveIcon sx={{ fontSize: 22 }} />
                    </Box>
                    <Typography
                        variant="caption"
                        sx={{
                            fontWeight: 600,
                            color: "primary.main",
                        }}
                    >
                        Move here
                    </Typography>
                </Box>
            )}
        </Box>
    );
}

// ── Main component ──────────────────────────────────────────

export interface SortableTileGridProps {
    /** Full category tree — used for ancestor-cycle prevention during drag. */
    allCategories: Category[];
    currentCategories: Category[];
    currentImages: ImageItem[];
    uncategorizedImages: ImageItem[];
    /** Current navigation path — used to determine parent_id for category reorder. */
    path: Category[];
    canEditContent: boolean;
    fileDragActive: boolean;
    programs: Program[];

    // CategoryTile callbacks
    onCategoryClick: (cat: Category) => void;
    onMoveCategory?: (cat: Category) => void;
    onSetCardImage?: (categoryId: number, imageId: number | null) => void;
    onToggleCategoryVisibility?: (categoryId: number) => Promise<void>;
    onEditCategoryName?: (cat: Category) => void;
    onDropImageOnCategory?: (imageId: number, categoryId: number) => void;
    onDropCategoryOnCategory?: (categoryId: number, targetCategoryId: number) => void;
    onDropFilesOnCategory?: (categoryId: number, files: File[]) => void;

    // ImageTile callbacks
    onImageClick: (img: ImageItem) => void;
    onEditImageDetails?: (img: ImageItem) => void;
    onToggleImageVisibility?: (imageId: number) => Promise<void>;

    // FileDropZone callback
    onFilesDrop: (files: File[]) => void;

    // Tile-grid-level file drop handlers (for native OS drops on the grid)
    onGridDragOver?: React.DragEventHandler;
    onGridDrop?: React.DragEventHandler;

    // Called after a successful reorder so parent can refresh data
    onReorderComplete?: () => void;

    // Called when a reorder API call fails so the parent can show feedback
    onReorderError?: (err: unknown) => void;
}

export default function SortableTileGrid({
    allCategories,
    currentCategories,
    currentImages,
    uncategorizedImages,
    path,
    canEditContent,
    fileDragActive,
    programs,
    onCategoryClick,
    onMoveCategory,
    onSetCardImage,
    onToggleCategoryVisibility,
    onEditCategoryName,
    onDropImageOnCategory,
    onDropCategoryOnCategory,
    onDropFilesOnCategory,
    onImageClick,
    onEditImageDetails,
    onToggleImageVisibility,
    onFilesDrop,
    onGridDragOver,
    onGridDrop,
    onReorderComplete,
    onReorderError,
}: SortableTileGridProps) {
    // Merge categories + images at this level into an interleaved sorted list.
    // At root (path.length === 0), uncategorized images join the grid.
    const visibleImages = useMemo(
        () =>
            path.length === 0
                ? [...uncategorizedImages, ...currentImages]
                : currentImages,
        [path.length, uncategorizedImages, currentImages],
    );

    const [items, setItems] = useState<TileItem[]>([]);
    const reorderInFlightRef = useRef(false);
    const prevCatsRef = useRef<Category[] | null>(null);
    const prevImgsRef = useRef<ImageItem[] | null>(null);

    // Rebuild the sorted item list whenever source data changes by reference,
    // unless an optimistic reorder is in-flight (to avoid reverting the drag).
    if (
        prevCatsRef.current !== currentCategories ||
        prevImgsRef.current !== visibleImages
    ) {
        prevCatsRef.current = currentCategories;
        prevImgsRef.current = visibleImages;
        if (!reorderInFlightRef.current) {
            setItems(buildTileItems(currentCategories, visibleImages));
        }
    }

    // Pre-compute blocked drop target IDs for each category (self + descendants).
    // Used by DroppableCategoryZone accept filters for ancestor-cycle prevention.
    const blockedIdsMap = useMemo(() => {
        const map = new Map<number, Set<number>>();
        for (const cat of currentCategories) {
            const fullCat = findCategory(allCategories, cat.id);
            const blocked = fullCat
                ? collectDescendantIds(fullCat)
                : new Set<number>();
            blocked.add(cat.id);
            map.set(cat.id, blocked);
        }
        return map;
    }, [allCategories, currentCategories]);

    const [activeItem, setActiveItem] = useState<TileItem | null>(null);

    const handleDragEnd = useCallback(
        async (event: { operation: { source: { id: string | number } | null; target: { id: string | number } | null; canceled: boolean } }) => {
            setActiveItem(null);
            const { operation } = event;
            if (operation.canceled) return;

            const source = operation.source;
            const target = operation.target;
            if (!source || !target || source.id === target.id) return;

            // Reject concurrent drags — wait for the in-flight reorder to settle
            if (reorderInFlightRef.current) return;

            const targetId = String(target.id);
            const sourceId = String(source.id);

            // ── Move into category (drop on a droppable zone) ──
            if (targetId.startsWith(DROP_PREFIX)) {
                const targetCatId = Number(targetId.slice(DROP_PREFIX.length));
                if (sourceId.startsWith("img-")) {
                    const imgId = Number(sourceId.slice(4));
                    onDropImageOnCategory?.(imgId, targetCatId);
                } else if (sourceId.startsWith("cat-")) {
                    const catId = Number(sourceId.slice(4));
                    onDropCategoryOnCategory?.(catId, targetCatId);
                }
                return;
            }

            // ── Reorder (drop between items) ──
            const oldIndex = items.findIndex(
                (item) => tileId(item) === sourceId,
            );
            const newIndex = items.findIndex(
                (item) => tileId(item) === targetId,
            );
            if (oldIndex === -1 || newIndex === -1) return;

            const reordered = arrayMove(items, oldIndex, newIndex);

            // Optimistically update local state; guard rebuilds until API settles
            reorderInFlightRef.current = true;
            setItems(reordered);

            // Compute new sort_order values (sequential from 0)
            const catUpdates: Array<{
                id: number;
                parent_id: number | null;
                sort_order: number;
            }> = [];
            const imgUpdates: Array<{ id: number; sort_order: number }> = [];
            const parentId =
                path.length > 0 ? path[path.length - 1].id : null;

            reordered.forEach((item, index) => {
                if (item.type === "category") {
                    catUpdates.push({
                        id: item.data.id,
                        parent_id: parentId,
                        sort_order: index,
                    });
                } else {
                    imgUpdates.push({
                        id: item.data.id,
                        sort_order: index,
                    });
                }
            });

            try {
                const promises: Promise<void>[] = [];
                if (catUpdates.length > 0) {
                    promises.push(reorderCategories(catUpdates));
                }
                if (imgUpdates.length > 0) {
                    promises.push(reorderImages(imgUpdates));
                }
                const results = await Promise.allSettled(promises);
                const failed = results.filter(
                    (r) => r.status === "rejected",
                );
                reorderInFlightRef.current = false;
                if (failed.length > 0) {
                    const err =
                        (failed[0] as PromiseRejectedResult).reason ??
                        new Error("Reorder partially failed");
                    console.error("Reorder partially failed", failed);
                    // Revert only if no subsequent drag has changed items
                    setItems((current) =>
                        current === reordered ? items : current,
                    );
                    onReorderError?.(err);
                }
                // Always refresh from server to reconcile state
                onReorderComplete?.();
            } catch (err) {
                console.error("Failed to persist reorder", err);
                reorderInFlightRef.current = false;
                setItems((current) =>
                    current === reordered ? items : current,
                );
                onReorderError?.(err);
                onReorderComplete?.();
            }
        },
        [
            items,
            path,
            onReorderComplete,
            onReorderError,
            onDropImageOnCategory,
            onDropCategoryOnCategory,
        ],
    );

    const renderCategoryTile = (cat: Category, wrapDroppable = false) => {
        const tile = (
            <CategoryTile
                category={cat}
                onClick={onCategoryClick}
                onMove={canEditContent ? onMoveCategory : undefined}
                onSetCardImage={canEditContent ? onSetCardImage : undefined}
                onToggleVisibility={
                    canEditContent ? onToggleCategoryVisibility : undefined
                }
                onEditName={canEditContent ? onEditCategoryName : undefined}
                programs={programs}
                onDropFiles={canEditContent ? onDropFilesOnCategory : undefined}
            />
        );
        if (!wrapDroppable) return tile;
        return (
            <DroppableCategoryZone
                categoryId={cat.id}
                disabled={!canEditContent}
                blockedIdsMap={blockedIdsMap}
            >
                {tile}
            </DroppableCategoryZone>
        );
    };

    const renderImageTile = (img: ImageItem) => (
        <ImageTile
            image={img}
            onClick={onImageClick}
            onEditDetails={canEditContent ? onEditImageDetails : undefined}
            onToggleVisibility={
                canEditContent ? onToggleImageVisibility : undefined
            }
        />
    );

    return (
        <DragDropProvider
            sensors={[
                PointerSensor.configure({
                    activationConstraints: [
                        new PointerActivationConstraints.Distance({ value: 5 }),
                    ],
                }),
                KeyboardSensor,
            ]}
            onDragStart={(event) => {
                const sourceId = String(event.operation.source?.id);
                const item = items.find((i) => tileId(i) === sourceId);
                setActiveItem(item ?? null);
            }}
            onDragEnd={handleDragEnd}
        >
            <Box
                role="region"
                aria-label="Sortable tile grid"
                sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 2,
                }}
                onDragOver={onGridDragOver}
                onDrop={onGridDrop}
            >
                {items.map((item, index) => {
                    const id = tileId(item);
                    return (
                        <SortableItem
                            key={id}
                            id={id}
                            index={index}
                            disabled={!canEditContent}
                        >
                            {item.type === "category"
                                ? renderCategoryTile(
                                      item.data,
                                      true,
                                  )
                                : renderImageTile(
                                      item.data as ImageItem,
                                  )}
                        </SortableItem>
                    );
                })}
                {canEditContent && (
                    <FileDropZone
                        isDragActive={fileDragActive}
                        onDrop={onFilesDrop}
                    />
                )}
            </Box>
            <DragOverlay dropAnimation={null}>
                {activeItem
                    ? activeItem.type === "category"
                        ? (
                              <Box
                                  sx={{
                                      opacity: 0.85,
                                      width: 300,
                                      pointerEvents: "none",
                                      cursor: "grabbing",
                                  }}
                              >
                                  {renderCategoryTile(activeItem.data)}
                              </Box>
                          )
                        : (
                              <Box
                                  sx={{
                                      opacity: 0.85,
                                      width: 300,
                                      pointerEvents: "none",
                                      cursor: "grabbing",
                                  }}
                              >
                                  {renderImageTile(activeItem.data)}
                              </Box>
                          )
                    : null}
            </DragOverlay>
        </DragDropProvider>
    );
}

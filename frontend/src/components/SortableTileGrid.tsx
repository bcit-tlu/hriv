import { useCallback, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useDroppable,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import {
    SortableContext,
    useSortable,
    rectSortingStrategy,
    arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Category, ImageItem, Program } from "../types";
import CategoryTile from "./CategoryTile";
import ImageTile from "./ImageTile";
import FileDropZone from "./FileDropZone";
import { reorderImages, reorderCategories } from "../api";
import {
    buildTileItems,
    tileId,
    DROP_PREFIX,
    moveOrReorder,
} from "./sortableTileGridUtils";
import type { TileItem } from "./sortableTileGridUtils";

// ── Sortable wrapper ────────────────────────────────────────

interface SortableItemProps {
    id: string;
    disabled: boolean;
    children: React.ReactNode;
}

function SortableItem({ id, disabled, children }: SortableItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id, disabled });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
        opacity: isDragging ? 0.3 : 1,
        position: "relative",
        width: "100%",
        maxWidth: 300,
        cursor: disabled ? undefined : "grab",
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            onDragStart={(e) => e.preventDefault()}
            {...listeners}
            {...attributes}
        >
            {children}
        </div>
    );
}

// ── Droppable category zone (for move-into-category) ─────────

interface DroppableCategoryZoneProps {
    categoryId: number;
    disabled: boolean;
    children: React.ReactNode;
}

function DroppableCategoryZone({
    categoryId,
    disabled,
    children,
}: DroppableCategoryZoneProps) {
    const { isOver, setNodeRef } = useDroppable({
        id: `${DROP_PREFIX}${categoryId}`,
        disabled,
    });

    return (
        <Box
            ref={setNodeRef}
            role="region"
            aria-label="Drop into category"
            sx={{
                position: "relative",
                outline: "3px dashed",
                outlineColor: isOver ? "primary.main" : "transparent",
                outlineOffset: 3,
                transform: isOver ? "scale(1.03)" : "scale(1)",
                transition: "outline-color 0.2s, transform 0.15s",
                borderRadius: "inherit",
            }}
        >
            {children}
            {isOver && (
                <Box
                    sx={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 2,
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
                        Drop here
                    </Typography>
                </Box>
            )}
        </Box>
    );
}

// ── Main component ──────────────────────────────────────────

export interface SortableTileGridProps {
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

    const ids = useMemo(() => items.map(tileId), [items]);

    const [activeItem, setActiveItem] = useState<TileItem | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 5 },
        }),
    );

    const handleDragStart = useCallback(
        (event: DragStartEvent) => {
            const active = items.find(
                (item) => tileId(item) === event.active.id,
            );
            setActiveItem(active ?? null);
        },
        [items],
    );

    const handleDragEnd = useCallback(
        async (event: DragEndEvent) => {
            setActiveItem(null);
            const { active, over } = event;
            if (!over || active.id === over.id) return;

            // Reject concurrent drags — wait for the in-flight reorder to settle
            if (reorderInFlightRef.current) return;

            const overId = String(over.id);

            // ── Move into category (drop on a droppable zone) ──
            if (overId.startsWith(DROP_PREFIX)) {
                const targetCatId = Number(overId.slice(DROP_PREFIX.length));
                const activeId = String(active.id);
                if (activeId.startsWith("img-")) {
                    const imgId = Number(activeId.slice(4));
                    onDropImageOnCategory?.(imgId, targetCatId);
                } else if (activeId.startsWith("cat-")) {
                    const catId = Number(activeId.slice(4));
                    onDropCategoryOnCategory?.(catId, targetCatId);
                }
                return;
            }

            // ── Reorder (drop between items) ──
            const oldIndex = items.findIndex(
                (item) => tileId(item) === active.id,
            );
            const newIndex = items.findIndex(
                (item) => tileId(item) === over.id,
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

    const handleDragCancel = useCallback(() => {
        setActiveItem(null);
    }, []);

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

    // Render the overlay (ghost) for the currently dragged item
    const renderDragOverlay = () => {
        if (!activeItem) return null;
        if (activeItem.type === "category") {
            return (
                <Box sx={{ opacity: 0.85, width: 300, pointerEvents: "none" }}>
                    {renderCategoryTile(activeItem.data)}
                </Box>
            );
        }
        return (
            <Box sx={{ opacity: 0.85, width: 300, pointerEvents: "none" }}>
                {renderImageTile(activeItem.data)}
            </Box>
        );
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={moveOrReorder}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <SortableContext items={ids} strategy={rectSortingStrategy}>
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
                    {items.map((item) => {
                        const id = tileId(item);
                        return (
                            <SortableItem
                                key={id}
                                id={id}
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
            </SortableContext>
            <DragOverlay dropAnimation={null}>
                {renderDragOverlay()}
            </DragOverlay>
        </DndContext>
    );
}

import { useCallback, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import {
    DndContext,
    DragOverlay,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type {
    DragStartEvent,
    DragEndEvent,
    DraggableAttributes,
    DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
    SortableContext,
    useSortable,
    rectSortingStrategy,
    arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import type { Category, ImageItem, Program } from "../types";
import CategoryTile from "./CategoryTile";
import ImageTile from "./ImageTile";
import FileDropZone from "./FileDropZone";
import { reorderImages, reorderCategories } from "../api";
import { buildTileItems, tileId } from "./sortableTileGridUtils";
import type { TileItem } from "./sortableTileGridUtils";

// ── Sortable wrapper ────────────────────────────────────────

interface SortableItemProps {
    id: string;
    disabled: boolean;
    children: (dragHandleProps: {
        listeners: DraggableSyntheticListeners;
        attributes: DraggableAttributes;
    }) => React.ReactNode;
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
    };

    return (
        <div ref={setNodeRef} style={style}>
            {children({ listeners, attributes })}
        </div>
    );
}

// ── Drag handle ─────────────────────────────────────────────

interface DragHandleProps {
    listeners: DraggableSyntheticListeners;
    attributes: DraggableAttributes;
}

export function DragHandle({ listeners, attributes }: DragHandleProps) {
    return (
        <Tooltip title="Drag to reorder">
            <IconButton
                size="small"
                aria-label="Drag to reorder"
                sx={{
                    cursor: "grab",
                    color: "text.secondary",
                    "&:hover": { color: "text.primary" },
                    "&:active": { cursor: "grabbing" },
                }}
                {...listeners}
                {...attributes}
            >
                <DragIndicatorIcon fontSize="small" />
            </IconButton>
        </Tooltip>
    );
}

// ── Main component ──────────────────────────────────────────

interface SortableTileGridProps {
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
    onDropCategoryOnCategory?: (
        draggedId: number,
        targetId: number,
    ) => void;
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
    const itemsKey = useMemo(() => {
        const catIds = currentCategories.map((c) => `${c.id}:${c.sortOrder}`).join(",");
        const imgIds = visibleImages.map((i) => `${i.id}:${i.sortOrder}`).join(",");
        return `${catIds}|${imgIds}`;
    }, [currentCategories, visibleImages]);

    // Rebuild the sorted item list whenever the source data changes.
    const prevKeyRef = useRef("");
    if (prevKeyRef.current !== itemsKey) {
        prevKeyRef.current = itemsKey;
        setItems(buildTileItems(currentCategories, visibleImages));
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

            const oldIndex = items.findIndex(
                (item) => tileId(item) === active.id,
            );
            const newIndex = items.findIndex(
                (item) => tileId(item) === over.id,
            );
            if (oldIndex === -1 || newIndex === -1) return;

            const reordered = arrayMove(items, oldIndex, newIndex);

            // Capture the current key so we can detect navigation during await
            const keyAtDragStart = prevKeyRef.current;

            // Optimistically update local state
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
                await Promise.all(promises);
                onReorderComplete?.();
            } catch (err) {
                console.error("Failed to persist reorder", err);
                // Only revert if the user hasn't navigated away
                if (prevKeyRef.current === keyAtDragStart) {
                    setItems(buildTileItems(currentCategories, visibleImages));
                }
                onReorderError?.(err);
            }
        },
        [
            items,
            path,
            currentCategories,
            visibleImages,
            onReorderComplete,
            onReorderError,
        ],
    );

    const handleDragCancel = useCallback(() => {
        setActiveItem(null);
    }, []);

    const renderCategoryTile = (cat: Category, dragHandleProps?: DragHandleProps) => (
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
            onDropImage={canEditContent ? onDropImageOnCategory : undefined}
            onDropCategory={
                canEditContent ? onDropCategoryOnCategory : undefined
            }
            onDropFiles={canEditContent ? onDropFilesOnCategory : undefined}
            draggable={canEditContent}
            dragHandleSlot={
                canEditContent && dragHandleProps ? (
                    <DragHandle {...dragHandleProps} />
                ) : undefined
            }
        />
    );

    const renderImageTile = (img: ImageItem, dragHandleProps?: DragHandleProps) => (
        <ImageTile
            image={img}
            onClick={onImageClick}
            onEditDetails={canEditContent ? onEditImageDetails : undefined}
            onToggleVisibility={
                canEditContent ? onToggleImageVisibility : undefined
            }
            draggable={canEditContent}
            dragHandleSlot={
                canEditContent && dragHandleProps ? (
                    <DragHandle {...dragHandleProps} />
                ) : undefined
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
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <SortableContext items={ids} strategy={rectSortingStrategy}>
                <Box
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
                                {(dragHandleProps) =>
                                    item.type === "category"
                                        ? renderCategoryTile(
                                              item.data,
                                              dragHandleProps,
                                          )
                                        : renderImageTile(
                                              item.data as ImageItem,
                                              dragHandleProps,
                                          )
                                }
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

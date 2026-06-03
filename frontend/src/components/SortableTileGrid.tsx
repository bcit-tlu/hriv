import { useCallback, useMemo, useRef, useState } from "react";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import {
    DragDropProvider,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    useDroppable,
} from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";
import { pointerIntersection } from "@dnd-kit/collision";
import { CollisionPriority } from "@dnd-kit/abstract";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import type { CollisionDetector, Draggable } from "@dnd-kit/abstract";
import type { DragEndEvent } from "@dnd-kit/react";

import type { Category, ImageItem, Program } from "../types";
import CategoryTile from "./CategoryTile";
import ImageTile from "./ImageTile";
import FileDropZone from "./FileDropZone";
import { reorderCategories, reorderImages } from "../api";
import {
    buildTileItems,
    collectDescendantIds,
    createGapOnlyClosestCenter,
    DROP_PREFIX,
    findCategory,
    tileId,
} from "./sortableTileGridUtils";
import type { TileItem } from "./sortableTileGridUtils";

// Move-into-category triggers only inside a centered inset region of the tile.
// The surrounding margin (this many px on every side) plus the inter-tile gap
// stay reorder-active, so categories can still be reordered around one another
// without having to aim at the thin gap. Both the move collision zone and the
// reflow-suppression rect use this same inset, so the live preview always
// matches what commits. Tunable feel knob — see docs/drag-and-drop.md.
const MOVE_ZONE_INSET_PX = 32;

interface SortableTileProps {
    id: string;
    index: number;
    disabled: boolean;
    collisionDetector: CollisionDetector;
    children: React.ReactNode;
}

// A2 (optimistic reflow): each tile is a sortable, so the grid reflows
// continuously during a drag to preview the resulting order. The dragged
// source dims and the optimistic-sorting plugin slides neighbours into place.
// Reflow is suppressed whenever the pointer is over a category tile via the
// `collisionDetector` (`createGapOnlyClosestCenter`), which returns no
// collision inside a registered move-zone rect so move always wins there.
function SortableTile({
    id,
    index,
    disabled,
    collisionDetector,
    children,
}: SortableTileProps) {
    const { ref, isDragSource } = useSortable({
        id,
        index,
        disabled,
        type: "tile",
        collisionDetector,
    });

    return (
        <Box
            ref={ref}
            sx={{
                opacity: isDragSource ? 0.4 : 1,
                position: "relative",
                width: 300,
                maxWidth: "100%",
                cursor: disabled
                    ? undefined
                    : isDragSource
                      ? "grabbing"
                      : "grab",
            }}
            onDragStart={(e) => e.preventDefault()}
        >
            {children}
        </Box>
    );
}

interface DroppableCategoryZoneProps {
    categoryId: number;
    disabled: boolean;
    blockedIdsMap: Map<number, Set<number>>;
    /** Register/unregister this zone's element for reflow suppression. */
    onRegister: (categoryId: number, el: Element | null) => void;
    children: React.ReactNode;
}

function DroppableCategoryZone({
    categoryId,
    disabled,
    blockedIdsMap,
    onRegister,
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

    const { ref: droppableRef, isDropTarget } = useDroppable({
        id: `${DROP_PREFIX}${categoryId}`,
        disabled,
        collisionDetector: pointerIntersection,
        collisionPriority: CollisionPriority.High,
        accept: acceptFilter,
    });

    const ref = useCallback(
        (el: Element | null) => {
            droppableRef(el);
            onRegister(categoryId, el);
        },
        [droppableRef, onRegister, categoryId],
    );

    return (
        <Box
            role="region"
            aria-label="Move into category"
            sx={{ position: "relative", borderRadius: "inherit" }}
        >
            {children}
            {/* Centered inset move zone. Move (nest-into-category) triggers
                only here; the surrounding margin + the inter-tile gap remain
                reorder-active so categories can be reordered around one
                another. The droppable ref is registered for reflow
                suppression so the move collision and the suppression boundary
                are identical (preview always matches commit). */}
            <Box
                ref={ref}
                sx={{
                    position: "absolute",
                    inset: `${MOVE_ZONE_INSET_PX}px`,
                    zIndex: 1100,
                    pointerEvents: "none",
                    borderRadius: "inherit",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 0.5,
                    outline: "3px dashed",
                    outlineColor: isDropTarget ? "primary.main" : "transparent",
                    outlineOffset: 3,
                    transform: isDropTarget ? "scale(1.02)" : "scale(1)",
                    transition: "outline-color 0.2s, transform 0.15s",
                    bgcolor: isDropTarget ? "background.paper" : "transparent",
                }}
            >
                {isDropTarget && (
                    <>
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
                            sx={{ fontWeight: 600, color: "primary.main" }}
                        >
                            Move here
                        </Typography>
                    </>
                )}
            </Box>
        </Box>
    );
}

export interface SortableTileGridProps {
    allCategories: Category[];
    currentCategories: Category[];
    currentImages: ImageItem[];
    uncategorizedImages: ImageItem[];
    path: Category[];
    canEditContent: boolean;
    fileDragActive: boolean;
    programs: Program[];

    onCategoryClick: (cat: Category) => void;
    onMoveCategory?: (cat: Category) => void;
    onSetCardImage?: (categoryId: number, imageId: number | null) => void;
    onToggleCategoryVisibility?: (categoryId: number) => Promise<void>;
    onEditCategoryName?: (cat: Category) => void;
    onDropImageOnCategory?: (imageId: number, categoryId: number) => void;
    onDropCategoryOnCategory?: (
        categoryId: number,
        targetCategoryId: number,
    ) => void;
    onDropFilesOnCategory?: (categoryId: number, files: File[]) => void;

    onImageClick: (img: ImageItem) => void;
    onEditImageDetails?: (img: ImageItem) => void;
    onToggleImageVisibility?: (imageId: number) => Promise<void>;

    onFilesDrop: (files: File[]) => void;
    onGridDragOver?: React.DragEventHandler;
    onGridDrop?: React.DragEventHandler;
    onReorderComplete?: () => void;
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
    const visibleImages = useMemo(
        () =>
            path.length === 0
                ? [...uncategorizedImages, ...currentImages]
                : currentImages,
        [path.length, uncategorizedImages, currentImages],
    );

    const [items, setItems] = useState<TileItem[]>([]);
    const [activeItem, setActiveItem] = useState<TileItem | null>(null);
    const reorderInFlightRef = useRef(false);
    const prevCatsRef = useRef<Category[] | null>(null);
    const prevImgsRef = useRef<ImageItem[] | null>(null);

    // Track category move-zone DOM elements so the sortable collision detector
    // can suppress reorder/reflow while the pointer is over a category tile.
    const moveZoneElementsRef = useRef(new Set<Element>());
    const prevMoveZoneRef = useRef(new Map<number, Element>());
    const registerMoveZone = useCallback(
        (categoryId: number, el: Element | null) => {
            const prev = prevMoveZoneRef.current.get(categoryId);
            if (prev) {
                moveZoneElementsRef.current.delete(prev);
                prevMoveZoneRef.current.delete(categoryId);
            }
            if (el) {
                moveZoneElementsRef.current.add(el);
                prevMoveZoneRef.current.set(categoryId, el);
            }
        },
        [],
    );
    const sortableCollision = useMemo(
        () => createGapOnlyClosestCenter(moveZoneElementsRef.current),
        [],
    );

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

    const handleDragEnd = useCallback(
        async (event: DragEndEvent) => {
            setActiveItem(null);

            const { operation } = event;
            if (operation.canceled) return;

            const source = operation.source;
            const target = operation.target;
            if (!source || !target || source.id === target.id) return;
            if (reorderInFlightRef.current) return;

            const sourceId = String(source.id);
            const targetId = String(target.id);

            if (targetId.startsWith(DROP_PREFIX)) {
                const targetCatId = Number(targetId.slice(DROP_PREFIX.length));
                if (sourceId.startsWith("img-")) {
                    onDropImageOnCategory?.(
                        Number(sourceId.slice(4)),
                        targetCatId,
                    );
                } else if (sourceId.startsWith("cat-")) {
                    onDropCategoryOnCategory?.(
                        Number(sourceId.slice(4)),
                        targetCatId,
                    );
                }
                return;
            }

            // ── Reorder (A2 optimistic sortable reflow) ──
            // The target is the sortable tile the pointer settled on. `move`
            // derives the new order from the source's reflowed sortable index,
            // so the committed order matches the on-screen preview exactly.
            const ids = items.map(tileId);
            const reorderedIds = move(ids, event);
            if (
                reorderedIds.length === ids.length &&
                reorderedIds.every((id, i) => id === ids[i])
            ) {
                return;
            }
            const itemById = new Map(
                items.map((item) => [tileId(item), item] as const),
            );
            const reordered = reorderedIds
                .map((id) => itemById.get(id))
                .filter((item): item is TileItem => item !== undefined);
            if (reordered.length !== items.length) return;

            reorderInFlightRef.current = true;
            setItems(reordered);

            const parentId = path.length > 0 ? path[path.length - 1].id : null;
            const catUpdates: Array<{
                id: number;
                parent_id: number | null;
                sort_order: number;
            }> = [];
            const imgUpdates: Array<{ id: number; sort_order: number }> = [];

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
                if (catUpdates.length > 0)
                    promises.push(reorderCategories(catUpdates));
                if (imgUpdates.length > 0)
                    promises.push(reorderImages(imgUpdates));

                const results = await Promise.allSettled(promises);
                const failed = results.filter((r) => r.status === "rejected");
                reorderInFlightRef.current = false;

                if (failed.length > 0) {
                    const err =
                        (failed[0] as PromiseRejectedResult).reason ??
                        new Error("Reorder partially failed");
                    console.error("Reorder partially failed", failed);
                    setItems((current) =>
                        current === reordered ? items : current,
                    );
                    onReorderError?.(err);
                }

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
            onDropCategoryOnCategory,
            onDropImageOnCategory,
            onReorderComplete,
            onReorderError,
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
                onRegister={registerMoveZone}
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

    const sensors = useMemo(
        () => [
            PointerSensor.configure({
                activationConstraints: (event: PointerEvent) => {
                    if (event.pointerType === "touch") {
                        return [
                            new PointerActivationConstraints.Delay({
                                value: 250,
                                tolerance: 5,
                            }),
                        ];
                    }
                    return [
                        new PointerActivationConstraints.Distance({
                            value: 8,
                        }),
                    ];
                },
                preventActivation: (event: PointerEvent) => {
                    const target = event.target;
                    if (!(target instanceof Element)) return false;
                    return Boolean(target.closest(".MuiIconButton-root"));
                },
            }),
            KeyboardSensor,
        ],
        [],
    );

    return (
        <DragDropProvider
            sensors={sensors}
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
                sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}
                onDragOver={onGridDragOver}
                onDrop={onGridDrop}
            >
                {items.map((item, index) => {
                    const id = tileId(item);
                    return (
                        <SortableTile
                            key={id}
                            id={id}
                            index={index}
                            disabled={!canEditContent}
                            collisionDetector={sortableCollision}
                        >
                            {item.type === "category"
                                ? renderCategoryTile(item.data, true)
                                : renderImageTile(item.data as ImageItem)}
                        </SortableTile>
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
                {activeItem ? (
                    <Box
                        sx={{
                            opacity: 0.85,
                            width: 300,
                            pointerEvents: "none",
                            cursor: "grabbing",
                        }}
                    >
                        {activeItem.type === "category"
                            ? renderCategoryTile(activeItem.data)
                            : renderImageTile(activeItem.data)}
                    </Box>
                ) : null}
            </DragOverlay>
        </DragDropProvider>
    );
}

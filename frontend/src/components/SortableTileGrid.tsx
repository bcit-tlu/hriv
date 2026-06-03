import { useCallback, useMemo, useRef, useState } from "react";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import {
    DragDropProvider,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    useDraggable,
    useDroppable,
} from "@dnd-kit/react";
import { arrayMove } from "@dnd-kit/helpers";
import { pointerIntersection } from "@dnd-kit/collision";
import { CollisionPriority } from "@dnd-kit/abstract";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import type { Draggable } from "@dnd-kit/abstract";

import type { Category, ImageItem, Program } from "../types";
import CategoryTile from "./CategoryTile";
import ImageTile from "./ImageTile";
import FileDropZone from "./FileDropZone";
import { reorderCategories, reorderImages } from "../api";
import {
    buildTileItems,
    collectDescendantIds,
    DROP_PREFIX,
    findCategory,
    insertionIndexForMove,
    isReorderTargetId,
    REORDER_END_ID,
    REORDER_PREFIX,
    reorderIndexFromTargetId,
    tileId,
} from "./sortableTileGridUtils";
import type { TileItem } from "./sortableTileGridUtils";

interface DraggableTileProps {
    id: string;
    disabled: boolean;
    children: React.ReactNode;
}

function DraggableTile({ id, disabled, children }: DraggableTileProps) {
    const { ref, isDragSource } = useDraggable({
        id,
        disabled,
        type: "tile",
    });

    return (
        <Box
            ref={ref}
            sx={{
                opacity: isDragSource ? 0.5 : 1,
                position: "relative",
                width: 300,
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

interface ReorderDropZoneProps {
    id: string;
    disabled: boolean;
}

function ReorderDropZone({ id, disabled }: ReorderDropZoneProps) {
    const { ref, isDropTarget } = useDroppable({
        id,
        disabled,
        collisionDetector: pointerIntersection,
        collisionPriority: CollisionPriority.Normal,
    });

    return (
        <Box
            ref={ref}
            aria-hidden="true"
            sx={{
                alignSelf: "stretch",
                flex: "0 0 16px",
                minHeight: 180,
                borderRadius: 1,
                outline: isDropTarget ? "2px solid" : "2px solid transparent",
                outlineColor: isDropTarget ? "primary.main" : "transparent",
                bgcolor: isDropTarget ? "action.hover" : "transparent",
                transition: "background-color 0.12s, outline-color 0.12s",
            }}
        />
    );
}

interface DroppableCategoryZoneProps {
    categoryId: number;
    disabled: boolean;
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
                        bgcolor: "background.paper",
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
                        sx={{ fontWeight: 600, color: "primary.main" }}
                    >
                        Move here
                    </Typography>
                </Box>
            )}
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
        async (event: {
            operation: {
                source: { id: string | number } | null;
                target: { id: string | number } | null;
                canceled: boolean;
            };
        }) => {
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

            if (!isReorderTargetId(targetId)) return;

            const oldIndex = items.findIndex(
                (item) => tileId(item) === sourceId,
            );
            const targetIndex = reorderIndexFromTargetId(targetId, items);
            if (oldIndex === -1 || targetIndex === null) return;

            const newIndex = insertionIndexForMove(
                oldIndex,
                targetIndex,
                items.length,
            );
            if (oldIndex === newIndex) return;

            const reordered = arrayMove(items, oldIndex, newIndex);
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
                            value: 10,
                        }),
                        new PointerActivationConstraints.Delay({
                            value: 200,
                            tolerance: 5,
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
                sx={{ display: "flex", flexWrap: "wrap", gap: 0, rowGap: 2 }}
                onDragOver={onGridDragOver}
                onDrop={onGridDrop}
            >
                {items.map((item) => {
                    const id = tileId(item);
                    return (
                        <Box
                            key={id}
                            sx={{ display: "flex", alignItems: "stretch" }}
                        >
                            <ReorderDropZone
                                id={`${REORDER_PREFIX}${id}`}
                                disabled={!canEditContent}
                            />
                            <DraggableTile id={id} disabled={!canEditContent}>
                                {item.type === "category"
                                    ? renderCategoryTile(item.data, true)
                                    : renderImageTile(item.data as ImageItem)}
                            </DraggableTile>
                        </Box>
                    );
                })}
                {items.length > 0 && (
                    <ReorderDropZone
                        id={REORDER_END_ID}
                        disabled={!canEditContent}
                    />
                )}
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

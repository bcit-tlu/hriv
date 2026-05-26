import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Container from "@mui/material/Container";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Popover from "@mui/material/Popover";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import MuiBreadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Snackbar from "@mui/material/Snackbar";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import DisabledVisibleIcon from "@mui/icons-material/DisabledVisible";
import VisibilityIcon from "@mui/icons-material/Visibility";
import EditIcon from "@mui/icons-material/Edit";
import HomeIcon from "@mui/icons-material/Home";
import LinkIcon from "@mui/icons-material/Link";
import SearchIcon from "@mui/icons-material/Search";
import ImageViewer from "./components/ImageViewer";
import type {
    ViewportState,
    MeasurementConfig,
    OverlayRect,
} from "./components/imageViewerUtils";
import type { CanvasAnnotation } from "./components/CanvasOverlay";
import { MAX_SHARE_OVERLAYS } from "./components/imageViewerUtils";
import CategoryTile from "./components/CategoryTile";
import ColorModeToggle from "./components/ColorModeToggle";
import ImageTile from "./components/ImageTile";
import ManageCategoriesDialog from "./components/ManageCategoriesDialog";
import AdminPage from "./components/AdminPage";
import AnnouncementBanner from "./components/AnnouncementBanner";
import AddEditPersonModal from "./components/AddEditPersonModal";
import ManagePage from "./components/ManagePage";
import PeoplePage from "./components/PeoplePage";
import LoginScreen from "./components/LoginScreen";
import EditImageModal from "./components/EditImageModal";
import type { ImageFormData, ReplaceImageData } from "./components/EditImageModal";
import ProgramManagementModal from "./components/ProgramManagementModal";
import ReportIssueModal from "./components/ReportIssueModal";
import SearchModal from "./components/SearchModal";
import type { TypeFilter } from "./components/SearchModal";
import { narrowProgramIds } from "./categoryUtils";
import UploadImageModal from "./components/UploadImageModal";
import FileDropZone from "./components/FileDropZone";
import { isAcceptedFile } from "./fileUtils";
import { useAuth } from "./useAuth";
import {
    fetchCategoryTree,
    fetchAnnouncement,
    fetchImage as apiFetchImage,
    fetchUncategorizedImages,
    fetchSourceImage,
    fetchBulkImportJob,
    fetchVersions,
    fetchFrontendVersion,
    createCategory as apiCreateCategory,
    deleteCategory as apiDeleteCategory,
    updateCategory as apiUpdateCategory,
    fetchUsers,
    updateUser as apiUpdateUser,
    fetchPrograms as apiFetchPrograms,
    updateImage as apiUpdateImage,
    deleteImage as apiDeleteImage,
    replaceImage as apiReplaceImage,
    updateAnnouncement,
    createProgram,
    updateProgram,
    deleteProgram,
    reorderCategories as apiReorderCategories,
    ApiError,
} from "./api";
import type {
    ApiBulkImportJob,
    ApiCategoryTree,
    ApiImage,
    ApiUser,
} from "./api";
import { pollProcessingJob, type PollHandle } from "./pollProcessingJob";
import MoveCategoryDialog from "./components/MoveCategoryDialog";
import type { Category, ImageItem, Program } from "./types";
import { MAX_DEPTH } from "./types";
import AddCategoryDialog from "./components/AddCategoryDialog";
import EditCategoryDialog from "./components/EditCategoryDialog";
import { useColorMode } from "./useColorMode";
import { useBackgroundRefresh } from "./useBackgroundRefresh";
import { getSurfaceVariant } from "./theme";
import {
    useNavigationHistory,
    buildNavHistoryState,
} from "./useNavigationHistory";

/** Search the category tree for an image by ID, returning the image and its category path. */
function findImageInTree(
    tree: Category[],
    imageId: number,
    path: Category[] = [],
): { image: ImageItem; path: Category[] } | null {
    for (const cat of tree) {
        for (const img of cat.images) {
            if (img.id === imageId) return { image: img, path: [...path, cat] };
        }
        const found = findImageInTree(cat.children, imageId, [...path, cat]);
        if (found) return found;
    }
    return null;
}

function findCategoryPath(
    tree: Category[],
    categoryId: number,
    path: Category[] = [],
): Category[] | null {
    for (const cat of tree) {
        if (cat.id === categoryId) return [...path, cat];
        const found = findCategoryPath(cat.children, categoryId, [
            ...path,
            cat,
        ]);
        if (found) return found;
    }
    return null;
}

function userMessage(err: unknown, fallback: string): string {
    if (err instanceof ApiError) {
        if (err.status === 409) {
            return "This item was modified by another user. Please refresh and try again.";
        }
        if (err.status >= 400 && err.status < 500 && err.detail) {
            const detail = err.detail.trim();
            const looksLikeHtml = /^\s*<(!doctype|html|head|body)/i.test(detail);
            if (!looksLikeHtml && detail.length <= 200) {
                return detail;
            }
        }
    }
    return fallback;
}

/** Walk the category tree following an ordered list of IDs to reconstruct a path. */
function resolveCategoryPath(tree: Category[], ids: number[]): Category[] {
    const result: Category[] = [];
    let current = tree;
    for (const id of ids) {
        const cat = current.find((c) => c.id === id);
        if (!cat) break;
        result.push(cat);
        current = cat.children;
    }
    return result;
}
function apiTreeToCategory(node: ApiCategoryTree): Category {
    const meta = node.metadata_extra as Record<string, unknown> | null;
    return {
        id: node.id,
        label: node.label,
        parentId: node.parent_id,
        children: node.children.map(apiTreeToCategory),
        images: node.images.map((img) => ({
            id: img.id,
            name: img.name,
            thumb: img.thumb,
            tileSources: img.tile_sources,
            categoryId: img.category_id,
            copyright: img.copyright,
            note: img.note,
            active: img.active,
            version: img.version,
            createdAt: img.created_at,
            updatedAt: img.updated_at,
            metadataExtra: img.metadata_extra,
            width: img.width,
            height: img.height,
            fileSize: img.file_size,
        })),
        programIds: node.program_ids ?? [],
        status: node.status,
        cardImageId:
            typeof meta?.card_image_id === "number" ? meta.card_image_id : null,
        metadataExtra: meta ?? null,
    };
}

export default function App() {
    const {
        currentUser,
        loading: usersLoading,
        login,
        logout,
        canManageUsers,
        canEditContent,
    } = useAuth();
    const { mode } = useColorMode();

    type Page = "browse" | "manage" | "people" | "admin";
    const [page, setPage] = useState<Page>(() => {
        const p = new URLSearchParams(window.location.search).get("page");
        if (p === "manage" || p === "people" || p === "admin") return p;
        return "browse";
    });
    const [categories, setCategories] = useState<Category[]>([]);
    const [categoriesLoading, setCategoriesLoading] = useState(true);
    const [path, setPath] = useState<Category[]>([]);
    const pathRef = useRef(path);
    pathRef.current = path;
    const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
    const selectedImageRef = useRef<ImageItem | null>(null);
    selectedImageRef.current = selectedImage;
    const [dialogOpen, setDialogOpen] = useState(false);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [fileDropCategoryId, setFileDropCategoryId] = useState<
        number | null
    >(null);
    const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
    const [fileDragActive, setFileDragActive] = useState(false);
    const fileDragCounter = useRef(0);
    const [manageUploadOpen, setManageUploadOpen] = useState(false);
    const [addCatOpen, setAddCatOpen] = useState(false);
    const [programsPopoverAnchor, setProgramsPopoverAnchor] =
        useState<HTMLElement | null>(null);
    const [editNameCategory, setEditNameCategory] = useState<Category | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const [uncategorizedImages, setUncategorizedImages] = useState<ImageItem[]>(
        [],
    );

    // Shareable-URL state
    const [viewportState, setViewportState] = useState<
        ViewportState | undefined
    >(undefined);
    const [overlays, setOverlays] = useState<OverlayRect[]>([]);
    // Lock-engaged: whether the clear button is disabled (separate from metadata persistence)
    const [lockEngaged, setLockEngaged] = useState(false);
    const [snackOpen, setSnackOpen] = useState(false);
    const [errorSnack, setErrorSnack] = useState<string | null>(null);
    const [warnSnack, setWarnSnack] = useState<string | null>(null);
    const pendingImageId = useRef<number | null>(null);
    const pendingViewport = useRef<ViewportState | undefined>(undefined);
    const pendingOverlays = useRef<OverlayRect[] | undefined>(undefined);
    const uncategorizedLoaded = useRef(false);
    const pendingCatIds = useRef<number[] | null>(null);
    // Track the latest known image version independently from selectedImage
    // to avoid stale-version 409s when clearing overlays after locking
    // (lock intentionally does NOT update selectedImage to avoid viewer remount).
    const latestVersionRef = useRef<number>(0);
    // Track the latest known metadata independently from selectedImage so that
    // successive metadata-modifying operations (lock, canvas annotations, clear)
    // don't clobber each other's fields.  Initialised from selectedImage and
    // updated after every successful PATCH.
    // undefined = not yet initialised (use selectedImage); null/object = latest known server state
    const latestMetadataRef = useRef<
        Record<string, unknown> | null | undefined
    >(undefined);
    // Debounce timer for canvas annotation saves to avoid 409 version conflicts
    const canvasSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const canvasSaveInFlightRef = useRef(false);
    const pendingCanvasAnnotationsRef = useRef<CanvasAnnotation[] | null>(null);
    /** Always-current annotations last passed to handleCanvasAnnotationsChange.
     *  Used by flushCanvasAnnotations to avoid reading stale React state. */
    const latestCanvasAnnotationsRef = useRef<CanvasAnnotation[] | null>(null);
    // Track which image ID the current in-flight save targets so stale completions
    // don't overwrite refs after an image change
    const saveTargetImageIdRef = useRef<number | null>(null);

    // Report issue modal state
    const [reportIssueOpen, setReportIssueOpen] = useState(false);

    // Component versions (admin-only, fetched lazily on mount).  Backend +
    // backup are returned by ``/api/admin/version``; frontend is served by
    // its own nginx at ``/version`` (envsubst-rendered from the Helm
    // chart's ``APP_VERSION`` env at container start — see
    // ``charts/frontend/files/default.conf.template``), so the displayed
    // string reflects the deployed image tag rather than a build-time
    // constant that would survive ``release-retag.yaml``'s digest
    // promotion into production pulls.
    const [backendVersion, setBackendVersion] = useState<string | null>(null);
    const [backupVersion, setBackupVersion] = useState<string | null>(null);
    const [frontendVersion, setFrontendVersion] = useState<string | null>(null);

    // Image processing tracking state (supports up to 5 concurrent jobs)
    const MAX_PROCESSING_JOBS = 5;
    interface ProcessingJob {
        id: number;
        filename: string;
        status:
            | "uploading"
            | "processing"
            | "importing"
            | "completed"
            | "failed";
        kind: "image" | "bulk-import";
        errorMessage?: string;
        imageId?: number;
        bulkImportJobId?: number;
        totalCount?: number;
        completedCount?: number;
        failedCount?: number;
        errors?: Array<{ filename: string; error: string }> | null;
        /** Server-reported progress (0–100). */
        serverProgress: number;
        /** File size in bytes — used for client-side progress estimation. */
        fileSize: number;
        /** Timestamp (ms) when the job was first added. */
        startedAt: number;
        /** Server-reported status message describing the current phase. */
        statusMessage?: string;
        /** Upload progress fraction (0–1), only for "uploading" status. */
        uploadProgress?: number;
        /** Temporary ID assigned during upload (before sourceImageId is known). */
        uploadId?: number;
    }
    const [processingJobs, setProcessingJobs] = useState<ProcessingJob[]>([]);
    const processingPollRefs = useRef<Map<number, PollHandle>>(new Map());
    const bulkImportPollRefs = useRef<
        Map<number, ReturnType<typeof setInterval>>
    >(new Map());

    // Server-reported progress stored in a ref to avoid re-triggering the
    // polling useEffect when intermediate progress updates arrive.
    const serverProgressRef = useRef<Map<number, number>>(new Map());

    // Upload progress stored in a ref (same reason as above).
    const uploadProgressRef = useRef<Map<number, number>>(new Map());

    // Server-reported status message stored in a ref (same reason as above).
    const serverStatusMessageRef = useRef<Map<number, string>>(new Map());

    // Monotonic counter for replacement upload IDs (avoids collisions with
    // UploadImageModal which uses Date.now()).
    const nextReplaceUploadIdRef = useRef(2_000_000);
    // Track the active replacement uploadId and which modal context started
    // it so progress doesn't leak between the viewer and browse modals.
    const activeReplaceUploadIdRef = useRef<{
        uploadId: number;
        context: "viewer" | "browse";
    } | null>(null);
    // AbortController for the active replace-image upload
    const replaceAbortRef = useRef<AbortController | null>(null);

    // Client-side progress interpolation — a simple tick counter that
    // increments every 500 ms to trigger re-renders without mutating
    // processingJobs (which would restart the polling useEffect).
    const [, setProgressTick] = useState(0);
    const interpolationTimerRef = useRef<ReturnType<typeof setInterval> | null>(
        null,
    );

    /**
     * Estimate total processing duration (ms) from file size.
     * Rough heuristic: ~2 s base + ~0.5 s per MB.  Capped at 5 min.
     */
    const estimateDuration = useCallback((fileSize: number) => {
        const mb = fileSize / (1024 * 1024);
        return Math.min(2000 + mb * 500, 300_000);
    }, []);

    /**
     * Compute the display progress for a processing job.
     * With granular server-side progress (via pyvips eval signals), the
     * server now reports fine-grained percentages during tile generation.
     * We still use time-based interpolation to fill gaps between polls,
     * but the server value is the primary source of truth.
     */
    const getDisplayProgress = useCallback(
        (job: ProcessingJob): number => {
            if (job.status === "completed") return 100;
            if (job.status === "importing") return job.serverProgress;
            const sp =
                serverProgressRef.current.get(job.id) ?? job.serverProgress;
            if (job.status === "failed") return sp;

            const elapsed = Date.now() - job.startedAt;
            const est = estimateDuration(job.fileSize);
            // Time-based estimate: ramp from 0→90% over estimated duration
            const timeFraction = Math.min(elapsed / est, 1);
            const timeProgress = Math.round(timeFraction * 90);

            // Always allow interpolation up to 75 % so the bar feels smooth
            // even when only coarse milestones arrive.  Once the server
            // reports ≥ 80 % (tiles done), raise the ceiling to 95 %.
            const cap = sp >= 80 ? 95 : Math.max(sp + 5, 75);
            const interpolated = Math.min(timeProgress, cap);

            // Never go below what the server already reported
            return Math.max(sp, interpolated);
        },
        [estimateDuration],
    );

    /** Return the current status message for a processing job. */
    const getStatusMessage = useCallback((job: ProcessingJob): string => {
        return (
            serverStatusMessageRef.current.get(job.id) ??
            job.statusMessage ??
            ""
        );
    }, []);

    // Search modal state
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchUsers, setSearchUsers] = useState<ApiUser[]>([]);
    const [searchInitialQuery, setSearchInitialQuery] = useState<string | undefined>(undefined);
    const [searchInitialTypeFilter, setSearchInitialTypeFilter] = useState<string | undefined>(undefined);

    // Initial program filter for ManagePage (set when navigating from search)
    const [manageProgramFilter, setManageProgramFilter] = useState<string | undefined>(undefined);
    const clearManageProgramFilter = useCallback(() => setManageProgramFilter(undefined), []);

    // Initial user to edit on PeoplePage (set when navigating from search)
    const [editUserId, setEditUserId] = useState<number | null>(null);
    const clearEditUserId = useCallback(() => setEditUserId(null), []);

    // Manage menu state
    const [manageMenuAnchor, setManageMenuAnchor] =
        useState<HTMLElement | null>(null);

    // Announcement modal state (for Manage menu)
    const [annModalOpen, setAnnModalOpen] = useState(false);
    const [annMessage, setAnnMessage] = useState("");
    const [annEnabled, setAnnEnabled] = useState(false);
    const [annDraftMessage, setAnnDraftMessage] = useState("");
    const [annDraftEnabled, setAnnDraftEnabled] = useState(false);
    const [annSaving, setAnnSaving] = useState(false);
    const [annError, setAnnError] = useState<string | null>(null);

    // Program management modal state (for Manage menu)
    const [programModalOpen, setProgramModalOpen] = useState(false);

    // Move category dialog state
    const [moveCatOpen, setMoveCatOpen] = useState(false);
    const [movingCategory, setMovingCategory] = useState<Category | null>(null);

    // Image edit modal state (for viewer page)
    const [imageEditOpen, setImageEditOpen] = useState(false);
    // Canvas edit mode — tracked here so we can disable conflicting UI (e.g. Edit Details)
    const [canvasEditActive, setCanvasEditActive] = useState(false);

    // Image edit modal state (for browse-view ellipsis icon)
    const [browseEditImage, setBrowseEditImage] = useState<ImageItem | null>(
        null,
    );

    // Jobs visible as snackbars — hide "uploading"/"failed" jobs only while
    // the modal that owns them is open (that modal shows its own progress).
    // Upload-modal jobs (uploadId from Date.now()) are hidden when uploadOpen.
    // Replacement jobs (uploadId from nextReplaceUploadIdRef, < 1 billion)
    // are hidden when the edit modal that started them is open.
    const visibleJobs = useMemo(
        () =>
            processingJobs.filter((j) => {
                if (
                    !(j.status === "uploading" || j.status === "failed") ||
                    j.uploadId == null
                )
                    return true;
                const isReplaceJob = j.uploadId < 1_000_000_000;
                if (isReplaceJob)
                    return !(imageEditOpen || browseEditImage != null);
                return !(uploadOpen || manageUploadOpen);
            }),
        [processingJobs, uploadOpen, manageUploadOpen, imageEditOpen, browseEditImage],
    );

    // User profile popover + edit modal state
    const avatarRef = useRef<HTMLButtonElement>(null);
    const [profileOpen, setProfileOpen] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [programs, setPrograms] = useState<Program[]>([]);
    const [imagesVersion, setImagesVersion] = useState(0);

    // Build ApiUser shape from currentUser for AddEditPersonModal
    const currentApiUser: ApiUser | null = currentUser
        ? {
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
              role: currentUser.role,
              program_ids: currentUser.program_ids ?? [],
              program_names: currentUser.program_names ?? [],
              last_access: currentUser.lastAccess ?? null,
              metadata_extra: null,
              created_at: "",
              updated_at: "",
          }
        : null;

    // Refs for the popstate handler (always reflect latest state)
    const categoriesRef = useRef(categories);
    categoriesRef.current = categories;
    const uncategorizedImagesRef = useRef(uncategorizedImages);
    uncategorizedImagesRef.current = uncategorizedImages;

    // Browser history integration for back/forward navigation
    const handlePopState = useCallback(
        (popPage: string, catIds: number[], imageId: number | null) => {
            const validPage = (
                ["browse", "manage", "people", "admin"].includes(popPage)
                    ? popPage
                    : "browse"
            ) as Page;
            setPage(validPage);

            if (validPage !== "browse") {
                setPath([]);
                setSelectedImage(null);
                setViewportState(undefined);
                setOverlays([]);
                return;
            }

            const catPath = resolveCategoryPath(
                categoriesRef.current,
                catIds,
            );
            setPath(catPath);

            if (imageId != null) {
                const result = findImageInTree(
                    categoriesRef.current,
                    imageId,
                );
                if (result) {
                    setSelectedImage(result.image);
                    setPath(result.path);
                } else {
                    const uncatImg = uncategorizedImagesRef.current.find(
                        (img) => img.id === imageId,
                    );
                    setSelectedImage(uncatImg ?? null);
                    if (uncatImg) setPath([]);
                }
            } else {
                setSelectedImage(null);
            }
            setViewportState(undefined);
            setOverlays([]);
        },
        [],
    );

    const { pushNavState } = useNavigationHistory(handlePopState);

    // Start polling for each new processing job.  The per-job state machine
    // (fetch -> dispatch -> reschedule / cancel) lives in `pollProcessingJob`;
    // this effect only tracks which jobs have an active handle.
    useEffect(() => {
        const refs = processingPollRefs.current;

        for (const job of processingJobs) {
            if (job.status !== "processing") continue; // only poll active jobs
            if (refs.has(job.id)) continue; // already polling

            const handle = pollProcessingJob(job.id, {
                fetchStatus: fetchSourceImage,
                onCompleted: async (imageId) => {
                    // Refresh data FIRST so the new image is already in the
                    // category tree when the "View image" snackbar link appears.
                    await Promise.all([
                        loadCategories(),
                        loadUncategorizedImages(),
                    ]);
                    setImagesVersion((v) => v + 1);
                    // If the completed job is for the currently-viewed image,
                    // refresh it so the viewer picks up new tile URLs.
                    const current = selectedImageRef.current;
                    if (imageId != null && current && current.id === imageId) {
                        try {
                            const fresh = await apiFetchImage(imageId);
                            setSelectedImage({
                                id: fresh.id,
                                name: fresh.name,
                                thumb: fresh.thumb,
                                tileSources: fresh.tile_sources,
                                categoryId: fresh.category_id,
                                copyright: fresh.copyright,
                                note: fresh.note,
                                active: fresh.active,
                                version: fresh.version,
                                createdAt: fresh.created_at,
                                updatedAt: fresh.updated_at,
                                metadataExtra: fresh.metadata_extra,
                                width: fresh.width,
                                height: fresh.height,
                                fileSize: fresh.file_size,
                            });
                        } catch {
                            // Non-critical; viewer will show stale data
                        }
                    }
                    refs.delete(job.id);
                    setProcessingJobs((prev) =>
                        prev.map((j) =>
                            j.id === job.id
                                ? {
                                      ...j,
                                      status: "completed" as const,
                                      serverProgress: 100,
                                      imageId: imageId ?? undefined,
                                  }
                                : j,
                        ),
                    );
                },
                onFailed: (progress, errorMessage) => {
                    refs.delete(job.id);
                    setProcessingJobs((prev) =>
                        prev.map((j) =>
                            j.id === job.id
                                ? {
                                      ...j,
                                      status: "failed" as const,
                                      serverProgress: progress,
                                      errorMessage: errorMessage || undefined,
                                  }
                                : j,
                        ),
                    );
                },
                onProgress: (progress, statusMessage) => {
                    serverProgressRef.current.set(job.id, progress);
                    if (statusMessage) {
                        serverStatusMessageRef.current.set(
                            job.id,
                            statusMessage,
                        );
                    }
                },
            });
            refs.set(job.id, handle);
        }

        // Cancel handles for jobs that were removed or transitioned away
        // from "processing" (e.g. user dismissed a completed snackbar).
        for (const [id, handle] of refs) {
            if (
                !processingJobs.some(
                    (j) => j.id === id && j.status === "processing",
                )
            ) {
                handle.cancel();
                refs.delete(id);
            }
        }

        // No cleanup return — the inline stale-job loop above handles
        // removal, and the effect body is idempotent (skips already-tracked
        // jobs).  Full teardown on unmount is handled by a separate effect.
    }, [processingJobs]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const refs = bulkImportPollRefs.current;

        for (const job of processingJobs) {
            if (job.status !== "importing" || job.bulkImportJobId == null)
                continue;
            if (refs.has(job.bulkImportJobId)) continue;

            const interval = setInterval(async () => {
                try {
                    const updated = await fetchBulkImportJob(
                        job.bulkImportJobId!,
                    );
                    updateBulkImportJob(updated, job.filename, job.fileSize);
                    if (
                        updated.status === "completed" ||
                        updated.status === "failed"
                    ) {
                        const ref = refs.get(updated.id);
                        if (ref) {
                            clearInterval(ref);
                            refs.delete(updated.id);
                        }
                        loadCategories();
                        loadUncategorizedImages();
                        setImagesVersion((v) => v + 1);
                    }
                } catch {
                    // ignore poll errors
                }
            }, 2000);
            refs.set(job.bulkImportJobId, interval);
        }

        for (const [id, interval] of refs) {
            if (
                !processingJobs.some(
                    (j) =>
                        j.bulkImportJobId === id && j.status === "importing",
                )
            ) {
                clearInterval(interval);
                refs.delete(id);
            }
        }

        // No cleanup return — same reasoning as the processing-poll effect
        // above.  Without the teardown/recreate cycle, setInterval timers
        // keep their cadence instead of resetting on every state change.
    }, [processingJobs]); // eslint-disable-line react-hooks/exhaustive-deps

    // Unmount-only cleanup for both polling ref maps.  The effects above
    // no longer return cleanup functions (to avoid the teardown/recreate
    // churn), so this effect handles the final teardown when the component
    // unmounts.
    useEffect(() => {
        const procRefs = processingPollRefs.current;
        const bulkRefs = bulkImportPollRefs.current;
        return () => {
            procRefs.forEach((handle) => handle.cancel());
            procRefs.clear();
            bulkRefs.forEach((interval) => clearInterval(interval));
            bulkRefs.clear();
        };
    }, []);

    // Interpolation timer: triggers re-render every 500 ms so the progress bar
    // advances smoothly between server polls while any job is processing.
    // Uses a tick counter instead of mutating processingJobs to avoid
    // re-triggering the polling useEffect.
    useEffect(() => {
        const hasActiveJob = processingJobs.some(
            (j) =>
                j.status === "processing" ||
                j.status === "uploading" ||
                j.status === "importing",
        );
        if (hasActiveJob && !interpolationTimerRef.current) {
            interpolationTimerRef.current = setInterval(() => {
                setProgressTick((t) => t + 1);
            }, 500);
        }
        if (!hasActiveJob && interpolationTimerRef.current) {
            clearInterval(interpolationTimerRef.current);
            interpolationTimerRef.current = null;
        }
        return () => {
            if (interpolationTimerRef.current) {
                clearInterval(interpolationTimerRef.current);
                interpolationTimerRef.current = null;
            }
        };
    }, [processingJobs]);

    // Load announcement (works for both logged-in and login page)
    const loadAnnouncement = useCallback(async () => {
        try {
            const ann = await fetchAnnouncement();
            setAnnouncement(ann.enabled ? ann.message : "");
            setAnnMessage(ann.message);
            setAnnEnabled(ann.enabled);
        } catch {
            // Silently ignore — announcement is non-critical
        }
    }, []);

    useEffect(() => {
        loadAnnouncement();
    }, [loadAnnouncement]);

    // On mount, parse URL search params for shareable link state
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const imgId = params.get("image");
        if (imgId) {
            const parsedId = Number(imgId);
            if (!Number.isNaN(parsedId)) {
                pendingImageId.current = parsedId;
                const z = params.get("zoom");
                const px = params.get("x");
                const py = params.get("y");
                if (z && px && py) {
                    const zoom = parseFloat(z);
                    const x = parseFloat(px);
                    const y = parseFloat(py);
                    if (
                        !Number.isNaN(zoom) &&
                        !Number.isNaN(x) &&
                        !Number.isNaN(y)
                    ) {
                        const rot = params.get("rotation");
                        const rotation = rot ? parseFloat(rot) : undefined;
                        pendingViewport.current = {
                            zoom,
                            x,
                            y,
                            rotation:
                                rotation && !Number.isNaN(rotation)
                                    ? rotation
                                    : undefined,
                        };
                    }
                }
                // Parse overlay rectangles (ov0..ov14) — format: x,y,w,h
                const parsedOverlays: OverlayRect[] = [];
                for (let i = 0; i < MAX_SHARE_OVERLAYS; i++) {
                    const ov = params.get(`ov${i}`);
                    if (!ov) continue;
                    const parts = ov.split(",").map(Number);
                    if (
                        parts.length === 4 &&
                        parts.every((n) => !Number.isNaN(n))
                    ) {
                        parsedOverlays.push({
                            x: parts[0],
                            y: parts[1],
                            w: parts[2],
                            h: parts[3],
                        });
                    }
                }
                if (parsedOverlays.length > 0) {
                    pendingOverlays.current = parsedOverlays;
                }
            }
        }
        // Parse initial category path from URL (resolved when categories load)
        if (!imgId) {
            const catStr = params.get("cat");
            if (catStr) {
                const ids = catStr
                    .split(",")
                    .map(Number)
                    .filter((n) => !Number.isNaN(n));
                if (ids.length > 0) {
                    pendingCatIds.current = ids;
                }
            }
        }
    }, []);

    // Reset navigation state when user identity changes (login/logout/switch)
    useEffect(() => {
        setPage("browse");
        setPath([]);
        setSelectedImage(null);
        setViewportState(undefined);
        setOverlays([]);
        setProfileOpen(false);
        setEditModalOpen(false);
        setImageEditOpen(false);
        setBrowseEditImage(null);
        setSearchOpen(false);
        setSearchUsers([]);
        processingPollRefs.current.forEach((handle) => handle.cancel());
        processingPollRefs.current.clear();
        bulkImportPollRefs.current.forEach((interval) => clearInterval(interval));
        bulkImportPollRefs.current.clear();
        serverProgressRef.current.clear();
        uploadProgressRef.current.clear();
        serverStatusMessageRef.current.clear();
        setProcessingJobs([]);
        window.history.replaceState(
            buildNavHistoryState("browse", [], null),
            "",
            window.location.pathname,
        );
    }, [currentUser]);

    // Load users for search when modal opens (admin/instructor only)
    useEffect(() => {
        if (searchOpen && canEditContent) {
            fetchUsers()
                .then(setSearchUsers)
                .catch(() => setSearchUsers([]));
        }
    }, [searchOpen, canEditContent]);

    // Load deployed component versions for the footer (admin only).
    // Backend+backup come from ``/api/admin/version`` (admin-guarded on
    // the backend; non-admins never see those strings). The frontend
    // version is served by its own nginx and is not strictly admin-
    // guarded at the transport layer, but we only fetch it in the admin
    // path to match the footer's gating behaviour — the displayed
    // version string carries the same info as the image-tag filenames
    // already visible in the public JS bundle, so there is no new
    // information leak.
    useEffect(() => {
        if (!canManageUsers) {
            setBackendVersion(null);
            setBackupVersion(null);
            setFrontendVersion(null);
            return;
        }
        fetchVersions()
            .then((v) => {
                setBackendVersion(v.backend);
                setBackupVersion(v.backup);
            })
            .catch(() => {
                setBackendVersion(null);
                setBackupVersion(null);
            });
        fetchFrontendVersion()
            .then((v) => {
                setFrontendVersion(v.frontend);
            })
            .catch(() => {
                // ``/version`` is only served by the chart-deployed
                // nginx; ``npm run dev`` / local Vite does not proxy
                // this path, so a rejection here is expected outside
                // Kubernetes and we fall back to ``"dev"`` at render
                // time.
                setFrontendVersion(null);
            });
    }, [canManageUsers]);

    // Ref holds the invalidateBackground function once the hook mounts.
    // loadCategories reads it to cancel in-flight background requests on
    // foreground fetches without requiring every call site to change.
    const invalidateRef = useRef<(() => void) | null>(null);

    const loadCategories = useCallback(async (opts?: { silent?: boolean; signal?: AbortSignal }) => {
        const { silent = false, signal } = opts ?? {};
        // Foreground fetch: abort any in-flight background request to avoid
        // a stale background response overwriting fresher foreground data.
        if (!signal) invalidateRef.current?.();
        try {
            if (!silent) setCategoriesLoading(true);
            const tree = await fetchCategoryTree(signal ? { signal } : undefined);
            if (signal?.aborted) return;
            setCategories(tree.map(apiTreeToCategory));
        } catch (err) {
            if (signal?.aborted) return;
            console.error("Failed to load categories", err);
        } finally {
            if (!silent) setCategoriesLoading(false);
        }
    }, []);

    const loadUncategorizedImages = useCallback(async (opts?: { signal?: AbortSignal }) => {
        const { signal } = opts ?? {};
        try {
            const imgs = await fetchUncategorizedImages(signal ? { signal } : undefined);
            if (signal?.aborted) return;
            setUncategorizedImages(
                imgs.map((img: ApiImage) => ({
                    id: img.id,
                    name: img.name,
                    thumb: img.thumb,
                    tileSources: img.tile_sources,
                    categoryId: img.category_id,
                    copyright: img.copyright,
                    note: img.note,
                    active: img.active,
                    version: img.version,
                    createdAt: img.created_at,
                    updatedAt: img.updated_at,
                    metadataExtra: img.metadata_extra,
                    width: img.width,
                    height: img.height,
                    fileSize: img.file_size,
                })),
            );
            uncategorizedLoaded.current = true;
        } catch (err) {
            if (signal?.aborted) return;
            console.error("Failed to load uncategorized images", err);
            uncategorizedLoaded.current = true;
        }
    }, []);

    const loadPrograms = useCallback(async () => {
        try {
            const p = await apiFetchPrograms();
            setPrograms(
                p.map((pg) => ({
                    id: pg.id,
                    name: pg.name,
                    oidc_group: pg.oidc_group,
                    created_at: pg.created_at,
                    updated_at: pg.updated_at,
                })),
            );
        } catch {
            // Silently ignore — programs are non-critical for initial load
        }
    }, []);

    // Announcement modal handlers (for Manage menu)
    const openAnnModal = useCallback(() => {
        setAnnDraftMessage(annMessage);
        setAnnDraftEnabled(annEnabled);
        setAnnError(null);
        setAnnModalOpen(true);
    }, [annMessage, annEnabled]);

    const handleAnnSave = useCallback(async () => {
        setAnnSaving(true);
        try {
            const updated = await updateAnnouncement({
                message: annDraftMessage,
                enabled: annDraftEnabled,
            });
            setAnnMessage(updated.message);
            setAnnEnabled(updated.enabled);
            setAnnModalOpen(false);
            loadAnnouncement();
        } catch (err) {
            setAnnError(userMessage(err, "Failed to update announcement"));
        } finally {
            setAnnSaving(false);
        }
    }, [annDraftMessage, annDraftEnabled, loadAnnouncement]);

    // Program management handlers (for Manage menu)
    const handleAddProgram = useCallback(
        async (name: string, oidcGroup: string | null) => {
            try {
                await createProgram({ name, oidc_group: oidcGroup });
                await loadPrograms();
            } catch (err) {
                console.error("Failed to add program", err);
                setErrorSnack(userMessage(err, "Failed to add program."));
            }
        },
        [loadPrograms],
    );

    const handleEditProgram = useCallback(
        async (id: number, name: string, oidcGroup: string | null) => {
            try {
                await updateProgram(id, { name, oidc_group: oidcGroup });
                await loadPrograms();
            } catch (err) {
                console.error("Failed to edit program", err);
                setErrorSnack(userMessage(err, "Failed to edit program."));
            }
        },
        [loadPrograms],
    );

    const handleDeleteProgram = useCallback(
        async (id: number) => {
            try {
                await deleteProgram(id);
                await loadPrograms();
            } catch (err) {
                console.error("Failed to delete program", err);
                setErrorSnack(userMessage(err, "Failed to delete program."));
            }
        },
        [loadPrograms],
    );

    useEffect(() => {
        if (currentUser) {
            loadCategories();
            loadUncategorizedImages();
            loadPrograms();
        }
    }, [currentUser, loadCategories, loadUncategorizedImages, loadPrograms]);

    // Background refresh: re-fetch categories and uncategorized images every
    // 30 s while the tab is visible.  The category tree endpoint returns
    // ETag + Cache-Control: private, no-cache so the browser's default fetch
    // cache mode transparently sends If-None-Match and receives 304 when
    // nothing changed (relies on browser-level HTTP caching, not explicit
    // header management in api.ts).
    const backgroundRefresh = useCallback(async (signal: AbortSignal) => {
        await loadCategories({ silent: true, signal });
        await loadUncategorizedImages({ signal });
    }, [loadCategories, loadUncategorizedImages]);
    const invalidateBackground = useBackgroundRefresh(backgroundRefresh, currentUser != null);
    invalidateRef.current = invalidateBackground;

    // Once categories are loaded, restore a pending shared-link image
    useEffect(() => {
        if (pendingImageId.current === null || categoriesLoading) return;
        const id = pendingImageId.current;

        // Check uncategorized images first
        const uncatImg = uncategorizedImages.find((img) => img.id === id);
        if (uncatImg) {
            pendingImageId.current = null;
            setSelectedImage(uncatImg);
            setViewportState(pendingViewport.current);
            pendingViewport.current = undefined;
            if (pendingOverlays.current) {
                setOverlays(pendingOverlays.current);
                pendingOverlays.current = undefined;
            }
            return;
        }

        const result = findImageInTree(categories, id);
        if (result) {
            pendingImageId.current = null;
            setPath(result.path);
            setSelectedImage(result.image);
            setViewportState(pendingViewport.current);
            pendingViewport.current = undefined;
            if (pendingOverlays.current) {
                setOverlays(pendingOverlays.current);
                pendingOverlays.current = undefined;
            }
        } else if (!categoriesLoading && uncategorizedLoaded.current) {
            // Both data sources have loaded — image doesn't exist.
            // Clear pending state and URL so URL sync can resume normally.
            pendingImageId.current = null;
            pendingViewport.current = undefined;
            pendingOverlays.current = undefined;
            window.history.replaceState(
                buildNavHistoryState("browse", [], null),
                "",
                window.location.pathname,
            );
        }
        // Otherwise keep pendingImageId so we retry on the next data update.
    }, [categories, uncategorizedImages, categoriesLoading]);

    // Resolve pending category path from URL (when no image param is present)
    useEffect(() => {
        if (pendingCatIds.current === null || categoriesLoading) return;
        const ids = pendingCatIds.current;
        pendingCatIds.current = null;
        const resolved = resolveCategoryPath(categories, ids);
        if (resolved.length > 0) {
            setPath(resolved);
        }
    }, [categories, categoriesLoading]);

    // Keep URL search params in sync with the current view
    useEffect(() => {
        // Don't overwrite URL while a shared-link image is still pending resolution
        if (pendingImageId.current !== null) return;
        const params = new URLSearchParams();
        if (page !== "browse") {
            params.set("page", page);
        } else {
            if (path.length > 0) {
                params.set(
                    "cat",
                    path.map((c) => c.id).join(","),
                );
            }
            if (selectedImage) {
                params.set("image", String(selectedImage.id));
                if (viewportState) {
                    params.set("zoom", viewportState.zoom.toFixed(4));
                    params.set("x", viewportState.x.toFixed(6));
                    params.set("y", viewportState.y.toFixed(6));
                    if (viewportState.rotation) {
                        params.set(
                            "rotation",
                            viewportState.rotation.toFixed(1),
                        );
                    }
                }
                // Serialize overlay rectangles (up to MAX_SHARE_OVERLAYS)
                for (
                    let i = 0;
                    i < Math.min(overlays.length, MAX_SHARE_OVERLAYS);
                    i++
                ) {
                    const r = overlays[i];
                    params.set(
                        `ov${i}`,
                        [r.x, r.y, r.w, r.h]
                            .map((n) => n.toPrecision(8))
                            .join(","),
                    );
                }
            }
        }
        const qs = params.toString();
        const newUrl = qs
            ? `${window.location.pathname}?${qs}`
            : window.location.pathname;
        window.history.replaceState(
            buildNavHistoryState(
                page,
                path.map((c) => c.id),
                selectedImage?.id ?? null,
            ),
            "",
            newUrl,
        );
    }, [page, path, selectedImage, viewportState, overlays]);

    const handleViewportChange = useCallback((state: ViewportState) => {
        setViewportState(state);
    }, []);

    const handleOverlaysChange = useCallback((newOverlays: OverlayRect[]) => {
        setOverlays(newOverlays);
    }, []);

    // Memoize initialViewport so it stays referentially stable per image.
    // Keyed on image ID so metadata-only updates (e.g. measurement settings)
    // do not reset the viewport and re-create the OSD viewer.
    const initialViewport = useMemo(() => viewportState, [selectedImage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Derive locked overlays from the selected image's metadata.
    // Validates each entry has numeric x, y, w, h to guard against malformed JSONB data.
    const lockedOverlays = useMemo((): OverlayRect[] | undefined => {
        const meta = selectedImage?.metadataExtra;
        if (!meta) return undefined;
        const locked = meta.locked_overlays;
        if (!Array.isArray(locked) || locked.length === 0) return undefined;
        const valid = locked.filter(
            (entry): entry is OverlayRect =>
                entry != null &&
                typeof entry === "object" &&
                typeof (entry as Record<string, unknown>).x === "number" &&
                typeof (entry as Record<string, unknown>).y === "number" &&
                typeof (entry as Record<string, unknown>).w === "number" &&
                typeof (entry as Record<string, unknown>).h === "number",
        );
        return valid.length > 0 ? valid : undefined;
    }, [selectedImage]);

    const hasLockedOverlays =
        lockedOverlays !== undefined && lockedOverlays.length > 0;

    // Auto-engage lock when image has persisted overlays
    useEffect(() => {
        setLockEngaged(hasLockedOverlays);
    }, [hasLockedOverlays]);

    // Local override for canvas annotations so view mode reflects edits immediately
    // (selectedImage is intentionally NOT updated after saves to avoid viewer remount)
    const [localCanvasAnnotations, setLocalCanvasAnnotations] = useState<
        CanvasAnnotation[] | null
    >(null);

    // Reset version ref when a different image is selected
    useEffect(() => {
        latestVersionRef.current = selectedImage?.version ?? 0;
        latestMetadataRef.current = undefined; // reset to 'uninitialised' so first read falls back to selectedImage
        setLocalCanvasAnnotations(null); // fall back to server-derived data for new image
        // Clear any pending canvas annotation saves for the previous image
        if (canvasSaveTimerRef.current) {
            clearTimeout(canvasSaveTimerRef.current);
            canvasSaveTimerRef.current = null;
        }
        pendingCanvasAnnotationsRef.current = null;
        latestCanvasAnnotationsRef.current = null;
        canvasSaveInFlightRef.current = false;
        saveTargetImageIdRef.current = null;
    }, [selectedImage]);

    // Memoize initialOverlays: use locked overlays on initial load if no URL overlays.
    // Keyed on image ID so metadata-only updates do not re-create the viewer.
    const initialOverlays = useMemo(() => {
        if (
            lockedOverlays &&
            lockedOverlays.length > 0 &&
            overlays.length === 0
        ) {
            return lockedOverlays;
        }
        return overlays;
    }, [selectedImage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Extract canvas annotations from the selected image's metadata
    const canvasAnnotations = useMemo((): CanvasAnnotation[] => {
        const meta = selectedImage?.metadataExtra;
        if (!meta) return [];
        const annotations = meta.canvas_annotations;
        if (!Array.isArray(annotations)) return [];
        return annotations as CanvasAnnotation[];
    }, [selectedImage]);

    // Persist canvas annotations to server.  Called by the debounced handler below.
    const saveCanvasAnnotations = useCallback(
        async (annotations: CanvasAnnotation[]) => {
            if (!selectedImage) return;
            const targetImageId = selectedImage.id;
            saveTargetImageIdRef.current = targetImageId;
            canvasSaveInFlightRef.current = true;
            try {
                const mergeValue =
                    annotations.length > 0 ? annotations : null;
                const currentVersion =
                    latestVersionRef.current || selectedImage.version;
                const updated = await apiUpdateImage(
                    selectedImage.id,
                    {
                        metadata_extra_merge: {
                            canvas_annotations: mergeValue,
                        },
                    },
                    currentVersion,
                );
                // Only update shared refs if the image hasn't changed while we were saving
                if (saveTargetImageIdRef.current === targetImageId) {
                    latestVersionRef.current = updated.version;
                    latestMetadataRef.current = updated.metadata_extra ?? {};
                }
                await loadCategories();
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to save canvas annotations", err);
                setErrorSnack(userMessage(err, "Failed to save annotations."));
            } finally {
                // Only clear in-flight flag and flush queue if still targeting the same image
                if (saveTargetImageIdRef.current === targetImageId) {
                    canvasSaveInFlightRef.current = false;
                    if (pendingCanvasAnnotationsRef.current !== null) {
                        const queued = pendingCanvasAnnotationsRef.current;
                        pendingCanvasAnnotationsRef.current = null;
                        void saveCanvasAnnotations(queued);
                    }
                }
            }
        },
        [selectedImage, loadCategories, loadUncategorizedImages],
    );

    // Save canvas annotations to image metadata_extra (debounced).
    // Rapid edits reset a 600ms timer; if a save is already in-flight the
    // latest data is queued and flushed when the current request completes.
    // Also eagerly updates local state so view mode reflects edits immediately.
    const handleCanvasAnnotationsChange = useCallback(
        (annotations: CanvasAnnotation[]) => {
            setLocalCanvasAnnotations(annotations);
            latestCanvasAnnotationsRef.current = annotations;
            if (canvasSaveTimerRef.current)
                clearTimeout(canvasSaveTimerRef.current);
            if (canvasSaveInFlightRef.current) {
                // A save is in-flight — queue the latest data (replaces any prior queued data)
                pendingCanvasAnnotationsRef.current = annotations;
                return;
            }
            canvasSaveTimerRef.current = setTimeout(() => {
                canvasSaveTimerRef.current = null;
                void saveCanvasAnnotations(annotations);
            }, 600);
        },
        [saveCanvasAnnotations],
    );

    // Flush any pending canvas annotation save immediately (bypass debounce).
    // Used by the "Done" button to ensure data is persisted before exiting edit mode,
    // and by lock/clear operations to avoid race conditions.
    const flushCanvasAnnotations = useCallback(async () => {
        // Cancel any pending debounce timer
        if (canvasSaveTimerRef.current) {
            clearTimeout(canvasSaveTimerRef.current);
            canvasSaveTimerRef.current = null;
        }
        // If there's queued data waiting behind an in-flight save, grab it
        const pending = pendingCanvasAnnotationsRef.current;
        pendingCanvasAnnotationsRef.current = null;
        // If a save is already in-flight we need to wait for it, then save queued data
        if (canvasSaveInFlightRef.current) {
            // Re-queue so the in-flight finally block picks it up
            if (pending) pendingCanvasAnnotationsRef.current = pending;
            // Spin-wait (max ~3s) for the in-flight save to finish
            for (let i = 0; i < 30 && canvasSaveInFlightRef.current; i++) {
                await new Promise((r) => setTimeout(r, 100));
            }
            // After waiting, save any data the in-flight handler didn't pick up
            const stillPending = pendingCanvasAnnotationsRef.current;
            if (stillPending && !canvasSaveInFlightRef.current) {
                pendingCanvasAnnotationsRef.current = null;
                await saveCanvasAnnotations(stillPending);
            }
            return;
        }
        // Use the ref (always current) instead of localCanvasAnnotations state
        // which may be stale due to React's async state batching.
        const latest = latestCanvasAnnotationsRef.current;
        if (pending) {
            await saveCanvasAnnotations(pending);
        } else if (latest) {
            await saveCanvasAnnotations(latest);
        }
    }, [saveCanvasAnnotations]);

    // Build measurement config from the selected image's metadata
    const selectedImageMeasurement = useMemo(():
        | MeasurementConfig
        | undefined => {
        const meta = selectedImage?.metadataExtra;
        if (!meta) return undefined;
        const scale =
            typeof meta.measurement_scale === "number"
                ? meta.measurement_scale
                : undefined;
        const unit =
            typeof meta.measurement_unit === "string"
                ? meta.measurement_unit
                : undefined;
        if (!scale && !unit) return undefined;
        return { scale, unit };
    }, [selectedImage]);

    // Lock overlays: persist to image metadata_extra and engage lock.
    // Refreshes category tree so re-navigation reflects the update;
    // does NOT call setSelectedImage to avoid triggering a viewer remount.
    // Flushes any pending canvas annotation save first to prevent race conditions.
    const handleLockOverlays = useCallback(
        async (rects: OverlayRect[]) => {
            if (!selectedImage) return;
            // Flush any pending canvas annotation save to avoid version conflict
            await flushCanvasAnnotations();
            try {
                const currentVersion =
                    latestVersionRef.current || selectedImage.version;
                const updated = await apiUpdateImage(
                    selectedImage.id,
                    { metadata_extra_merge: { locked_overlays: rects } },
                    currentVersion,
                );
                latestVersionRef.current = updated.version;
                latestMetadataRef.current = updated.metadata_extra ?? {};
                setLockEngaged(true);
                await loadCategories();
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to lock overlays", err);
                setErrorSnack(userMessage(err, "Failed to lock overlays."));
            }
        },
        [
            selectedImage,
            flushCanvasAnnotations,
            loadCategories,
            loadUncategorizedImages,
        ],
    );

    // Unlock: only disengage the lock UI (re-enable clear button).
    // Does NOT remove persisted overlays from metadata.
    const handleUnlockOverlays = useCallback(() => {
        setLockEngaged(false);
    }, []);

    // Clear overlays: also remove from metadata if they were persisted.
    // Refreshes category tree; does NOT call setSelectedImage.
    // No hasLockedOverlays guard — selectedImage may be stale after a lock
    // in the same session (we intentionally skip setSelectedImage on lock).
    // Flushes any pending canvas annotation save first to prevent race conditions.
    const handleClearOverlays = useCallback(async () => {
        if (!selectedImage) return;
        // Flush any pending canvas annotation save to avoid version conflict
        await flushCanvasAnnotations();
        try {
            const currentVersion =
                latestVersionRef.current || selectedImage.version;
            const updated = await apiUpdateImage(
                selectedImage.id,
                { metadata_extra_merge: { locked_overlays: null } },
                currentVersion,
            );
            latestVersionRef.current = updated.version;
            latestMetadataRef.current = updated.metadata_extra ?? {};
            await loadCategories();
            loadUncategorizedImages();
        } catch (err) {
            console.error("Failed to clear locked overlays", err);
            setErrorSnack(userMessage(err, "Failed to clear locked overlays."));
        }
    }, [
        selectedImage,
        flushCanvasAnnotations,
        loadCategories,
        loadUncategorizedImages,
    ]);

    const copyShareLink = useCallback(() => {
        const url = window.location.href;
        const fallbackCopy = () => {
            const input = document.createElement("input");
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand("copy");
            document.body.removeChild(input);
            setSnackOpen(true);
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard
                .writeText(url)
                .then(() => {
                    setSnackOpen(true);
                })
                .catch(fallbackCopy);
        } else {
            fallbackCopy();
        }
    }, []);

    // Resolve the live children/images from the categories state tree
    // so newly added categories appear immediately.
    const { cats: resolvedCategories, imgs: currentImages } = useMemo(() => {
        let node = categories;
        for (const segment of path) {
            const found = node.find((c) => c.id === segment.id);
            if (!found) return { cats: [] as Category[], imgs: [] as ImageItem[] };
            node = found.children;
            if (segment === path[path.length - 1]) {
                return { cats: found.children, imgs: found.images };
            }
        }
        return { cats: node, imgs: [] as ImageItem[] };
    }, [categories, path]);

    // Walk the categories tree along the given path segments applying narrowing
    // (intersection) semantics. `depth` controls how many path segments to
    // traverse (defaults to all).
    const getPathRestriction = useCallback(
        (depth?: number): number[] => {
            const ancestors: Category[] = [];
            let node = categories;
            const limit = depth ?? path.length;
            for (let i = 0; i < limit; i++) {
                const found = node.find((c) => c.id === path[i].id);
                if (!found) break;
                ancestors.push(found);
                node = found.children;
            }
            return narrowProgramIds(ancestors);
        },
        [categories, path],
    );

    const ancestorProgramIds = useMemo(
        () => getPathRestriction(),
        [getPathRestriction],
    );

    // Filter out hidden categories for students in browse mode
    const isStudent = currentUser?.role === "student";
    const currentCategories = useMemo(
        () =>
            isStudent
                ? resolvedCategories.filter((c) => c.status !== "hidden")
                : resolvedCategories,
        [isStudent, resolvedCategories],
    );

    const editCategoryContext = useMemo(() => {
        const fallback = {
            siblingNames: [] as string[],
            inheritedProgramIds: [] as number[],
            freshLabel: editNameCategory?.label ?? "",
            freshProgramIds: editNameCategory?.programIds ?? [],
        };
        if (!editNameCategory) return fallback;
        const isBreadcrumbCategory =
            path.length > 0 && path[path.length - 1].id === editNameCategory.id;
        if (isBreadcrumbCategory) {
            let parentChildren = categories;
            for (let i = 0; i < path.length - 1; i++) {
                const found = parentChildren.find((c) => c.id === path[i].id);
                if (!found) break;
                parentChildren = found.children;
            }
            const freshCat = parentChildren.find((c) => c.id === editNameCategory.id);
            const siblingNames = parentChildren
                .filter((c) => c.id !== editNameCategory.id)
                .map((c) => c.label);
            return {
                siblingNames,
                inheritedProgramIds: getPathRestriction(path.length - 1),
                freshLabel: freshCat?.label ?? editNameCategory.label,
                freshProgramIds: freshCat?.programIds ?? editNameCategory.programIds,
            };
        }
        const freshChild = currentCategories.find((c) => c.id === editNameCategory.id);
        return {
            siblingNames: currentCategories
                .filter((c) => c.id !== editNameCategory.id)
                .map((c) => c.label),
            inheritedProgramIds: ancestorProgramIds,
            freshLabel: freshChild?.label ?? editNameCategory.label,
            freshProgramIds: freshChild?.programIds ?? editNameCategory.programIds,
        };
    }, [editNameCategory, path, categories, currentCategories, ancestorProgramIds, getPathRestriction]);

    const clearImage = useCallback(() => {
        setSelectedImage(null);
        setViewportState(undefined);
        setOverlays([]);
    }, []);

    const handleImageClick = useCallback(
        (img: ImageItem) => {
            setSelectedImage(img);
            pushNavState(
                "browse",
                pathRef.current.map((c) => c.id),
                img.id,
            );
        },
        [pushNavState],
    );

    const navigateToCategory = (cat: Category) => {
        setPath((prev) => [...prev, cat]);
    };

    const navigateToDepth = (depth: number) => {
        setPath((prev) => prev.slice(0, depth));
    };

    const addCategoryInline = useCallback(
        async (
            label: string,
            parentId: number | null,
            programIds?: number[],
        ): Promise<number | void> => {
            const body: Parameters<typeof apiCreateCategory>[0] = {
                label,
                parent_id: parentId,
            };
            if (programIds !== undefined) body.program_ids = programIds;
            const created = await apiCreateCategory(body);
            await loadCategories();
            loadUncategorizedImages();
            return created.id;
        },
        [loadCategories, loadUncategorizedImages],
    );

    const deleteCategoryInline = useCallback(
        async (categoryId: number) => {
            try {
                await apiDeleteCategory(categoryId);
                // Clear path segments that reference the deleted category
                setPath((prev) => {
                    const idx = prev.findIndex((seg) => seg.id === categoryId);
                    return idx >= 0 ? prev.slice(0, idx) : prev;
                });
                await loadCategories();
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to delete category", err);
                setErrorSnack(userMessage(err, "Failed to delete category."));
            }
        },
        [loadCategories, loadUncategorizedImages],
    );

    const editCategoryInline = useCallback(
        async (
            categoryId: number,
            newLabel: string,
            programIds?: number[],
        ) => {
            const body: Parameters<typeof apiUpdateCategory>[1] = {
                label: newLabel,
            };
            if (programIds !== undefined) body.program_ids = programIds;
            await apiUpdateCategory(categoryId, body);
            await loadCategories();
        },
        [loadCategories],
    );

    const toggleCategoryVisibility = useCallback(
        async (categoryId: number) => {
            try {
                const catPath = findCategoryPath(categories, categoryId);
                const current = catPath?.[catPath.length - 1];
                await apiUpdateCategory(categoryId, {
                    status:
                        current?.status === "hidden" ? "active" : "hidden",
                });
                await loadCategories();
            } catch (err) {
                console.error("Failed to toggle category visibility", err);
                setErrorSnack(userMessage(err, "Failed to toggle category visibility."));
            }
        },
        [categories, loadCategories],
    );

    const reorderCategoriesInline = useCallback(
        async (
            items: Array<{
                id: number;
                parent_id: number | null;
                sort_order: number;
            }>,
        ) => {
            try {
                await apiReorderCategories(items);
                await loadCategories();
            } catch (err) {
                console.error("Failed to reorder categories", err);
                setErrorSnack(userMessage(err, "Failed to reorder categories."));
            }
        },
        [loadCategories],
    );

    const handleMoveCategory = useCallback(
        async (categoryId: number, newParentId: number | null) => {
            try {
                await apiUpdateCategory(categoryId, { parent_id: newParentId });
                setMoveCatOpen(false);
                setMovingCategory(null);
                await loadCategories();
            } catch (err) {
                console.error("Failed to move category", err);
                setErrorSnack(userMessage(err, "Failed to move category."));
            }
        },
        [loadCategories],
    );

    const handleRequestMoveCategory = useCallback((cat: Category) => {
        setMovingCategory(cat);
        setMoveCatOpen(true);
    }, []);

    const handleDropImageOnCategory = useCallback(
        async (imageId: number, categoryId: number) => {
            try {
                const found = findImageInTree(categories, imageId);
                const img =
                    found?.image ??
                    uncategorizedImages.find((i) => i.id === imageId);
                if (!img) return;
                if (img.categoryId === categoryId) return;
                await apiUpdateImage(
                    imageId,
                    { category_id: categoryId },
                    img.version,
                );
                await loadCategories();
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to move image via drag-and-drop", err);
                setErrorSnack(
                    userMessage(err, "Failed to move image to category."),
                );
            }
        },
        [categories, uncategorizedImages, loadCategories, loadUncategorizedImages],
    );

    const handleDropCategoryOnCategory = useCallback(
        async (draggedCategoryId: number, targetCategoryId: number) => {
            try {
                await apiUpdateCategory(draggedCategoryId, {
                    parent_id: targetCategoryId,
                });
                await loadCategories();
            } catch (err) {
                console.error(
                    "Failed to move category via drag-and-drop",
                    err,
                );
                setErrorSnack(
                    userMessage(err, "Failed to move category."),
                );
            }
        },
        [loadCategories],
    );

    // Track when native files are being dragged over the page so we can
    // show the prominent FileDropZone at the end of the card grid.
    useEffect(() => {
        if (!canEditContent) return;
        const handleDragEnter = (e: DragEvent) => {
            if (!e.dataTransfer?.types.includes("Files")) return;
            fileDragCounter.current += 1;
            if (fileDragCounter.current === 1) setFileDragActive(true);
        };
        const handleDragLeave = (e: DragEvent) => {
            if (!e.dataTransfer?.types.includes("Files")) return;
            fileDragCounter.current -= 1;
            if (fileDragCounter.current === 0) setFileDragActive(false);
        };
        const handleDragOver = (e: DragEvent) => {
            if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
        };
        const handleDrop = (e: DragEvent) => {
            if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
            fileDragCounter.current = 0;
            // Defer state reset so React's synthetic event handlers on
            // FileDropZone can fire before the component unmounts.
            requestAnimationFrame(() => setFileDragActive(false));
        };
        window.addEventListener("dragenter", handleDragEnter);
        window.addEventListener("dragleave", handleDragLeave);
        window.addEventListener("dragover", handleDragOver);
        window.addEventListener("drop", handleDrop, true);
        return () => {
            window.removeEventListener("dragenter", handleDragEnter);
            window.removeEventListener("dragleave", handleDragLeave);
            window.removeEventListener("dragover", handleDragOver);
            window.removeEventListener("drop", handleDrop, true);
        };
    }, [canEditContent]);

    const handleSetCardImage = useCallback(
        async (categoryId: number, imageId: number | null) => {
            try {
                // Find existing metadata so we merge rather than overwrite
                const findCat = (cats: Category[]): Category | null => {
                    for (const c of cats) {
                        if (c.id === categoryId) return c;
                        const found = findCat(c.children);
                        if (found) return found;
                    }
                    return null;
                };
                const existing = findCat(categories)?.metadataExtra ?? {};
                await apiUpdateCategory(categoryId, {
                    metadata_extra: { ...existing, card_image_id: imageId },
                });
                await loadCategories();
            } catch (err) {
                console.error("Failed to set card image", err);
                setErrorSnack(userMessage(err, "Failed to set card image."));
            }
        },
        [loadCategories, categories],
    );

    const toggleImageVisibility = useCallback(
        async (imageId: number) => {
            try {
                const found = findImageInTree(categories, imageId);
                const img =
                    found?.image ??
                    uncategorizedImages.find((i) => i.id === imageId);
                if (!img) return;
                const updated = await apiUpdateImage(
                    imageId,
                    { active: !img.active },
                    img.version,
                );
                setSelectedImage((prev) =>
                    prev && prev.id === imageId
                        ? { ...prev, active: updated.active, version: updated.version }
                        : prev,
                );
                await loadCategories();
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to toggle image visibility", err);
                setErrorSnack(userMessage(err, "Failed to toggle image visibility."));
            }
        },
        [categories, uncategorizedImages, loadCategories, loadUncategorizedImages],
    );

    // Build ApiImage shape from selectedImage for EditImageModal on viewer page
    const selectedApiImage: ApiImage | null = selectedImage
        ? {
              id: selectedImage.id,
              name: selectedImage.name,
              thumb: selectedImage.thumb,
              tile_sources: selectedImage.tileSources,
              category_id: selectedImage.categoryId ?? null,
              copyright: selectedImage.copyright ?? null,
              note: selectedImage.note ?? null,
              active: selectedImage.active,
              version: selectedImage.version,
              metadata_extra: selectedImage.metadataExtra ?? null,
              width: selectedImage.width ?? null,
              height: selectedImage.height ?? null,
              file_size: selectedImage.fileSize ?? null,
              created_at: selectedImage.createdAt ?? "",
              updated_at: selectedImage.updatedAt ?? "",
          }
        : null;

    // Build ApiImage shape from browseEditImage for EditImageModal on browse page
    const browseApiImage: ApiImage | null = browseEditImage
        ? {
              id: browseEditImage.id,
              name: browseEditImage.name,
              thumb: browseEditImage.thumb,
              tile_sources: browseEditImage.tileSources,
              category_id: browseEditImage.categoryId ?? null,
              copyright: browseEditImage.copyright ?? null,
              note: browseEditImage.note ?? null,
              active: browseEditImage.active,
              version: browseEditImage.version,
              metadata_extra: browseEditImage.metadataExtra ?? null,
              width: browseEditImage.width ?? null,
              height: browseEditImage.height ?? null,
              file_size: browseEditImage.fileSize ?? null,
              created_at: browseEditImage.createdAt ?? "",
              updated_at: browseEditImage.updatedAt ?? "",
          }
        : null;

    const handleSaveBrowseImage = useCallback(
        async (data: ImageFormData) => {
            if (!browseEditImage) return;
            try {
                await apiUpdateImage(browseEditImage.id, data);
                setBrowseEditImage(null);
                await loadCategories();
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to update image", err);
                setErrorSnack(userMessage(err, "Failed to update image."));
            }
        },
        [browseEditImage, loadCategories, loadUncategorizedImages],
    );

    const handleSaveViewerImage = useCallback(
        async (data: ImageFormData) => {
            if (!selectedImage) return;
            try {
                const updated = await apiUpdateImage(selectedImage.id, data);
                setSelectedImage({
                    id: updated.id,
                    name: updated.name,
                    thumb: updated.thumb,
                    tileSources: updated.tile_sources,
                    categoryId: updated.category_id,
                    copyright: updated.copyright,
                    note: updated.note,
                    active: updated.active,
                    version: updated.version,
                    createdAt: updated.created_at,
                    updatedAt: updated.updated_at,
                    metadataExtra: updated.metadata_extra,
                    width: updated.width,
                    height: updated.height,
                    fileSize: updated.file_size,
                });
                setImageEditOpen(false);
                // Refresh categories and update breadcrumb path from the fresh tree
                const freshTree = (await fetchCategoryTree()).map(
                    apiTreeToCategory,
                );
                setCategories(freshTree);
                if (updated.category_id != null) {
                    const newPath = findCategoryPath(
                        freshTree,
                        updated.category_id,
                    );
                    setPath(newPath ?? []);
                } else {
                    setPath([]);
                }
                loadUncategorizedImages();
            } catch (err) {
                console.error("Failed to update image", err);
                setErrorSnack(userMessage(err, "Failed to update image."));
            }
        },
        [selectedImage, loadUncategorizedImages],
    );

    const addProcessingJob = useCallback(
        (sourceImageId: number, filename: string, fileSize: number) => {
            setProcessingJobs((prev) => {
                if (
                    prev.filter(
                        (j) =>
                            j.status === "uploading" ||
                            j.status === "processing" ||
                            j.status === "importing",
                    ).length >= MAX_PROCESSING_JOBS
                )
                    return prev;
                if (prev.some((j) => j.id === sourceImageId)) return prev;
                return [
                    ...prev,
                    {
                        id: sourceImageId,
                        filename,
                        status: "processing" as const,
                        kind: "image" as const,
                        serverProgress: 0,
                        fileSize,
                        startedAt: Date.now(),
                    },
                ];
            });
        },
        [],
    );

    const updateBulkImportJob = useCallback(
        (
            bulkJob: ApiBulkImportJob,
            filename: string,
            fileSize: number,
            uploadId?: number,
        ) => {
            const done = bulkJob.completed_count + bulkJob.failed_count;
            const progress =
                bulkJob.total_count > 0
                    ? Math.round((done / bulkJob.total_count) * 100)
                    : 0;
            setProcessingJobs((prev) => {
                const existing = prev.find(
                    (j) =>
                        j.bulkImportJobId === bulkJob.id ||
                        (uploadId !== undefined && j.uploadId === uploadId),
                );
                const status =
                    bulkJob.status === "completed"
                        ? "completed"
                        : bulkJob.status === "failed"
                          ? "failed"
                          : "importing";
                if (existing) {
                    return prev.map((j) =>
                        j.id === existing.id
                            ? {
                                  ...j,
                                  kind: "bulk-import" as const,
                                  status,
                                  bulkImportJobId: bulkJob.id,
                                  serverProgress:
                                      status === "completed" ? 100 : progress,
                                  uploadId: undefined,
                                  uploadProgress: undefined,
                                  totalCount: bulkJob.total_count,
                                  completedCount: bulkJob.completed_count,
                                  failedCount: bulkJob.failed_count,
                                  errors: bulkJob.errors,
                                  errorMessage:
                                      status === "failed"
                                          ? "Bulk import failed."
                                          : undefined,
                              }
                            : j,
                    );
                }
                if (
                    prev.filter(
                        (j) =>
                            j.status === "uploading" ||
                            j.status === "processing" ||
                            j.status === "importing",
                    ).length >= MAX_PROCESSING_JOBS
                )
                    return prev;
                return [
                    ...prev,
                    {
                        id: -bulkJob.id,
                        filename,
                        status,
                        kind: "bulk-import" as const,
                        bulkImportJobId: bulkJob.id,
                        serverProgress:
                            status === "completed" ? 100 : progress,
                        fileSize,
                        startedAt: Date.now(),
                        totalCount: bulkJob.total_count,
                        completedCount: bulkJob.completed_count,
                        failedCount: bulkJob.failed_count,
                        errors: bulkJob.errors,
                        errorMessage:
                            status === "failed"
                                ? "Bulk import failed."
                                : undefined,
                    },
                ];
            });
        },
        [],
    );

    const handleReplaceViewerImage = useCallback(
        async ({ file, formData }: ReplaceImageData) => {
            if (!selectedImage) return;

            // Snapshot for rollback on failure
            const prevImage = selectedImage;

            // Optimistically update the local image state with metadata
            // changes so the UI reflects them immediately.
            setSelectedImage((prev) =>
                prev
                    ? {
                          ...prev,
                          name: formData.name ?? prev.name,
                          categoryId: formData.category_id !== undefined ? formData.category_id : prev.categoryId,
                          copyright: formData.copyright !== undefined ? formData.copyright : prev.copyright,
                          note: formData.note !== undefined ? formData.note : prev.note,
                          active: formData.active !== undefined ? formData.active : prev.active,
                      }
                    : prev,
            );

            // Create an uploading job so progress is tracked in snackbar/modal
            const uploadId = nextReplaceUploadIdRef.current++;
            activeReplaceUploadIdRef.current = { uploadId, context: "viewer" };
            setProcessingJobs((prev) => {
                if (
                    prev.filter(
                        (j) =>
                            j.status === "uploading" ||
                            j.status === "processing" ||
                            j.status === "importing",
                    ).length >= MAX_PROCESSING_JOBS
                )
                    return prev;
                return [
                    ...prev,
                    {
                        id: -uploadId,
                        filename: file.name,
                        status: "uploading" as const,
                        kind: "image" as const,
                        serverProgress: 0,
                        fileSize: file.size,
                        startedAt: Date.now(),
                        uploadId,
                        uploadProgress: 0,
                    },
                ];
            });

            // Atomic replace: metadata + file in a single request (#271)
            const abort = new AbortController();
            replaceAbortRef.current = abort;
            apiReplaceImage(
                selectedImage.id,
                file,
                (fraction) => {
                    uploadProgressRef.current.set(uploadId, fraction);
                },
                abort.signal,
                formData,
            )
                .then((result) => {
                    replaceAbortRef.current = null;
                    uploadProgressRef.current.delete(uploadId);
                    activeReplaceUploadIdRef.current = null;
                    setProcessingJobs((prev) =>
                        prev.map((j) =>
                            j.uploadId === uploadId
                                ? {
                                      ...j,
                                      id: result.id,
                                      status: "processing" as const,
                                      kind: "image" as const,
                                      serverProgress: 0,
                                      startedAt: Date.now(),
                                      uploadId: undefined,
                                      uploadProgress: undefined,
                                  }
                                : j,
                        ),
                    );
                    setImageEditOpen(false);
                    loadCategories();
                    loadUncategorizedImages();
                })
                .catch((err) => {
                    replaceAbortRef.current = null;
                    uploadProgressRef.current.delete(uploadId);
                    activeReplaceUploadIdRef.current = null;
                    if (err instanceof DOMException && err.name === "AbortError") {
                        setProcessingJobs((prev) =>
                            prev.filter((j) => j.uploadId !== uploadId),
                        );
                        setSelectedImage((prev) => prev?.id === prevImage.id ? prevImage : prev);
                        setImageEditOpen(false);
                        return;
                    }
                    setSelectedImage((prev) => prev?.id === prevImage.id ? prevImage : prev);
                    setProcessingJobs((prev) =>
                        prev.map((j) =>
                            j.uploadId === uploadId
                                ? {
                                      ...j,
                                      status: "failed" as const,
                                      errorMessage: userMessage(err, "Failed to upload replacement image"),
                                      uploadId: undefined,
                                  }
                                : j,
                        ),
                    );
                    setImageEditOpen(false);
                });
        },
        [selectedImage, loadCategories, loadUncategorizedImages],
    );

    const handleReplaceBrowseImage = useCallback(
        async ({ file, formData }: ReplaceImageData) => {
            if (!browseEditImage) return;

            const uploadId = nextReplaceUploadIdRef.current++;
            activeReplaceUploadIdRef.current = { uploadId, context: "browse" };
            setProcessingJobs((prev) => {
                if (
                    prev.filter(
                        (j) =>
                            j.status === "uploading" ||
                            j.status === "processing" ||
                            j.status === "importing",
                    ).length >= MAX_PROCESSING_JOBS
                )
                    return prev;
                return [
                    ...prev,
                    {
                        id: -uploadId,
                        filename: file.name,
                        status: "uploading" as const,
                        kind: "image" as const,
                        serverProgress: 0,
                        fileSize: file.size,
                        startedAt: Date.now(),
                        uploadId,
                        uploadProgress: 0,
                    },
                ];
            });

            // Atomic replace: metadata + file in a single request (#271)
            const abort = new AbortController();
            replaceAbortRef.current = abort;
            apiReplaceImage(
                browseEditImage.id,
                file,
                (fraction) => {
                    uploadProgressRef.current.set(uploadId, fraction);
                },
                abort.signal,
                formData,
            )
                .then((result) => {
                    replaceAbortRef.current = null;
                    uploadProgressRef.current.delete(uploadId);
                    activeReplaceUploadIdRef.current = null;
                    setProcessingJobs((prev) =>
                        prev.map((j) =>
                            j.uploadId === uploadId
                                ? {
                                      ...j,
                                      id: result.id,
                                      status: "processing" as const,
                                      kind: "image" as const,
                                      serverProgress: 0,
                                      startedAt: Date.now(),
                                      uploadId: undefined,
                                      uploadProgress: undefined,
                                  }
                                : j,
                        ),
                    );
                    setBrowseEditImage(null);
                    loadCategories();
                    loadUncategorizedImages();
                })
                .catch((err) => {
                    replaceAbortRef.current = null;
                    uploadProgressRef.current.delete(uploadId);
                    activeReplaceUploadIdRef.current = null;
                    if (err instanceof DOMException && err.name === "AbortError") {
                        setProcessingJobs((prev) =>
                            prev.filter((j) => j.uploadId !== uploadId),
                        );
                        setBrowseEditImage(null);
                        return;
                    }
                    setProcessingJobs((prev) =>
                        prev.map((j) =>
                            j.uploadId === uploadId
                                ? {
                                      ...j,
                                      status: "failed" as const,
                                      errorMessage: userMessage(err, "Failed to upload replacement image"),
                                      uploadId: undefined,
                                  }
                                : j,
                        ),
                    );
                    setBrowseEditImage(null);
                });
        },
        [browseEditImage, loadCategories, loadUncategorizedImages],
    );

    const handleCancelReplace = useCallback(() => {
        replaceAbortRef.current?.abort();
    }, []);

    const handleUploadStarted = useCallback(
        (uploadId: number, filename: string, fileSize: number) => {
            setProcessingJobs((prev) => {
                if (
                    prev.filter(
                        (j) =>
                            j.status === "uploading" ||
                            j.status === "processing" ||
                            j.status === "importing",
                    ).length >= MAX_PROCESSING_JOBS
                )
                    return prev;
                return [
                    ...prev,
                    {
                        id: -uploadId,
                        filename,
                        status: "uploading" as const,
                        kind: "image" as const,
                        serverProgress: 0,
                        fileSize,
                        startedAt: Date.now(),
                        uploadId,
                        uploadProgress: 0,
                    },
                ];
            });
        },
        [],
    );

    const handleUploadProgress = useCallback(
        (uploadId: number, fraction: number) => {
            uploadProgressRef.current.set(uploadId, fraction);
        },
        [],
    );

    const handleUploadFailed = useCallback((uploadId: number, error: string) => {
        uploadProgressRef.current.delete(uploadId);
        setProcessingJobs((prev) =>
            prev.map((j) =>
                j.uploadId === uploadId
                    ? {
                          ...j,
                          status: "failed" as const,
                          errorMessage: error,
                      }
                    : j,
            ),
        );
    }, []);

    const handleProcessingStarted = useCallback(
        (
            sourceImageId: number,
            filename: string,
            fileSize: number,
            uploadId: number,
        ) => {
            setProcessingJobs((prev) => {
                const uploadingJob = prev.find(
                    (j) => j.status === "uploading" && j.uploadId === uploadId,
                );
                if (uploadingJob) {
                    uploadProgressRef.current.delete(uploadingJob.uploadId!);
                    return prev.map((j) =>
                        j.id === uploadingJob.id
                            ? {
                                  ...j,
                                  id: sourceImageId,
                                  status: "processing" as const,
                                  kind: "image" as const,
                                  serverProgress: 0,
                                  startedAt: Date.now(),
                                  uploadId: undefined,
                                  uploadProgress: undefined,
                              }
                            : j,
                    );
                }
                if (
                    prev.filter(
                        (j) =>
                            j.status === "uploading" ||
                            j.status === "processing" ||
                            j.status === "importing",
                    ).length >= MAX_PROCESSING_JOBS
                )
                    return prev;
                if (prev.some((j) => j.id === sourceImageId)) return prev;
                return [
                    ...prev,
                    {
                        id: sourceImageId,
                        filename,
                        status: "processing" as const,
                        kind: "image" as const,
                        serverProgress: 0,
                        fileSize,
                        startedAt: Date.now(),
                    },
                ];
            });
        },
        [],
    );

    const handleBulkImportStarted = useCallback(
        (
            job: ApiBulkImportJob,
            filename: string,
            fileSize: number,
            uploadId: number,
        ) => {
            uploadProgressRef.current.delete(uploadId);
            updateBulkImportJob(job, filename, fileSize, uploadId);
        },
        [updateBulkImportJob],
    );

    // Show loading spinner while users are loading
    if (usersLoading) {
        return (
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    minHeight: "100vh",
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    // Show login screen when no user is authenticated
    if (!currentUser) {
        return <LoginScreen onLogin={login} announcement={announcement} />;
    }

    // Compute per-modal replacement upload progress.
    // Each modal only sees progress for its own replacement operation.
    const activeReplace = activeReplaceUploadIdRef.current;
    const viewerReplaceUploadProgress =
        activeReplace?.context === "viewer"
            ? uploadProgressRef.current.get(activeReplace.uploadId) ?? 0
            : undefined;
    const browseReplaceUploadProgress =
        activeReplace?.context === "browse"
            ? uploadProgressRef.current.get(activeReplace.uploadId) ?? 0
            : undefined;

    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: "column",
                minHeight: "100vh",
            }}
        >
            {/* App bar */}
            <AppBar position="static" elevation={1}>
                <Toolbar>
                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            mr: 2,
                        }}
                    >
                        <Box
                            component="img"
                            src="/favicon.svg"
                            alt="HRIV"
                            sx={{ height: 32, width: 32 }}
                        />
                        <Typography variant="h6" component="h1">
                            HRIV
                        </Typography>
                    </Box>
                    <Tabs
                        value={page}
                        onChange={(_, v: Page) => {
                            if (
                                v === "browse" ||
                                v === "manage" ||
                                v === "people" ||
                                v === "admin"
                            ) {
                                setPage(v);
                                clearImage();
                                setPath([]);
                                pushNavState(v);
                                if (v === "browse") {
                                    loadCategories();
                                    loadUncategorizedImages();
                                }
                            }
                        }}
                        textColor="inherit"
                        TabIndicatorProps={{
                            style: { backgroundColor: "white" },
                        }}
                        sx={{ flexGrow: 1 }}
                    >
                        <Tab
                            label="Home"
                            value="browse"
                            onClick={() => {
                                if (page === "browse") {
                                    loadCategories();
                                    loadUncategorizedImages();
                                }
                                setPage("browse");
                                clearImage();
                                setPath([]);
                                pushNavState("browse");
                            }}
                        />
                        {canEditContent && (
                            <Tab label="Images" value="manage" />
                        )}
                        {canEditContent && (
                            <Tab
                                label="Manage"
                                value={false}
                                onClick={(e) =>
                                    setManageMenuAnchor(e.currentTarget)
                                }
                            />
                        )}
                        {canManageUsers && (
                            <Tab label="People" value="people" />
                        )}
                        {canManageUsers && <Tab label="Admin" value="admin" />}
                    </Tabs>
                    <Menu
                        anchorEl={manageMenuAnchor}
                        open={Boolean(manageMenuAnchor)}
                        onClose={() => setManageMenuAnchor(null)}
                    >
                        <MenuItem
                            onClick={() => {
                                setManageMenuAnchor(null);
                                setDialogOpen(true);
                            }}
                        >
                            Categories
                        </MenuItem>
                        <MenuItem
                            onClick={() => {
                                setManageMenuAnchor(null);
                                setProgramModalOpen(true);
                            }}
                        >
                            Programs
                        </MenuItem>
                        <MenuItem
                            onClick={() => {
                                setManageMenuAnchor(null);
                                openAnnModal();
                            }}
                        >
                            Announcement
                        </MenuItem>
                    </Menu>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <ColorModeToggle iconButtonSx={{ color: "inherit" }} />
                        <Tooltip title="Search">
                            <IconButton
                                onClick={() => setSearchOpen(true)}
                                sx={{ color: "inherit" }}
                                aria-label="Search"
                            >
                                <SearchIcon />
                            </IconButton>
                        </Tooltip>
                        <IconButton
                            ref={avatarRef}
                            onClick={() => setProfileOpen(true)}
                            sx={{ p: 0 }}
                        >
                            <Avatar
                                sx={{
                                    width: 34,
                                    height: 34,
                                    fontSize: 14,
                                    bgcolor: "rgba(255,255,255,0.25)",
                                    color: "white",
                                }}
                            >
                                {currentUser.name
                                    .split(" ")
                                    .map((w) => w[0])
                                    .join("")
                                    .toUpperCase()
                                    .slice(0, 2)}
                            </Avatar>
                        </IconButton>
                        <Popover
                            open={profileOpen}
                            anchorEl={avatarRef.current}
                            onClose={() => setProfileOpen(false)}
                            anchorOrigin={{
                                vertical: "bottom",
                                horizontal: "right",
                            }}
                            transformOrigin={{
                                vertical: "top",
                                horizontal: "right",
                            }}
                        >
                            <Card sx={{ minWidth: 240 }}>
                                <CardContent>
                                    <Typography
                                        variant="subtitle1"
                                        sx={{ fontWeight: 600 }}
                                    >
                                        {currentUser.name}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                    >
                                        {currentUser.email}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        sx={{ textTransform: "capitalize" }}
                                    >
                                        {currentUser.role}
                                    </Typography>
                                    {currentUser.program_names.length > 0 && (
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                            {currentUser.program_names.map((name) => (
                                                <Chip key={name} label={name} size="small" color="primary" />
                                            ))}
                                        </Box>
                                    )}
                                    <Box
                                        sx={{
                                            display: "flex",
                                            justifyContent: canManageUsers
                                                ? "space-between"
                                                : "flex-end",
                                            mt: 2,
                                        }}
                                    >
                                        {canManageUsers && (
                                            <Link
                                                component="button"
                                                variant="body2"
                                                onClick={() => {
                                                    setProfileOpen(false);
                                                    loadPrograms();
                                                    setEditModalOpen(true);
                                                }}
                                            >
                                                Update
                                            </Link>
                                        )}
                                        <Link
                                            component="button"
                                            variant="body2"
                                            color="primary"
                                            onClick={() => {
                                                setProfileOpen(false);
                                                logout();
                                            }}
                                        >
                                            Logout
                                        </Link>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Popover>
                    </Box>
                </Toolbar>
            </AppBar>

            {/* Announcement banner */}
            {announcement && <AnnouncementBanner message={announcement} />}

            {/* Main content */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    py: 3,
                    bgcolor:
                        page === "people" || page === "admin"
                            ? getSurfaceVariant(mode)
                            : undefined,
                }}
            >
                <Container
                    maxWidth={false}
                    sx={{ px: { xs: 2, sm: 3, lg: "72px", xl: "120px" } }}
                >
                    {page === "admin" && canManageUsers ? (
                        <AdminPage />
                    ) : page === "people" && canManageUsers ? (
                        <PeoplePage programs={programs} initialEditUserId={editUserId} onEditUserHandled={clearEditUserId} />
                    ) : page === "manage" && canEditContent ? (
                        <ManagePage
                            categories={categories}
                            programs={programs}
                            imagesVersion={imagesVersion}
                            onEditCategory={editCategoryInline}
                            onToggleVisibility={toggleCategoryVisibility}
                            onViewImage={(img) => {
                                setSelectedImage({
                                    id: img.id,
                                    name: img.name,
                                    thumb: img.thumb,
                                    tileSources: img.tile_sources,
                                    categoryId: img.category_id,
                                    copyright: img.copyright,
                                    note: img.note,
                                    active: img.active,
                                    version: img.version,
                                    createdAt: img.created_at,
                                    updatedAt: img.updated_at,
                                    metadataExtra: img.metadata_extra,
                                    width: img.width,
                                    height: img.height,
                                    fileSize: img.file_size,
                                });
                                const catPath =
                                    img.category_id != null
                                        ? findCategoryPath(
                                              categories,
                                              img.category_id,
                                          )
                                        : null;
                                setPath(catPath ?? []);
                                setPage("browse");
                                pushNavState(
                                    "browse",
                                    catPath?.map((c) => c.id) ?? [],
                                    img.id,
                                );
                            }}
                            onNavigateCategory={(categoryPath) => {
                                setPath(categoryPath);
                                setPage("browse");
                                pushNavState(
                                    "browse",
                                    categoryPath.map((c) => c.id),
                                );
                            }}
                            onCategoriesChanged={() => {
                                loadCategories();
                                loadUncategorizedImages();
                            }}
                            onAddCategory={addCategoryInline}
                            onReplaceImage={addProcessingJob}
                            onProcessingStarted={handleProcessingStarted}
                            onUploadStarted={handleUploadStarted}
                            onUploadProgress={handleUploadProgress}
                            onBulkImportStarted={handleBulkImportStarted}
                            onUploadFailed={handleUploadFailed}
                            onUploadOpenChange={setManageUploadOpen}
                            onSearchProgram={(programName) => {
                                setSearchInitialQuery(programName);
                                setSearchInitialTypeFilter('program');
                                setSearchOpen(true);
                            }}
                            initialProgramFilter={manageProgramFilter}
                            onInitialProgramFilterConsumed={clearManageProgramFilter}
                        />
                    ) : selectedImage ? (
                        /* ---- Viewer mode ---- */
                        <>
                            {/* Breadcrumbs + action buttons */}
                            <Box
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    mb: 2,
                                    gap: 1,
                                }}
                            >
                                <MuiBreadcrumbs
                                    aria-label="image breadcrumb"
                                    sx={{
                                        minWidth: 0,
                                        "& .MuiBreadcrumbs-ol": {
                                            flexWrap: "nowrap",
                                        },
                                        "& .MuiBreadcrumbs-li:last-of-type": {
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        },
                                    }}
                                >
                                    <Link
                                        component="button"
                                        variant="body2"
                                        underline="hover"
                                        color="inherit"
                                        onClick={() => {
                                            clearImage();
                                            navigateToDepth(0);
                                            pushNavState("browse");
                                        }}
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 0.5,
                                            cursor: "pointer",
                                        }}
                                    >
                                        <HomeIcon fontSize="small" />
                                        Home
                                    </Link>
                                    {path.map((cat, i) => (
                                        <Link
                                            key={cat.id}
                                            component="button"
                                            variant="body2"
                                            underline="hover"
                                            color="inherit"
                                            onClick={() => {
                                                clearImage();
                                                navigateToDepth(i + 1);
                                                pushNavState(
                                                    "browse",
                                                    path
                                                        .slice(0, i + 1)
                                                        .map((c) => c.id),
                                                );
                                            }}
                                            sx={{ cursor: "pointer" }}
                                        >
                                            {cat.label}
                                        </Link>
                                    ))}
                                    <Typography
                                        variant="body2"
                                        color="text.primary"
                                    >
                                        {selectedImage.name}
                                    </Typography>
                                </MuiBreadcrumbs>
                                <Box
                                    sx={{
                                        display: "flex",
                                        gap: 2,
                                        flexShrink: 0,
                                        alignItems: "center",
                                    }}
                                >
                                    {canEditContent && (
                                        <Tooltip title={selectedImage.active ? "Hide from students" : "Show to students"}>
                                            <IconButton
                                                size="small"
                                                onClick={() => toggleImageVisibility(selectedImage.id)}
                                                aria-label="Toggle visibility"
                                            >
                                                {selectedImage.active ? (
                                                    <VisibilityIcon
                                                        color="action"
                                                        sx={{ fontSize: 28 }}
                                                    />
                                                ) : (
                                                    <DisabledVisibleIcon
                                                        color="disabled"
                                                        sx={{ fontSize: 28 }}
                                                    />
                                                )}
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    {canEditContent && (
                                        <Tooltip
                                            title={
                                                canvasEditActive
                                                    ? "Exit canvas edit mode first"
                                                    : ""
                                            }
                                        >
                                            <span>
                                                <Button
                                                    variant="contained"
                                                    startIcon={<EditIcon />}
                                                    onClick={() =>
                                                        setImageEditOpen(true)
                                                    }
                                                    disabled={canvasEditActive}
                                                >
                                                    Edit Details
                                                </Button>
                                            </span>
                                        </Tooltip>
                                    )}
                                    <Tooltip title="Copy shareable link to clipboard">
                                        <Button
                                            variant="outlined"
                                            startIcon={<LinkIcon />}
                                            onClick={copyShareLink}
                                        >
                                            Share View
                                        </Button>
                                    </Tooltip>
                                </Box>
                            </Box>

                            <Paper
                                elevation={3}
                                sx={{ borderRadius: 2, overflow: "hidden" }}
                            >
                                <ImageViewer
                                    tileSources={selectedImage.tileSources}
                                    initialViewport={initialViewport}
                                    onViewportChange={handleViewportChange}
                                    measurement={selectedImageMeasurement}
                                    initialOverlays={initialOverlays}
                                    onOverlaysChange={handleOverlaysChange}
                                    canEditContent={canEditContent}
                                    overlaysLocked={lockEngaged}
                                    onLockOverlays={handleLockOverlays}
                                    onUnlockOverlays={handleUnlockOverlays}
                                    onClearOverlays={
                                        canEditContent
                                            ? handleClearOverlays
                                            : undefined
                                    }
                                    canvasAnnotations={
                                        localCanvasAnnotations ??
                                        canvasAnnotations
                                    }
                                    onCanvasAnnotationsChange={
                                        handleCanvasAnnotationsChange
                                    }
                                    onFlushCanvasAnnotations={
                                        flushCanvasAnnotations
                                    }
                                    onCanvasEditModeChange={setCanvasEditActive}
                                />
                            </Paper>

                            <Box sx={{ mt: 2 }}>
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                >
                                    Scroll or tap to zoom, and drag to pan.
                                    Buttons in the bottom left corner control
                                    the view. On touch-devices, pinch-turn to
                                    rotate. The mini-map in the bottom-right
                                    corner shows your current viewport.
                                </Typography>
                            </Box>

                            {/* Image metadata */}
                            <Box
                                sx={{
                                    mt: 2,
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 0,
                                    "& > span": { mr: "2em" },
                                }}
                            >
                                {selectedImage.copyright && (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        component="span"
                                    >
                                        <strong>Copyright:</strong>{" "}
                                        {selectedImage.copyright}
                                    </Typography>
                                )}
                                {ancestorProgramIds.length > 0 && (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        component="span"
                                    >
                                        <strong>
                                            Program
                                            {ancestorProgramIds.length > 1
                                                ? "s"
                                                : ""}
                                            :
                                        </strong>{" "}
                                        {ancestorProgramIds
                                            .map(
                                                (pid) =>
                                                    programs.find(
                                                        (p) => p.id === pid,
                                                    )?.name ?? pid,
                                            )
                                            .join(", ")}
                                    </Typography>
                                )}
                                {selectedImage.note && (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        component="span"
                                    >
                                        <strong>Note:</strong>{" "}
                                        {selectedImage.note}
                                    </Typography>
                                )}
                                {selectedImage.createdAt && (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        component="span"
                                    >
                                        <strong>Created:</strong>{" "}
                                        {new Date(
                                            selectedImage.createdAt,
                                        ).toLocaleString()}
                                    </Typography>
                                )}
                                {selectedImage.updatedAt && (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        component="span"
                                    >
                                        <strong>Modified:</strong>{" "}
                                        {new Date(
                                            selectedImage.updatedAt,
                                        ).toLocaleString()}
                                    </Typography>
                                )}
                                {selectedImage.width != null &&
                                    selectedImage.height != null && (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        component="span"
                                    >
                                        <strong>Dimensions:</strong>{" "}
                                        {selectedImage.width} &times;{" "}
                                        {selectedImage.height}
                                    </Typography>
                                )}
                                {selectedImage.fileSize != null && (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        component="span"
                                    >
                                        <strong>Size:</strong>{" "}
                                        {selectedImage.fileSize} MB
                                    </Typography>
                                )}
                                {selectedImageMeasurement && (
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        component="span"
                                    >
                                        <strong>Measurement:</strong>{" "}
                                        {selectedImageMeasurement.scale &&
                                        selectedImageMeasurement.unit
                                            ? `${selectedImageMeasurement.scale} px/${selectedImageMeasurement.unit}`
                                            : selectedImageMeasurement.scale
                                              ? `${selectedImageMeasurement.scale} px`
                                              : selectedImageMeasurement.unit ?? ""}
                                    </Typography>
                                )}
                            </Box>
                        </>
                    ) : (
                        /* ---- Browse mode ---- */
                        <>
                            {/* Breadcrumbs + action buttons */}
                            <Box
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    mb: 2,
                                    gap: 1,
                                }}
                            >
                                <Box
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1,
                                        minWidth: 0,
                                    }}
                                >
                                    <MuiBreadcrumbs
                                        aria-label="category breadcrumb"
                                        sx={{
                                            minWidth: 0,
                                            "& .MuiBreadcrumbs-ol": {
                                                flexWrap: "nowrap",
                                            },
                                            "& .MuiBreadcrumbs-li:last-of-type":
                                                {
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                },
                                        }}
                                    >
                                        <Link
                                            component="button"
                                            variant="body2"
                                            underline="hover"
                                            color={
                                                path.length === 0
                                                    ? "text.primary"
                                                    : "inherit"
                                            }
                                            onClick={() => {
                                                navigateToDepth(0);
                                                pushNavState("browse");
                                            }}
                                            sx={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 0.5,
                                                cursor: "pointer",
                                            }}
                                        >
                                            <HomeIcon fontSize="small" />
                                            Home
                                        </Link>
                                        {path.map((cat, i) => {
                                            const isLast =
                                                i === path.length - 1;
                                            return (
                                                <Box
                                                    key={cat.id}
                                                    sx={{
                                                        display: "flex",
                                                        alignItems:
                                                            "center",
                                                        gap: 0.25,
                                                        minWidth: 0,
                                                    }}
                                                >
                                                    <Link
                                                        component="button"
                                                        variant="body2"
                                                        underline="hover"
                                                        color={
                                                            isLast
                                                                ? "text.primary"
                                                                : "inherit"
                                                        }
                                                        onClick={() => {
                                                            navigateToDepth(
                                                                i + 1,
                                                            );
                                                            pushNavState(
                                                                "browse",
                                                                path
                                                                    .slice(
                                                                        0,
                                                                        i + 1,
                                                                    )
                                                                    .map(
                                                                        (c) =>
                                                                            c.id,
                                                                    ),
                                                            );
                                                        }}
                                                        sx={{
                                                            cursor: "pointer",
                                                            overflow:
                                                                "hidden",
                                                            textOverflow:
                                                                "ellipsis",
                                                            whiteSpace:
                                                                "nowrap",
                                                        }}
                                                    >
                                                        {cat.label}
                                                    </Link>
                                                    {isLast &&
                                                        canEditContent && (
                                                            <IconButton
                                                                size="small"
                                                                onClick={() =>
                                                                    setEditNameCategory(
                                                                        cat,
                                                                    )
                                                                }
                                                                aria-label="Edit category"
                                                                sx={{
                                                                    ml: 0.25,
                                                                }}
                                                            >
                                                                <EditIcon
                                                                    sx={{
                                                                        fontSize: 16,
                                                                    }}
                                                                />
                                                            </IconButton>
                                                        )}
                                                </Box>
                                            );
                                        })}
                                    </MuiBreadcrumbs>
                                    {(() => {
                                        const resolved =
                                            ancestorProgramIds
                                                .map((pid) =>
                                                    programs.find(
                                                        (p) =>
                                                            p.id === pid,
                                                    ),
                                                )
                                                .filter(
                                                    (
                                                        p,
                                                    ): p is Program =>
                                                        p != null,
                                                )
                                                .sort((a, b) =>
                                                    a.name.localeCompare(
                                                        b.name,
                                                    ),
                                                );
                                        if (resolved.length === 0)
                                            return null;
                                        const MAX_INLINE = 2;
                                        const inline = resolved.slice(
                                            0,
                                            MAX_INLINE,
                                        );
                                        const overflow =
                                            resolved.length - MAX_INLINE;
                                        return (
                                            <>
                                                {inline.map((p) => (
                                                    <Chip
                                                        key={p.id}
                                                        label={p.name}
                                                        size="small"
                                                        color="primary"
                                                    />
                                                ))}
                                                {overflow > 0 && (
                                                    <>
                                                        <Chip
                                                            label={`+${overflow}`}
                                                            size="small"
                                                            color="primary"
                                                            variant="outlined"
                                                            onClick={(
                                                                e,
                                                            ) =>
                                                                setProgramsPopoverAnchor(
                                                                    e.currentTarget,
                                                                )
                                                            }
                                                            aria-label={`${overflow} more programs`}
                                                            sx={{
                                                                cursor: "pointer",
                                                            }}
                                                        />
                                                        <Popover
                                                            open={
                                                                programsPopoverAnchor !=
                                                                null
                                                            }
                                                            anchorEl={
                                                                programsPopoverAnchor
                                                            }
                                                            onClose={() =>
                                                                setProgramsPopoverAnchor(
                                                                    null,
                                                                )
                                                            }
                                                            anchorOrigin={{
                                                                vertical:
                                                                    "bottom",
                                                                horizontal:
                                                                    "left",
                                                            }}
                                                        >
                                                            <Box
                                                                sx={{
                                                                    p: 1.5,
                                                                    display:
                                                                        "flex",
                                                                    flexDirection:
                                                                        "column",
                                                                    gap: 0.5,
                                                                }}
                                                            >
                                                                {resolved.map(
                                                                    (
                                                                        p,
                                                                    ) => (
                                                                        <Chip
                                                                            key={
                                                                                p.id
                                                                            }
                                                                            label={
                                                                                p.name
                                                                            }
                                                                            size="small"
                                                                            color="primary"
                                                                        />
                                                                    ),
                                                                )}
                                                            </Box>
                                                        </Popover>
                                                    </>
                                                )}
                                            </>
                                        );
                                    })()}
                                </Box>
                                {canEditContent && (
                                    <Box
                                        sx={{
                                            display: "flex",
                                            gap: 2,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {path.length < MAX_DEPTH && (
                                            <Button
                                                variant="outlined"
                                                startIcon={
                                                    <CreateNewFolderIcon />
                                                }
                                                onClick={() =>
                                                    setAddCatOpen(true)
                                                }
                                            >
                                                Add Category
                                            </Button>
                                        )}
                                        <Button
                                            variant="contained"
                                            startIcon={
                                                <AddPhotoAlternateIcon />
                                            }
                                            onClick={() => setUploadOpen(true)}
                                        >
                                            Add Images
                                        </Button>
                                    </Box>
                                )}
                            </Box>

                            {/* Tile grid */}
                            <Box
                                sx={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 2,
                                }}
                                onDragOver={
                                    canEditContent
                                        ? (e) => {
                                              if (
                                                  e.dataTransfer.types.includes(
                                                      "Files",
                                                  )
                                              ) {
                                                  e.preventDefault();
                                                  e.dataTransfer.dropEffect =
                                                      "copy";
                                              }
                                          }
                                        : undefined
                                }
                                onDrop={
                                    canEditContent
                                        ? (e) => {
                                              if (
                                                  e.dataTransfer.types.includes(
                                                      "Files",
                                                  )
                                              ) {
                                                  e.preventDefault();
                                                  const all = Array.from(
                                                      e.dataTransfer.files,
                                                  );
                                                  const accepted =
                                                      all.filter(
                                                          isAcceptedFile,
                                                      );
                                                  const rejected =
                                                      all.length -
                                                      accepted.length;
                                                  if (rejected > 0) {
                                                      setWarnSnack(
                                                          `${rejected} file${rejected > 1 ? "s" : ""} not supported (accepted: images, .zip)`,
                                                      );
                                                  }
                                                  if (accepted.length > 0) {
                                                      setDroppedFiles(accepted);
                                                      setUploadOpen(true);
                                                  }
                                              }
                                          }
                                        : undefined
                                }
                            >
                                {currentCategories.map((cat) => (
                                    <CategoryTile
                                        key={cat.id}
                                        category={cat}
                                        onClick={(cat) => {
                                            navigateToCategory(cat);
                                            pushNavState(
                                                "browse",
                                                [
                                                    ...path.map(
                                                        (c) => c.id,
                                                    ),
                                                    cat.id,
                                                ],
                                            );
                                        }}
                                        onMove={
                                            canEditContent
                                                ? handleRequestMoveCategory
                                                : undefined
                                        }
                                        onSetCardImage={
                                            canEditContent
                                                ? handleSetCardImage
                                                : undefined
                                        }
                                        onToggleVisibility={
                                            canEditContent
                                                ? toggleCategoryVisibility
                                                : undefined
                                        }
                                        onEditName={
                                            canEditContent
                                                ? setEditNameCategory
                                                : undefined
                                        }
                                        programs={programs}
                                        onDropImage={
                                            canEditContent
                                                ? handleDropImageOnCategory
                                                : undefined
                                        }
                                        onDropCategory={
                                            canEditContent
                                                ? handleDropCategoryOnCategory
                                                : undefined
                                        }
                                        onDropFiles={
                                            canEditContent
                                                ? (categoryId, files) => {
                                                      const accepted =
                                                          files.filter(
                                                              isAcceptedFile,
                                                          );
                                                      const rejected =
                                                          files.length -
                                                          accepted.length;
                                                      if (rejected > 0) {
                                                          setWarnSnack(
                                                              `${rejected} file${rejected > 1 ? "s" : ""} not supported (accepted: images, .zip)`,
                                                          );
                                                      }
                                                      if (accepted.length > 0) {
                                                          setFileDropCategoryId(
                                                              categoryId,
                                                          );
                                                          setDroppedFiles(
                                                              accepted,
                                                          );
                                                          setUploadOpen(true);
                                                      }
                                                  }
                                                : undefined
                                        }
                                        draggable={canEditContent}
                                    />
                                ))}
                                {path.length === 0 &&
                                    uncategorizedImages.map((img) => (
                                        <ImageTile
                                            key={img.id}
                                            image={img}
                                            onClick={handleImageClick}
                                            onEditDetails={
                                                canEditContent
                                                    ? setBrowseEditImage
                                                    : undefined
                                            }
                                            onToggleVisibility={
                                                canEditContent
                                                    ? toggleImageVisibility
                                                    : undefined
                                            }
                                            draggable={canEditContent}
                                        />
                                    ))}
                                {currentImages.map((img) => (
                                    <ImageTile
                                        key={img.id}
                                        image={img}
                                        onClick={handleImageClick}
                                        onEditDetails={
                                            canEditContent
                                                ? setBrowseEditImage
                                                : undefined
                                        }
                                        onToggleVisibility={
                                            canEditContent
                                                ? toggleImageVisibility
                                                : undefined
                                        }
                                        draggable={canEditContent}
                                    />
                                ))}
                                {canEditContent && (
                                    <FileDropZone
                                        isDragActive={fileDragActive}
                                        onDrop={(files) => {
                                            const accepted =
                                                files.filter(isAcceptedFile);
                                            const rejected =
                                                files.length - accepted.length;
                                            if (rejected > 0) {
                                                setWarnSnack(
                                                    `${rejected} file${rejected > 1 ? "s" : ""} not supported (accepted: images, .zip)`,
                                                );
                                            }
                                            if (accepted.length > 0) {
                                                setDroppedFiles(accepted);
                                                setUploadOpen(true);
                                            }
                                        }}
                                    />
                                )}
                            </Box>

                            {categoriesLoading ? (
                                <Box
                                    sx={{
                                        display: "flex",
                                        justifyContent: "center",
                                        mt: 4,
                                    }}
                                >
                                    <CircularProgress />
                                </Box>
                            ) : (
                                currentCategories.length === 0 &&
                                currentImages.length === 0 &&
                                (path.length > 0 ||
                                    uncategorizedImages.length === 0) && (
                                    <Typography
                                        variant="body1"
                                        color="text.secondary"
                                        sx={{ mt: 4, textAlign: "center" }}
                                    >
                                        {canEditContent
                                            ? "This category is empty. Add an image or sub-category to get started."
                                            : "This category is empty."}
                                    </Typography>
                                )
                            )}
                        </>
                    )}
                </Container>
            </Box>

            {/* Footer */}
            <Box
                component="footer"
                sx={{
                    py: 1,
                    px: 2,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    bgcolor:
                        mode === "dark"
                            ? "background.paper"
                            : "background.default",
                    borderTop: 1,
                    borderColor: "divider",
                }}
            >
                <Typography variant="caption" color="text.secondary">
                    <strong>BCIT</strong>{" "}
                    <Link
                        href="https://www.bcit.ca/learning-teaching-centre/"
                        target="_blank"
                        rel="noopener noreferrer"
                        color="text.secondary"
                        underline="hover"
                    >
                        Teaching and Learning Unit
                    </Link>
                    <Box
                        component="span"
                        sx={{ display: "inline-block", width: "3ch" }}
                    />
                    <strong>Source code:</strong>{" "}
                    <Link
                        href="https://www.mozilla.org/en-US/MPL/2.0/"
                        target="_blank"
                        rel="noopener noreferrer"
                        color="text.secondary"
                        underline="hover"
                    >
                        MPL-2.0
                    </Link>
                    {canManageUsers &&
                        (() => {
                            // Versions are admin-only: the strings leak info
                            // about the deployed image and are not relevant
                            // to other roles.  Each component versions
                            // independently (see release-please packages in
                            // release-please-config.json) so the footer
                            // lists three distinct values rather than a
                            // single shared version.
                            const frontendVer = frontendVersion || "dev";
                            const releasesHref =
                                "https://github.com/bcit-tlu/hriv/releases";
                            const repoHref =
                                "https://github.com/bcit-tlu/hriv";
                            const hrefFor = (v: string) =>
                                v && v !== "dev" ? releasesHref : repoHref;
                            return (
                                <>
                                    <Box
                                        component="span"
                                        sx={{
                                            display: "inline-block",
                                            width: "3ch",
                                        }}
                                    />
                                    <strong>Frontend:</strong>{" "}
                                    <Link
                                        href={hrefFor(frontendVer)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        color="text.secondary"
                                        underline="hover"
                                    >
                                        {frontendVer}
                                    </Link>
                                    <Box
                                        component="span"
                                        sx={{
                                            display: "inline-block",
                                            width: "3ch",
                                        }}
                                    />
                                    <strong>Backend:</strong>{" "}
                                    <Link
                                        href={hrefFor(backendVersion ?? "")}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        color="text.secondary"
                                        underline="hover"
                                    >
                                        {backendVersion ?? "…"}
                                    </Link>
                                    <Box
                                        component="span"
                                        sx={{
                                            display: "inline-block",
                                            width: "3ch",
                                        }}
                                    />
                                    <strong>Backup:</strong>{" "}
                                    <Link
                                        href={hrefFor(backupVersion ?? "")}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        color="text.secondary"
                                        underline="hover"
                                    >
                                        {backupVersion ?? "…"}
                                    </Link>
                                </>
                            );
                        })()}
                </Typography>
                <Link
                    component="button"
                    variant="caption"
                    color="text.secondary"
                    underline="hover"
                    onClick={() => setReportIssueOpen(true)}
                    sx={{ cursor: "pointer" }}
                >
                    Report issue
                </Link>
            </Box>

            {/* Manage categories dialog */}
            <ManageCategoriesDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                categories={categories}
                onAddCategory={addCategoryInline}
                onDeleteCategory={deleteCategoryInline}
                onEditCategory={editCategoryInline}
                onToggleVisibility={toggleCategoryVisibility}
                onReorderCategories={reorderCategoriesInline}
                programs={programs}
            />

            {/* Move category dialog */}
            <MoveCategoryDialog
                open={moveCatOpen}
                onClose={() => {
                    setMoveCatOpen(false);
                    setMovingCategory(null);
                }}
                onMove={handleMoveCategory}
                category={movingCategory}
                categories={categories}
                onAddCategory={addCategoryInline}
                onEditCategory={editCategoryInline}
                onToggleVisibility={toggleCategoryVisibility}
                programs={programs}
            />

            {/* Image edit modal (viewer page) — no View Image button since we're already viewing */}
            <EditImageModal
                open={imageEditOpen}
                onClose={() => setImageEditOpen(false)}
                onSave={handleSaveViewerImage}
                onDelete={
                    selectedImage
                        ? async () => {
                              await apiDeleteImage(selectedImage.id);
                              setImageEditOpen(false);
                              clearImage();
                              await loadCategories();
                              loadUncategorizedImages();
                          }
                        : undefined
                }
                onReplace={handleReplaceViewerImage}
                onCancelReplace={handleCancelReplace}
                replaceUploadProgress={viewerReplaceUploadProgress}
                image={selectedApiImage}
                categories={categories}
                programs={programs}
                onAddCategory={addCategoryInline}
                onEditCategory={editCategoryInline}
                onToggleVisibility={toggleCategoryVisibility}
            />

            {/* Browse-view image edit modal */}
            <EditImageModal
                open={browseEditImage != null}
                onClose={() => setBrowseEditImage(null)}
                onSave={handleSaveBrowseImage}
                onDelete={
                    browseEditImage
                        ? async () => {
                              await apiDeleteImage(browseEditImage.id);
                              setBrowseEditImage(null);
                              await loadCategories();
                              loadUncategorizedImages();
                          }
                        : undefined
                }
                onReplace={handleReplaceBrowseImage}
                onCancelReplace={handleCancelReplace}
                replaceUploadProgress={browseReplaceUploadProgress}
                image={browseApiImage}
                categories={categories}
                programs={programs}
                onAddCategory={addCategoryInline}
                onEditCategory={editCategoryInline}
                onToggleVisibility={toggleCategoryVisibility}
                onViewImage={
                    browseEditImage
                        ? () => {
                              setSelectedImage(browseEditImage);
                              setBrowseEditImage(null);
                              const catPath =
                                  browseEditImage.categoryId != null
                                      ? findCategoryPath(
                                            categories,
                                            browseEditImage.categoryId,
                                        )
                                      : null;
                              setPath(catPath ?? []);
                              pushNavState(
                                  "browse",
                                  catPath?.map((c) => c.id) ?? [],
                                  browseEditImage.id,
                              );
                          }
                        : undefined
                }
            />

            {/* Upload image modal */}
            <UploadImageModal
                open={uploadOpen}
                onClose={() => {
                    setUploadOpen(false);
                    setFileDropCategoryId(null);
                    setDroppedFiles([]);
                }}
                initialFiles={droppedFiles}
                onUploaded={() => {
                    loadCategories();
                    loadUncategorizedImages();
                }}
                onUploadStarted={handleUploadStarted}
                onUploadProgress={handleUploadProgress}
                onUploadFailed={handleUploadFailed}
                onProcessingStarted={handleProcessingStarted}
                onBulkImportStarted={handleBulkImportStarted}
                categoryId={fileDropCategoryId ?? (path.length > 0 ? path[path.length - 1].id : null)}
                categories={categories}
                programs={programs}
                onAddCategory={addCategoryInline}
                onEditCategory={editCategoryInline}
                onToggleVisibility={toggleCategoryVisibility}
            />

            {/* Add category dialog (home tab) */}
            <AddCategoryDialog
                open={addCatOpen}
                onClose={() => setAddCatOpen(false)}
                onAdd={async (label, programIds) => {
                    await addCategoryInline(
                        label,
                        path.length > 0
                            ? path[path.length - 1].id
                            : null,
                        programIds,
                    );
                }}
                parentLabel={path.length > 0 ? path[path.length - 1].label : undefined}
                siblingNames={currentCategories.map((c) => c.label)}
                programs={programs}
                inheritedProgramIds={ancestorProgramIds}
            />

            {/* Edit category name dialog (home tab) */}
            <EditCategoryDialog
                open={editNameCategory != null}
                onClose={() => setEditNameCategory(null)}
                onSave={async (newLabel, programIds) => {
                    if (!editNameCategory) return;
                    await editCategoryInline(
                        editNameCategory.id,
                        newLabel,
                        programIds,
                    );
                    if (path.some((p) => p.id === editNameCategory.id)) {
                        setPath((prev) =>
                            prev.map((p) =>
                                p.id === editNameCategory.id
                                    ? { ...p, label: newLabel, programIds: programIds ?? p.programIds }
                                    : p,
                            ),
                        );
                    }
                }}
                currentLabel={editCategoryContext.freshLabel}
                siblingNames={editCategoryContext.siblingNames}
                programs={programs}
                currentProgramIds={editCategoryContext.freshProgramIds}
                inheritedProgramIds={editCategoryContext.inheritedProgramIds}
            />

            {/* Self-edit profile modal */}
            <AddEditPersonModal
                open={editModalOpen}
                onClose={() => setEditModalOpen(false)}
                onSave={async (data) => {
                    if (!currentUser) return;
                    try {
                        await apiUpdateUser(currentUser.id, data);
                        setEditModalOpen(false);
                        // Refresh current user data by re-validating the token
                        window.location.reload();
                    } catch (err) {
                        console.error("Failed to update profile", err);
                        setErrorSnack(userMessage(err, "Failed to update profile."));
                    }
                }}
                programs={programs}
                user={currentApiUser}
            />

            {/* Announcement modal (from Manage menu) */}
            <Dialog
                open={annModalOpen}
                onClose={() => setAnnModalOpen(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Manage Announcement</DialogTitle>
                <DialogContent>
                    <TextField
                        label="Announcement Message"
                        multiline
                        minRows={3}
                        maxRows={8}
                        fullWidth
                        value={annDraftMessage}
                        onChange={(e) => setAnnDraftMessage(e.target.value)}
                        sx={{ mt: 1 }}
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={annDraftEnabled}
                                onChange={(e) =>
                                    setAnnDraftEnabled(e.target.checked)
                                }
                            />
                        }
                        label="Enable announcement"
                        sx={{ mt: 2 }}
                    />
                    {annError && (
                        <Alert
                            severity="error"
                            sx={{ mt: 2 }}
                            onClose={() => setAnnError(null)}
                        >
                            {annError}
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAnnModalOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleAnnSave}
                        disabled={annSaving}
                        startIcon={
                            annSaving ? (
                                <CircularProgress size={18} color="inherit" />
                            ) : undefined
                        }
                    >
                        {annSaving ? "Saving..." : "Save"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Program management modal (from Manage menu) */}
            <ProgramManagementModal
                open={programModalOpen}
                onClose={() => setProgramModalOpen(false)}
                programs={programs}
                onAdd={handleAddProgram}
                onEdit={handleEditProgram}
                onDelete={handleDeleteProgram}
            />

            {/* Report issue modal */}
            <ReportIssueModal
                open={reportIssueOpen}
                onClose={() => setReportIssueOpen(false)}
            />

            {/* Search modal */}
            <SearchModal
                open={searchOpen}
                onClose={() => {
                    setSearchOpen(false);
                    setSearchInitialQuery(undefined);
                    setSearchInitialTypeFilter(undefined);
                }}
                initialQuery={searchInitialQuery}
                initialTypeFilter={searchInitialTypeFilter as TypeFilter | undefined}
                categories={categories}
                uncategorizedImages={uncategorizedImages}
                programs={programs}
                users={searchUsers}
                isStudent={isStudent}
                onSelectCategory={(catPath) => {
                    setPage("browse");
                    setPath(catPath);
                    clearImage();
                    pushNavState(
                        "browse",
                        catPath.map((c) => c.id),
                    );
                }}
                onSelectImage={(image, catPath) => {
                    setPage("browse");
                    setPath(catPath);
                    setSelectedImage(image);
                    setViewportState(undefined);
                    setOverlays([]);
                    pushNavState(
                        "browse",
                        catPath.map((c) => c.id),
                        image.id,
                    );
                }}
                onSelectProgram={(programName) => {
                    if (canEditContent) {
                        setManageProgramFilter(programName);
                        setPage("manage");
                        pushNavState("manage");
                    }
                }}
                onSelectUser={(userId) => {
                    if (canManageUsers) {
                        setEditUserId(userId);
                        setPage("people");
                        pushNavState("people");
                    }
                }}
            />

            {/* Share-link snackbar */}
            <Snackbar
                open={snackOpen}
                autoHideDuration={3000}
                onClose={() => setSnackOpen(false)}
                message="Link copied to clipboard"
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                sx={{
                    zIndex: 1500,
                    bottom: {
                        xs: `${24 + visibleJobs.length * 88}px !important`,
                    },
                }}
            />

            {/* Warning snackbar (e.g. unsupported file drops) */}
            <Snackbar
                open={warnSnack !== null}
                autoHideDuration={6000}
                onClose={() => setWarnSnack(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
                sx={{ zIndex: 1500 }}
            >
                <Alert
                    severity="warning"
                    onClose={() => setWarnSnack(null)}
                    variant="filled"
                >
                    {warnSnack}
                </Alert>
            </Snackbar>

            {/* Error snackbar */}
            <Snackbar
                open={errorSnack !== null}
                autoHideDuration={6000}
                onClose={() => setErrorSnack(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
                sx={{ zIndex: 1500 }}
            >
                <Alert
                    severity="error"
                    onClose={() => setErrorSnack(null)}
                    variant="filled"
                >
                    {errorSnack}
                </Alert>
            </Snackbar>

            {/* Image upload + processing snackbars (one per job, stacked) */}
            {visibleJobs.map((job, index) => {
                const uploadFraction =
                    job.status === "uploading"
                        ? (uploadProgressRef.current.get(job.uploadId!) ??
                          job.uploadProgress ??
                          0)
                        : 0;
                const displayProgress = getDisplayProgress(job);
                const statusMsg = getStatusMessage(job);
                return (
                    <Snackbar
                        key={job.id}
                        open
                        autoHideDuration={
                            job.status === "processing" ||
                            job.status === "uploading" ||
                            job.status === "importing"
                                ? null
                                : 6000
                        }
                        onClose={(_event, reason) => {
                            if (reason === "clickaway") return;
                            setProcessingJobs((prev) =>
                                prev.filter((j) => j.id !== job.id),
                            );
                        }}
                        anchorOrigin={{
                            vertical: "bottom",
                            horizontal: "right",
                        }}
                        sx={{
                            zIndex: 1500,
                            bottom: { xs: `${24 + index * 88}px !important` },
                        }}
                    >
                        <Alert
                            severity={
                                job.status === "completed"
                                    ? "success"
                                    : job.status === "failed"
                                      ? "error"
                                      : "info"
                            }
                            variant="filled"
                            sx={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                            }}
                            icon={
                                job.status === "processing" ||
                                job.status === "uploading" ||
                                job.status === "importing" ? (
                                    <CircularProgress
                                        size={20}
                                        sx={{ color: "inherit" }}
                                    />
                                ) : undefined
                            }
                            onClose={() =>
                                setProcessingJobs((prev) =>
                                    prev.filter((j) => j.id !== job.id),
                                )
                            }
                        >
                            {job.status === "uploading" && (
                                <Box sx={{ width: "100%", minWidth: 220 }}>
                                    <Typography
                                        variant="body2"
                                        sx={{ mb: 0.5 }}
                                    >
                                        {`Uploading: ${job.filename} — ${Math.round(uploadFraction * 100)}%`}
                                    </Typography>
                                    <LinearProgress
                                        variant="determinate"
                                        value={Math.round(
                                            uploadFraction * 100,
                                        )}
                                        sx={{
                                            height: 6,
                                            borderRadius: 1,
                                            bgcolor: "rgba(255,255,255,0.3)",
                                            "& .MuiLinearProgress-bar": {
                                                bgcolor: "#fff",
                                            },
                                        }}
                                    />
                                </Box>
                            )}
                            {job.status === "processing" && (
                                <Box sx={{ width: "100%", minWidth: 220 }}>
                                    <Typography
                                        variant="body2"
                                        sx={{ mb: 0.5 }}
                                    >
                                        {`Processing: ${job.filename} — ${displayProgress}%`}
                                    </Typography>
                                    {statusMsg && (
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                opacity: 0.85,
                                                display: "block",
                                                mb: 0.25,
                                            }}
                                        >
                                            {statusMsg}
                                        </Typography>
                                    )}
                                    <LinearProgress
                                        variant="determinate"
                                        value={displayProgress}
                                        sx={{
                                            height: 6,
                                            borderRadius: 1,
                                            bgcolor: "rgba(255,255,255,0.3)",
                                            "& .MuiLinearProgress-bar": {
                                                bgcolor: "#fff",
                                            },
                                        }}
                                    />
                                </Box>
                            )}
                            {job.status === "importing" && (
                                <Box sx={{ width: "100%", minWidth: 220 }}>
                                    <Typography
                                        variant="body2"
                                        sx={{ mb: 0.5 }}
                                    >
                                        {`Importing: ${job.filename} — ${displayProgress}%`}
                                    </Typography>
                                    {job.totalCount != null && (
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                opacity: 0.85,
                                                display: "block",
                                                mb: 0.25,
                                            }}
                                        >
                                            {`${job.completedCount ?? 0} of ${job.totalCount} completed${
                                                job.failedCount
                                                    ? `, ${job.failedCount} failed`
                                                    : ""
                                            }`}
                                        </Typography>
                                    )}
                                    <LinearProgress
                                        variant="determinate"
                                        value={displayProgress}
                                        sx={{
                                            height: 6,
                                            borderRadius: 1,
                                            bgcolor: "rgba(255,255,255,0.3)",
                                            "& .MuiLinearProgress-bar": {
                                                bgcolor: "#fff",
                                            },
                                        }}
                                    />
                                </Box>
                            )}
                            {job.status === "completed" && (
                                <>
                                    {job.kind === "bulk-import"
                                        ? `"${job.filename}" import completed${
                                              job.failedCount
                                                  ? ` with ${job.failedCount} failed.`
                                                  : " successfully!"
                                          }`
                                        : `"${job.filename}" processed successfully! `}
                                    {job.imageId != null && (
                                        <Link
                                            component="button"
                                            color="inherit"
                                            underline="always"
                                            sx={{
                                                fontWeight: "bold",
                                                verticalAlign: "baseline",
                                                cursor: "pointer",
                                                color: "#42a5f5",
                                                pl: "10px",
                                            }}
                                            onClick={async () => {
                                                // Categories may not have refreshed yet; reload and search fresh data
                                                let found = false;
                                                try {
                                                    const freshTree = (
                                                        await fetchCategoryTree()
                                                    ).map(apiTreeToCategory);
                                                    setCategories(freshTree);
                                                    const result =
                                                        findImageInTree(
                                                            freshTree,
                                                            job.imageId!,
                                                        );
                                                    if (result) {
                                                        setPage("browse");
                                                        setPath(result.path);
                                                        setSelectedImage(
                                                            result.image,
                                                        );
                                                        setViewportState(
                                                            undefined,
                                                        );
                                                        setOverlays([]);
                                                        pushNavState(
                                                            "browse",
                                                            result.path.map(
                                                                (c) => c.id,
                                                            ),
                                                            result.image.id,
                                                        );
                                                        found = true;
                                                    }
                                                } catch {
                                                    // Fall through to uncategorized check
                                                }
                                                if (!found) {
                                                    try {
                                                        const freshUncat = (
                                                            await fetchUncategorizedImages()
                                                        ).map((img) => ({
                                                            id: img.id,
                                                            name: img.name,
                                                            thumb: img.thumb,
                                                            tileSources:
                                                                img.tile_sources,
                                                            categoryId:
                                                                img.category_id,
                                                            copyright:
                                                                img.copyright,
                                                            note: img.note,
                                                            active: img.active,
                                                            version:
                                                                img.version,
                                                            createdAt:
                                                                img.created_at,
                                                            updatedAt:
                                                                img.updated_at,
                                                            metadataExtra:
                                                                img.metadata_extra,
                                                            width: img.width,
                                                            height: img.height,
                                                            fileSize:
                                                                img.file_size,
                                                        }));
                                                        setUncategorizedImages(
                                                            freshUncat,
                                                        );
                                                        const uncatImg =
                                                            freshUncat.find(
                                                                (img) =>
                                                                    img.id ===
                                                                    job.imageId,
                                                            );
                                                        if (uncatImg) {
                                                            setPage("browse");
                                                            setPath([]);
                                                            setSelectedImage(
                                                                uncatImg,
                                                            );
                                                            setViewportState(
                                                                undefined,
                                                            );
                                                            setOverlays([]);
                                                            pushNavState(
                                                                "browse",
                                                                [],
                                                                uncatImg.id,
                                                            );
                                                            found = true;
                                                        }
                                                    } catch {
                                                        // Image not found
                                                    }
                                                }
                                                if (found) {
                                                    setProcessingJobs((prev) =>
                                                        prev.filter(
                                                            (j) =>
                                                                j.id !== job.id,
                                                        ),
                                                    );
                                                }
                                            }}
                                        >
                                            View image
                                        </Link>
                                    )}
                                </>
                            )}
                            {job.status === "failed" &&
                                (job.errorMessage ||
                                    (job.kind === "bulk-import"
                                        ? `"${job.filename}" import failed.`
                                        : `"${job.filename}" processing failed.`))}
                        </Alert>
                    </Snackbar>
                );
            })}
        </Box>
    );
}

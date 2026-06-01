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
    MeasurementConfig,
    OverlayRect,
} from "./components/imageViewerUtils";
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
import { findImageInTree, findCategoryPath, resolveCategoryPath } from "./treeUtils";
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
    userMessage,
} from "./api";
import type {
    ApiCategoryTree,
    ApiImage,
    ApiUser,
} from "./api";
import MoveCategoryDialog from "./components/MoveCategoryDialog";
import { useProcessingJobs } from "./useProcessingJobs";
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
import { useShareableImageState } from "./useShareableImageState";
import { useCanvasAnnotations } from "./useCanvasAnnotations";

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

    const [errorSnack, setErrorSnack] = useState<string | null>(null);
    const [warnSnack, setWarnSnack] = useState<string | null>(null);
    const [moveSnack, setMoveSnack] = useState<{
        message: string;
        onUndo: () => void;
    } | null>(null);
    const uncategorizedLoaded = useRef(false);

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

    // Image processing jobs (extracted to useProcessingJobs hook)
    //
    // loadCategories, loadUncategorizedImages and setImagesVersion are defined
    // later in this component (after their own useState/useCallback calls).
    // Stable ref-forwarding callbacks avoid both the TDZ and the per-render
    // allocation that plain arrow wrappers would cause.
    const loadCategoriesRef = useRef<() => Promise<void>>(() => Promise.resolve());
    const loadUncategorizedImagesRef = useRef<() => Promise<void>>(() => Promise.resolve());
    const setImagesVersionRef = useRef<React.Dispatch<React.SetStateAction<number>>>(() => {});
    const stableLoadCategories = useCallback(() => loadCategoriesRef.current(), []);
    const stableLoadUncategorizedImages = useCallback(() => loadUncategorizedImagesRef.current(), []);
    const stableSetImagesVersion = useCallback<React.Dispatch<React.SetStateAction<number>>>(
        (v) => setImagesVersionRef.current(v), [],
    );
    const processingJobsHook = useProcessingJobs({
        fetchSourceImage,
        fetchBulkImportJob,
        fetchImage: apiFetchImage,
        loadCategories: stableLoadCategories,
        loadUncategorizedImages: stableLoadUncategorizedImages,
        selectedImageRef,
        setSelectedImage,
        setImagesVersion: stableSetImagesVersion,
    });
    const {
        getDisplayProgress,
        getStatusMessage,
        getUploadProgress,
        getVisibleJobs,
        getReplaceUploadProgress,
        addProcessingJob,
        handleUploadStarted,
        handleUploadProgress,
        handleUploadFailed,
        handleProcessingStarted,
        handleBulkImportStarted,
        dismissJob,
        startReplaceUpload,
        trackReplaceProgress,
        transitionReplaceToProcessing,
        failReplaceUpload,
        removeReplaceUpload,
        cancelReplace,
        resetAll: resetProcessingJobs,
    } = processingJobsHook;

    // Shareable-URL state (extracted to useShareableImageState hook)
    const {
        setViewportState,
        setOverlays,
        lockEngaged,
        setLockEngaged,
        snackOpen,
        setSnackOpen,
        initialViewport,
        initialOverlays,
        handleViewportChange,
        handleOverlaysChange,
        copyShareLink,
        clearImage,
        clearPending,
    } = useShareableImageState({
        selectedImage,
        categories,
        categoriesLoading,
        uncategorizedImages,
        uncategorizedLoaded,
        page,
        path,
        setPath,
        setSelectedImage,
    });

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

    const visibleJobs = getVisibleJobs({
        uploadOpen,
        manageUploadOpen,
        imageEditOpen,
        browseEditImage,
    });

    // User profile popover + edit modal state
    const avatarRef = useRef<HTMLButtonElement>(null);
    const [profileOpen, setProfileOpen] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [programs, setPrograms] = useState<Program[]>([]);
    const [imagesVersion, setImagesVersion] = useState(0);
    setImagesVersionRef.current = setImagesVersion;

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
        [setViewportState, setOverlays],
    );

    const { pushNavState } = useNavigationHistory(handlePopState);

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

    // Reset navigation state when user identity changes (login/logout/switch).
    // Track previous user so we only clear pending shared-link refs on actual
    // user switches (logout or account change), not on the initial null→user
    // auth transition which must preserve URL-parsed pending state.
    const prevUserRef = useRef(currentUser);
    useEffect(() => {
        const prevUser = prevUserRef.current;
        prevUserRef.current = currentUser;
        setPage("browse");
        setPath([]);
        setSelectedImage(null);
        setViewportState(undefined);
        setOverlays([]);
        if (prevUser != null && prevUser !== currentUser) {
            clearPending();
        }
        setProfileOpen(false);
        setEditModalOpen(false);
        setImageEditOpen(false);
        setBrowseEditImage(null);
        setSearchOpen(false);
        setSearchUsers([]);
        resetProcessingJobs();
        window.history.replaceState(
            buildNavHistoryState("browse", [], null),
            "",
            window.location.pathname,
        );
    }, [currentUser, resetProcessingJobs, setViewportState, setOverlays, clearPending]);

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
    loadCategoriesRef.current = loadCategories;

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
    loadUncategorizedImagesRef.current = loadUncategorizedImages;

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

    // Canvas annotations (extracted to useCanvasAnnotations hook)
    const {
        localCanvasAnnotations,
        canvasAnnotations,
        handleCanvasAnnotationsChange,
        flushCanvasAnnotations,
        latestVersionRef,
        latestMetadataRef,
    } = useCanvasAnnotations({
        selectedImage,
        loadCategories,
        loadUncategorizedImages,
        setErrorSnack,
    });

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
            latestVersionRef,
            latestMetadataRef,
            loadCategories,
            loadUncategorizedImages,
            setLockEngaged,
        ],
    );

    // Unlock: only disengage the lock UI (re-enable clear button).
    // Does NOT remove persisted overlays from metadata.
    const handleUnlockOverlays = useCallback(() => {
        setLockEngaged(false);
    }, [setLockEngaged]);

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
        latestVersionRef,
        latestMetadataRef,
        loadCategories,
        loadUncategorizedImages,
    ]);

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
                const prevCategoryId = img.categoryId ?? null;
                const updated = await apiUpdateImage(
                    imageId,
                    { category_id: categoryId },
                    img.version,
                );
                await loadCategories();
                loadUncategorizedImages();
                const targetName =
                    findCategoryPath(categories, categoryId)?.at(-1)
                        ?.label ?? "category";
                setMoveSnack({
                    message: `Moved \u201c${img.name}\u201d to \u201c${targetName}\u201d`,
                    onUndo: async () => {
                        try {
                            setMoveSnack(null);
                            await apiUpdateImage(
                                imageId,
                                { category_id: prevCategoryId },
                                updated.version,
                            );
                            await loadCategories();
                            loadUncategorizedImages();
                        } catch (undoErr) {
                            setErrorSnack(
                                userMessage(
                                    undoErr,
                                    "Failed to undo move.",
                                ),
                            );
                        }
                    },
                });
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
                const draggedPath = findCategoryPath(
                    categories,
                    draggedCategoryId,
                );
                const prevParentId =
                    draggedPath && draggedPath.length >= 2
                        ? draggedPath[draggedPath.length - 2].id
                        : null;
                await apiUpdateCategory(draggedCategoryId, {
                    parent_id: targetCategoryId,
                });
                await loadCategories();
                const draggedName =
                    draggedPath?.at(-1)?.label ?? "category";
                const targetName =
                    findCategoryPath(categories, targetCategoryId)
                        ?.at(-1)?.label ?? "category";
                setMoveSnack({
                    message: `Moved \u201c${draggedName}\u201d into \u201c${targetName}\u201d`,
                    onUndo: async () => {
                        try {
                            setMoveSnack(null);
                            await apiUpdateCategory(draggedCategoryId, {
                                parent_id: prevParentId,
                            });
                            await loadCategories();
                        } catch (undoErr) {
                            setErrorSnack(
                                userMessage(
                                    undoErr,
                                    "Failed to undo move.",
                                ),
                            );
                        }
                    },
                });
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
        [categories, loadCategories],
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

    const handleReplaceViewerImage = useCallback(
        async ({ file, formData }: ReplaceImageData) => {
            if (!selectedImage) return;

            const prevImage = selectedImage;

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

            const { uploadId, abort } = startReplaceUpload(file, "viewer");

            apiReplaceImage(
                selectedImage.id,
                file,
                (fraction) => {
                    trackReplaceProgress(uploadId, fraction);
                },
                abort.signal,
                formData,
            )
                .then((result) => {
                    transitionReplaceToProcessing(uploadId, result.id);
                    setImageEditOpen(false);
                    loadCategories();
                    loadUncategorizedImages();
                })
                .catch((err) => {
                    if (err instanceof DOMException && err.name === "AbortError") {
                        removeReplaceUpload(uploadId);
                        setSelectedImage((prev) => prev?.id === prevImage.id ? prevImage : prev);
                        setImageEditOpen(false);
                        return;
                    }
                    setSelectedImage((prev) => prev?.id === prevImage.id ? prevImage : prev);
                    failReplaceUpload(uploadId, userMessage(err, "Failed to upload replacement image"));
                    setImageEditOpen(false);
                });
        },
        [selectedImage, loadCategories, loadUncategorizedImages, startReplaceUpload, trackReplaceProgress, transitionReplaceToProcessing, removeReplaceUpload, failReplaceUpload],
    );

    const handleReplaceBrowseImage = useCallback(
        async ({ file, formData }: ReplaceImageData) => {
            if (!browseEditImage) return;

            const { uploadId, abort } = startReplaceUpload(file, "browse");

            apiReplaceImage(
                browseEditImage.id,
                file,
                (fraction) => {
                    trackReplaceProgress(uploadId, fraction);
                },
                abort.signal,
                formData,
            )
                .then((result) => {
                    transitionReplaceToProcessing(uploadId, result.id);
                    setBrowseEditImage(null);
                    loadCategories();
                    loadUncategorizedImages();
                })
                .catch((err) => {
                    if (err instanceof DOMException && err.name === "AbortError") {
                        removeReplaceUpload(uploadId);
                        setBrowseEditImage(null);
                        return;
                    }
                    failReplaceUpload(uploadId, userMessage(err, "Failed to upload replacement image"));
                    setBrowseEditImage(null);
                });
        },
        [browseEditImage, loadCategories, loadUncategorizedImages, startReplaceUpload, trackReplaceProgress, transitionReplaceToProcessing, removeReplaceUpload, failReplaceUpload],
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

    const viewerReplaceUploadProgress = getReplaceUploadProgress("viewer");
    const browseReplaceUploadProgress = getReplaceUploadProgress("browse");

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
                    <Link
                        href="https://github.com/bcit-tlu/hriv"
                        target="_blank"
                        rel="noopener noreferrer"
                        color="text.secondary"
                        underline="hover"
                    >
                        High Resolution Image Viewer
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
                onCancelReplace={cancelReplace}
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
                onCancelReplace={cancelReplace}
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

            {/* Move-undo snackbar */}
            <Snackbar
                open={moveSnack !== null}
                autoHideDuration={8000}
                onClose={(_event, reason) => {
                    if (reason === "clickaway") return;
                    setMoveSnack(null);
                }}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
                sx={{ zIndex: 1500 }}
            >
                <Alert
                    severity="success"
                    onClose={() => setMoveSnack(null)}
                    variant="filled"
                    action={
                        <Button
                            color="inherit"
                            size="small"
                            onClick={moveSnack?.onUndo}
                            aria-label="Undo move"
                        >
                            Undo
                        </Button>
                    }
                >
                    {moveSnack?.message}
                </Alert>
            </Snackbar>

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
                    job.status === "uploading" && job.uploadId != null
                        ? (getUploadProgress(job.uploadId) ||
                          (job.uploadProgress ?? 0))
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
                            dismissJob(job.id);
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
                            onClose={() => dismissJob(job.id)}
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
                                                    dismissJob(job.id);
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

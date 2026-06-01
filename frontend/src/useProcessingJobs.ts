import { useState, useCallback, useEffect, useRef } from "react";
import type { ApiBulkImportJob } from "./api";
import { pollProcessingJob, type PollHandle } from "./pollProcessingJob";
import type { ImageItem } from "./types";

/** Maximum number of concurrent upload/processing/import jobs. */
export const MAX_PROCESSING_JOBS = 5;

export interface ProcessingJob {
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

export interface UseProcessingJobsDeps {
    fetchSourceImage: (id: number) => Promise<{
        status: string;
        progress: number;
        status_message?: string | null;
        error_message?: string | null;
        image_id?: number | null;
    }>;
    fetchBulkImportJob: (jobId: number) => Promise<ApiBulkImportJob>;
    fetchImage: (imageId: number) => Promise<{
        id: number;
        name: string;
        thumb: string;
        tile_sources: string;
        category_id: number | null;
        copyright: string | null;
        note: string | null;
        active: boolean;
        version: number;
        created_at: string;
        updated_at: string;
        metadata_extra: Record<string, unknown> | null;
        width: number | null;
        height: number | null;
        file_size: number | null;
    }>;
    loadCategories: () => Promise<void>;
    loadUncategorizedImages: () => Promise<void>;
    selectedImageRef: React.RefObject<ImageItem | null>;
    setSelectedImage: (img: ImageItem) => void;
    setImagesVersion: React.Dispatch<React.SetStateAction<number>>;
}

export interface VisibleJobsFilter {
    uploadOpen: boolean;
    manageUploadOpen: boolean;
    imageEditOpen: boolean;
    browseEditImage: unknown | null;
}

export function useProcessingJobs(deps: UseProcessingJobsDeps) {
    const {
        fetchSourceImage,
        fetchBulkImportJob,
        fetchImage,
        loadCategories,
        loadUncategorizedImages,
        selectedImageRef,
        setSelectedImage,
        setImagesVersion,
    } = deps;

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

    /** Get the upload progress fraction for a given upload ID. */
    const getUploadProgress = useCallback((uploadId: number): number => {
        return uploadProgressRef.current.get(uploadId) ?? 0;
    }, []);

    /**
     * Compute filtered jobs for snackbar display.
     * Hides uploading/failed jobs while the modal that owns them is open.
     */
    const getVisibleJobs = useCallback(
        (filter: VisibleJobsFilter): ProcessingJob[] => {
            return processingJobs.filter((j) => {
                if (
                    !(j.status === "uploading" || j.status === "failed") ||
                    j.uploadId == null
                )
                    return true;
                const isReplaceJob = j.uploadId < 1_000_000_000;
                if (isReplaceJob)
                    return !(filter.imageEditOpen || filter.browseEditImage != null);
                return !(filter.uploadOpen || filter.manageUploadOpen);
            });
        },
        [processingJobs],
    );

    /**
     * Get per-modal replacement upload progress.
     * Each modal only sees progress for its own replacement operation.
     */
    const getReplaceUploadProgress = useCallback(
        (context: "viewer" | "browse"): number | undefined => {
            const activeReplace = activeReplaceUploadIdRef.current;
            if (activeReplace?.context !== context) return undefined;
            return uploadProgressRef.current.get(activeReplace.uploadId) ?? 0;
        },
        [],
    );

    // Start polling for each new processing job.
    useEffect(() => {
        const refs = processingPollRefs.current;

        for (const job of processingJobs) {
            if (job.status !== "processing") continue;
            if (refs.has(job.id)) continue;

            const handle = pollProcessingJob(job.id, {
                fetchStatus: fetchSourceImage,
                onCompleted: async (imageId) => {
                    await Promise.all([
                        loadCategories(),
                        loadUncategorizedImages(),
                    ]);
                    setImagesVersion((v) => v + 1);
                    const current = selectedImageRef.current;
                    if (imageId != null && current && current.id === imageId) {
                        try {
                            const fresh = await fetchImage(imageId);
                            setSelectedImage({
                                id: fresh.id,
                                name: fresh.name,
                                thumb: fresh.thumb,
                                tileSources: fresh.tile_sources,
                                categoryId: fresh.category_id,
                                copyright: fresh.copyright,
                                note: fresh.note,
                                active: fresh.active,
                                sortOrder: fresh.sort_order,
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
    }, [processingJobs]); // eslint-disable-line react-hooks/exhaustive-deps

    // Bulk import polling
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
    }, [processingJobs]); // eslint-disable-line react-hooks/exhaustive-deps

    // Unmount-only cleanup for both polling ref maps.
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

    /** Dismiss a job from the processing list. */
    const dismissJob = useCallback((jobId: number) => {
        setProcessingJobs((prev) => prev.filter((j) => j.id !== jobId));
    }, []);

    /**
     * Start a replacement upload job. Returns the uploadId and an
     * AbortController so the caller can wire up API calls.
     */
    const startReplaceUpload = useCallback(
        (
            file: File,
            context: "viewer" | "browse",
        ): { uploadId: number; abort: AbortController } => {
            const uploadId = nextReplaceUploadIdRef.current++;
            activeReplaceUploadIdRef.current = { uploadId, context };
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
            const abort = new AbortController();
            replaceAbortRef.current = abort;
            return { uploadId, abort };
        },
        [],
    );

    /** Record upload progress for a replacement upload. */
    const trackReplaceProgress = useCallback(
        (uploadId: number, fraction: number) => {
            uploadProgressRef.current.set(uploadId, fraction);
        },
        [],
    );

    /** Transition a replacement upload to the processing phase. */
    const transitionReplaceToProcessing = useCallback(
        (uploadId: number, sourceImageId: number) => {
            replaceAbortRef.current = null;
            uploadProgressRef.current.delete(uploadId);
            activeReplaceUploadIdRef.current = null;
            setProcessingJobs((prev) =>
                prev.map((j) =>
                    j.uploadId === uploadId
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
                ),
            );
        },
        [],
    );

    /** Mark a replacement upload as failed. */
    const failReplaceUpload = useCallback(
        (uploadId: number, errorMessage: string) => {
            replaceAbortRef.current = null;
            uploadProgressRef.current.delete(uploadId);
            activeReplaceUploadIdRef.current = null;
            setProcessingJobs((prev) =>
                prev.map((j) =>
                    j.uploadId === uploadId
                        ? {
                              ...j,
                              status: "failed" as const,
                              errorMessage,
                              uploadId: undefined,
                          }
                        : j,
                ),
            );
        },
        [],
    );

    /** Remove a replacement upload (e.g. on abort). */
    const removeReplaceUpload = useCallback((uploadId: number) => {
        replaceAbortRef.current = null;
        uploadProgressRef.current.delete(uploadId);
        activeReplaceUploadIdRef.current = null;
        setProcessingJobs((prev) =>
            prev.filter((j) => j.uploadId !== uploadId),
        );
    }, []);

    /** Abort the active replace-image upload. */
    const cancelReplace = useCallback(() => {
        replaceAbortRef.current?.abort();
    }, []);

    /** Reset all processing state (e.g. on user change). */
    const resetAll = useCallback(() => {
        processingPollRefs.current.forEach((handle) => handle.cancel());
        processingPollRefs.current.clear();
        bulkImportPollRefs.current.forEach((interval) => clearInterval(interval));
        bulkImportPollRefs.current.clear();
        serverProgressRef.current.clear();
        uploadProgressRef.current.clear();
        serverStatusMessageRef.current.clear();
        replaceAbortRef.current?.abort();
        replaceAbortRef.current = null;
        activeReplaceUploadIdRef.current = null;
        setProcessingJobs([]);
    }, []);

    return {
        processingJobs,
        getDisplayProgress,
        getStatusMessage,
        getUploadProgress,
        getVisibleJobs,
        getReplaceUploadProgress,
        addProcessingJob,
        updateBulkImportJob,
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
        resetAll,
    };
}

"""Shared task timing constants."""

import os

WORKER_JOB_TIMEOUT_SECONDS = 7200
SOURCE_IMAGE_PENDING_WAIT_SAFETY_CAP_SECONDS = max(
    WORKER_JOB_TIMEOUT_SECONDS // 2,
    1,
)
BULK_IMPORT_COORDINATOR_LIVENESS_KEY = "hriv:bulk_import:coordinators"
BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS = 90

# Raw request-body cap for the bulk-import endpoint, shared by the ASGI
# middleware that enforces it while the body streams (#1432) and the
# endpoint's per-part read loops, which apply it to each uploaded part.
# The default matches BULK_IMPORT_MAX_TOTAL_BYTES: a compliant archive's
# compressed size never legitimately exceeds its decompressed content by
# a meaningful margin.
BULK_IMPORT_MAX_UPLOAD_BYTES = int(
    os.environ.get("BULK_IMPORT_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024 * 1024))
)

# Whole-request ceiling for one bulk-import multipart body (#1432). The
# endpoint accepts a *list* of parts — each individually capped at
# BULK_IMPORT_MAX_UPLOAD_BYTES — so a batch of valid files is legitimately
# larger than the per-part cap. This bound exists to cap the pod-local
# temp spool that python-multipart fills before the endpoint runs; it is
# deliberately generous (the per-part cap plus the zip budgets do the
# semantic enforcement) and can be lowered toward real batch sizes.
BULK_IMPORT_MAX_REQUEST_BYTES = int(
    os.environ.get(
        "BULK_IMPORT_MAX_REQUEST_BYTES", str(4 * BULK_IMPORT_MAX_UPLOAD_BYTES)
    )
)

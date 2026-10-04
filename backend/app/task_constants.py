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

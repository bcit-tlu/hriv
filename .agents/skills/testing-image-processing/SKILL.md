---
name: testing-image-processing
description: Guide for testing the HRIV image processing pipeline including arq worker, OTEL tracing, and graceful degradation.
---

# Testing HRIV Image Processing Pipeline

## Overview
The HRIV backend processes uploaded images into DZI tiles via pyvips. Processing runs in an arq worker (Redis-backed) or falls back to in-process BackgroundTasks.

## Devin Secrets Needed
None required for local testing. Default credentials: `admin@bcit.ca` / `password`.

## Local Environment Setup

```bash
cd /home/ubuntu/repos/hriv
docker compose up -d
# Wait for all containers to be healthy:
docker compose ps
# Verify: backend (localhost:8000), frontend (localhost:5173), db, redis, worker
```

## Creating Test Images

pyvips is extremely fast. For progress tracking to be observable (1.5s flush interval), images need to take >1.5s to process.

| Dimensions | File Size | Processing Time | Progress Observable? |
|-----------|-----------|----------------|---------------------|
| 2000x2000 | ~11 MB | ~0.14s | No |
| 4096x4096 | ~48 MB | ~0.55s | No |
| 8000x8000 | ~183 MB | ~0.74s | No |
| 20000x20000 | ~1.14 GB | ~4.8s | Yes |

Create test images with random noise (incompressible data that forces real work):

```python
from PIL import Image
import os

width, height = 20000, 20000  # Adjust for desired processing time
data = os.urandom(width * height * 3)
img = Image.frombytes('RGB', (width, height), data)
img.save('/tmp/test_image.tiff', compression='none')
```

Do NOT use synthetic zeros or constant-value images — pyvips compresses them trivially and processes them almost instantly regardless of size.

## Testing via API (Recommended for Backend Verification)

```python
import requests, time, threading

BASE = "http://localhost:8000"
resp = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@bcit.ca", "password": "password"})
token = resp.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# Upload
with open("/tmp/test_image.tiff", "rb") as f:
    r = requests.post(f"{BASE}/api/source-images/upload", headers=headers,
                      files={"file": ("test.tiff", f, "image/tiff")}, data={"name": "Test"})
source_id = r.json()["id"]

# Poll for progress
while True:
    r = requests.get(f"{BASE}/api/source-images/{source_id}", headers=headers)
    d = r.json()
    print(f"progress={d['progress']} status={d['status']} msg={d.get('status_message','')}")
    if d["status"] in ("completed", "failed"): break
    time.sleep(0.3)
```

For concurrent upload + polling (needed for large files), use threading to upload in one thread while polling in another.

## Testing via Browser

- Playwright CDP (`http://localhost:29229`) can inject files into the upload modal's hidden `input[type="file"]` via `set_input_files()`
- **Limitation**: Playwright CDP has a 50MB file transfer limit. For larger files, the upload must go through the API.
- The frontend polls every 3 seconds, so the snackbar progress display is only visible if processing takes >3s
- The snackbar appears at the bottom of the page after the upload modal closes

## Verifying OTEL Distributed Tracing

To verify trace context propagation from API to arq worker:

1. **Enable console exporter** — create `docker-compose.override.yml`:
   ```yaml
   services:
     backend:
       environment:
         - OTEL_TRACES_EXPORTER=console
         - OTEL_SERVICE_NAME=hriv-backend
     worker:
       environment:
         - OTEL_TRACES_EXPORTER=console
         - OTEL_SERVICE_NAME=hriv-worker
   ```

2. **Rebuild and restart:**
   ```bash
   docker compose up -d --build backend worker
   ```

3. **Upload an image**, then check logs:
   ```bash
   # Find the backend upload span trace_id
   docker compose logs backend | grep '"name": "POST /api/source-images/upload"' -A5
   # Find the worker task span — should have same trace_id
   docker compose logs worker | grep '"name": "process_source_image_task"' -A10
   ```

4. **Verify linkage:** The worker span's `parent_id` should match the backend span's `span_id`, and both should share the same `trace_id`.

5. **Delete the override when done** — do not commit it.

### Key spans in the processing pipeline

| Span name | Container | Attributes |
|-----------|-----------|------------|
| `POST /api/source-images/upload` | backend | Auto-instrumented by FastAPI |
| `process_source_image_task` | worker | `source_image.id`, `tiles.duration_ms` |
| `generate_tiles` | worker | `image.width`, `image.height`, `image.bands`, `tiles.estimated_count`, `tiles.dzsave_duration_ms` |
| `save_image_record` | worker | Child of `process_source_image_task` |

### OTEL bootstrap and uvicorn --reload

`app/otel_bootstrap.py` ensures the OTEL SDK is configured in uvicorn's `--reload` child process. Without it, `inject(carrier)` produces an empty dict because the child inherits env vars but not the SDK state from `opentelemetry-instrument`. The module detects `ProxyTracerProvider` and re-runs `initialize()`. In production (`--workers 1`, no `--reload`), it's a no-op.

## Testing Graceful Degradation

### Redis down — BackgroundTasks fallback

```bash
docker compose stop redis
# Upload an image — should succeed, processed in backend container
docker compose logs backend | grep 'worker.enqueue_failed\|processing.started'
# Restart redis
docker compose start redis
```

Verify: `worker.enqueue_failed` event in backend logs, followed by `processing.started` in backend (not worker). Image completes successfully.

### Redis down — rate limiting

```bash
docker compose stop redis
curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bcit.ca","password":"password"}'
# Should succeed with 200; backend logs show rate_limit.redis_unavailable warning
docker compose start redis
```

## Known Issues

1. **Worker logging gap**: `setup_logging()` is only called in `main.py` (FastAPI lifespan), not by the arq worker. Structured INFO-level log events are generated but silently swallowed. To verify logging works, exec into the worker container and call `setup_logging()` manually before running processing functions.

2. **Progress flush interval**: The 1.5s flush interval means intermediate progress values are only written to the DB for images that take >1.5s to process. For typical test images (<200MB), processing completes before any flush occurs.

## Verifying Eval Signals Directly

To verify pyvips eval signals work without the flush timing constraint:

```bash
docker compose exec worker python3 -c "
from app.logging_config import setup_logging
setup_logging()
from app.processing import generate_tiles, ProgressTracker
import os, time, threading

tracker = ProgressTracker()
progress_log = []
stop = threading.Event()
def monitor():
    prev = -1
    while not stop.is_set():
        p, m = tracker.get()
        if p != prev:
            progress_log.append((time.time(), p, m))
            prev = p
        time.sleep(0.05)
t = threading.Thread(target=monitor)
t.start()
result = generate_tiles('/data/source_images/SOMEFILE.tiff', '/tmp/test_tiles', tracker)
stop.set()
t.join()
for ts, p, m in progress_log:
    print(f'progress={p} message=\"{m}\"')
"
```

## Expected Status Message Transitions

1. "Preparing image" (5%)
2. "Generating tiles" (10-78%)
3. "Creating thumbnail" (80%)
4. "Tiles generated" (80%)
5. "Saving image record" (90%)
6. "Associating programs" (93%, if programs specified)
7. "Completed" (100%)
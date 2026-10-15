## Testing Admin Export/Import

### Filesystem Export UI Flow

1. Admin tab → Filesystem section → **EXPORT**.
2. Task appears in "Recent Tasks" at the bottom.
3. Click the info (i) icon to open the log dialog (status badge, determinate
   progress bar, streaming logs, CANCEL/CLOSE).
4. Completed tasks show a download (↓) icon in the task row. Clicking it
   POSTs for a short-lived `HttpOnly` download cookie and then navigates to
   `/api/admin/tasks/{id}/download` — the credential never appears in the
   URL, so copying the download link does not copy any credential (a second
   navigation without the cookie 401s).

### Seeding Test Data for Export Testing

Default seed data is too small to exercise cancellation. Generate ~1 GB of
incompressible data inside the backend container:

```bash
docker exec hriv-backend-1 python3 -c "
import os, random
for d in range(20):
    path = f'/data/tiles/large_test/dir_{d}'
    os.makedirs(path, exist_ok=True)
    for f in range(500):
        with open(f'{path}/file_{f}.bin', 'wb') as fh:
            fh.write(random.randbytes(102400))
"
```

### Verifying Archive Contents

Archives are stored at `/data/admin_tasks/` inside the backend container:

```bash
docker exec hriv-backend-1 find /data/admin_tasks -name "*.tar.gz" -type f
docker exec hriv-backend-1 tar -tzf /data/admin_tasks/<filename>.tar.gz | head -20
# admin_tasks/ must be excluded from archives (no re-archiving of past exports):
docker exec hriv-backend-1 tar -tzf /data/admin_tasks/<filename>.tar.gz | grep admin_tasks
# (should return nothing)
```

### Backend Implementation Notes

- Archiving runs on `asyncio.to_thread`; a concurrent coroutine polls cancellation every 2s.
- Cancellation bridges async/sync via `threading.Event`.
- Log entries buffer in `queue.Queue` and flush every 2s.
- The frontend polls task status every 2s, so UI state may lag the backend slightly.

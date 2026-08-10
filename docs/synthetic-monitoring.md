# Synthetic Monitoring

HRIV ships a Playwright-based synthetic journey that continuously exercises the
critical "student can log in, browse, and view a deep-zoom image" path from the
outside, the same way a real user would. It is the fastest signal that the full
stack — auth, API, deep-zoom tile pipeline, and frontend — is healthy end to
end, independent of internal metrics.

The journey now also publishes an **authoritative latest-result snapshot** to
the backend at `POST /api/telemetry/synthetic-result`. The backend persists the
latest result in Redis and exposes durable gauges through `/api/metrics`, so
Prometheus can query the most recent run outcome without inferring health from
retained Kubernetes Job objects.

- **Source:** `synthetic-monitoring/`
- **Journey:** `synthetic-monitoring/tests/student-journey.spec.ts`
- **Image:** `ghcr.io/bcit-tlu/hriv/hriv-synthetic-monitoring`
- **Released as:** the `synthetic-monitoring` Release Please component (image
  only — no Helm chart).

## What the journey asserts

1. Loads the app in synthetic mode (`/?synthetic=1`) so the frontend tags its
   telemetry as synthetic.
2. Logs in with local credentials.
3. Navigates the configured category path and opens the configured image.
4. Confirms the OpenSeadragon `<canvas>` renders.
5. **Asserts a successful deep-zoom response** by observing the network: it
   waits for a `200` `.dzi` descriptor under `/api/tiles/...` and verifies that
   no tile/descriptor response returned a `4xx`/`5xx`. A visible canvas alone
   is not sufficient — tiles can 404 while the canvas still appears — so this
   network assertion is the authoritative "viewer is genuinely healthy" check.

Each step is wrapped in `test.step(...)` and logs a `[synthetic] …` line, so CI
logs and the Playwright report show a readable, timed breakdown and the session
id used to correlate the run's frontend events in Loki. The runner also records
bounded step durations and submits the result from `finally`, so failed journeys
still attempt to publish their last known state before the Job exits.

## Authoritative result schema

The runner submits the following bounded payload:

```json
{
  "event_version": 1,
  "started_at": "2026-07-13T18:00:00Z",
  "completed_at": "2026-07-13T18:00:03Z",
  "success": true,
  "duration_ms": 3124,
  "failure_code": null,
  "component_version": "1.2.3",
  "steps": [
    { "name": "frontend", "success": true, "duration_ms": 350 },
    { "name": "login", "success": true, "duration_ms": 420 },
    { "name": "category", "success": true, "duration_ms": 300 },
    { "name": "image", "success": true, "duration_ms": 850 },
    { "name": "dzi", "success": true, "duration_ms": 480 },
    { "name": "tile", "success": true, "duration_ms": 310 }
  ]
}
```

Allowed step names are fixed:

- `frontend`
- `login`
- `category`
- `image`
- `dzi`
- `tile`

Allowed failure codes are fixed:

- `frontend_unreachable`
- `login_failed`
- `category_unavailable`
- `image_unavailable`
- `dzi_failed`
- `tile_failed`
- `timeout`
- `result_submission_failed`
- `unexpected_error`

The endpoint only accepts requests from an authenticated user whose
`metadata_.synthetic` flag is `true`. Stale results older than the currently
stored latest run are rejected, so out-of-order Job completions cannot roll the
authoritative gauges backward.

## Configuration

| Variable                      | Default                        | Purpose                                     |
| ----------------------------- | ------------------------------ | ------------------------------------------- |
| `BASE_URL`                    | `http://localhost:5173`        | Target environment base URL                 |
| `SYNTHETIC_EMAIL`             | `synthetic.student@example.ca` | Login email for the monitor account         |
| `SYNTHETIC_PASSWORD`          | `password`                     | Login password for the monitor account      |
| `SYNTHETIC_CATEGORY_PATH`     | `Architecture/Italian`         | Slash-separated category labels to navigate |
| `SYNTHETIC_IMAGE_NAME`        | `Duomo di Milano`              | Exact image name to open                    |
| `SYNTHETIC_COMPONENT_VERSION` | package version                | Version string attached to logs and results |

The monitor account should be a dedicated user whose database `metadata_`
carries `{"synthetic": true}`. The backend uses that flag to mark the account's
telemetry and login events as synthetic server-side, so dashboards and reports
can exclude monitor traffic (see
[`observability-conventions.md`](observability-conventions.md)).

Production environments must use a dedicated, stable category and image rather
than the development seed data. The image must be active, visible to the
monitor account, and uploaded through HRIV so processing produces a
`/api/tiles/...` DZI descriptor and tile set. Category labels in
`SYNTHETIC_CATEGORY_PATH` must not contain `/`.

## Running locally

```bash
cd synthetic-monitoring
npm ci
npx playwright install --with-deps chromium
BASE_URL=http://localhost:5173 \
SYNTHETIC_EMAIL=synthetic.student@example.ca \
SYNTHETIC_PASSWORD=password \
SYNTHETIC_CATEGORY_PATH=Architecture/Italian \
SYNTHETIC_IMAGE_NAME='Duomo di Milano' \
  npm test
```

Or via the published image:

```bash
docker run --rm \
  -e BASE_URL=https://hriv.example.ca \
  -e SYNTHETIC_EMAIL=synthetic.student@example.ca \
  -e SYNTHETIC_PASSWORD='<password>' \
  -e SYNTHETIC_CATEGORY_PATH='Synthetic Monitoring' \
  -e SYNTHETIC_IMAGE_NAME='Synthetic Monitoring Image' \
  ghcr.io/bcit-tlu/hriv/hriv-synthetic-monitoring:latest
```

Type-check the journeys without running them (matches the `synthetic-checks` CI
job): `npm run typecheck`.

## Operator runbook

**A synthetic run failed — what do I do?**

1. Open the failing run's logs / Playwright report and find the last passing
   `[synthetic]` step to localize the failure:
   - **Fails at login** → auth outage or the monitor account's credentials /
     enablement changed. Verify the account exists, is enabled, and the
     `SYNTHETIC_EMAIL`/`SYNTHETIC_PASSWORD` secrets are current.
   - **Fails opening the category or image** → the configured category/image
     is missing, renamed, inactive, or not visible to the monitor account.
     Verify `SYNTHETIC_CATEGORY_PATH`, `SYNTHETIC_IMAGE_NAME`, and the account's
     program/group access.
   - **Fails at "assert a successful DZI/tile response"** → the deep-zoom tile
     pipeline is unhealthy. Check that tiles exist on the tiles volume, the
     backend `/api/tiles/` route and the nginx tile proxy are serving, and that
     image processing completed for the configured image.
2. Cross-reference the logged session id against Loki (`browser.tab.session_id`)
   and traces in Tempo for the same window to see the backend-side error.
3. If the failure is environmental (target down, network), re-run once the
   dependency recovers; the journey is idempotent.
4. If Prometheus shows a stale `hriv_synthetic_result_age_seconds`, the Job may
   have stopped running entirely or the authoritative result submission may no
   longer be reaching the backend.

## Published metrics

The backend exposes these gauges on `/api/metrics` from the latest stored
synthetic result:

- `hriv_synthetic_last_run_timestamp_seconds`
- `hriv_synthetic_last_success_timestamp_seconds`
- `hriv_synthetic_journey_success`
- `hriv_synthetic_journey_duration_seconds`
- `hriv_synthetic_result_age_seconds`
- `hriv_synthetic_step_success{step="frontend|login|category|image|dzi|tile"}`
- `hriv_synthetic_step_duration_seconds{step="frontend|login|category|image|dzi|tile"}`

The gauges never label by account email, image id, category id, URL, or raw
failure message.

**Deployment prerequisites** (out of scope for this repo — configured in
`bcit-tlu/flux-fleet`): a scheduler (e.g. a `CronJob`) to run the image on an
interval, the `BASE_URL` for the target environment, and the monitor account
credentials delivered as a secret. The monitor account itself must be seeded
with `metadata_.synthetic = true` in the target database.

### Creating the synthetic monitor account

The admin UI cannot set `metadata_.synthetic`, so the monitor account must be
created (or flagged) directly in the target database via `psql` — connect to
the `pg-core` cluster (NodePort `31432`, database `hriv`), or `kubectl exec`
into the pg-core primary pod.

1. Generate a bcrypt password hash (same scheme as `backend/app/auth.py`):

   ```bash
   cd backend && poetry run python -c "import bcrypt,getpass; print(bcrypt.hashpw(getpass.getpass('password: ').encode(), bcrypt.gensalt()).decode())"
   ```

2. Create the user with the synthetic flag:

   ```sql
   INSERT INTO users (name, email, password_hash, role, metadata)
   VALUES ('Synthetic Student', 'synthetic.student@example.ca',
           '<bcrypt-hash>', 'student', '{"synthetic": true}'::jsonb);
   ```

3. Assign it to the dedicated program:

   ```sql
   INSERT INTO user_programs (user_id, program_id)
   SELECT u.id, p.id FROM users u, programs p
   WHERE u.email = 'synthetic.student@example.ca'
     AND p.name = 'Synthetic Monitoring';
   ```

If the account already exists and only the flag is missing:

```sql
UPDATE users
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"synthetic": true}'::jsonb
WHERE email = 'synthetic.student@example.ca';
```

Store the credentials in Vault at `apps/data/hriv/<env>/synthetic-monitoring`
so the CronJob secret (see `bcit-tlu/flux-fleet`) picks them up.

### Provisioning the production test target

For each environment:

1. Create a dedicated program such as `Synthetic Monitoring`.
2. Create a stable root category such as `Synthetic Monitoring`, restrict it
   to that program, and keep it active.
3. Upload a small supported source image into that category with a unique,
   stable name such as `Synthetic Monitoring Image`.
4. Wait for processing to complete and verify the image's `tile_sources` uses
   `/api/tiles/`; an external DZI URL does not exercise HRIV's tile pipeline.
5. Assign the synthetic student to the dedicated program and retain
   `metadata_.synthetic = true`.
6. Set `SYNTHETIC_CATEGORY_PATH` to the exact slash-separated category labels
   and `SYNTHETIC_IMAGE_NAME` to the exact image name.
7. Run the journey once manually before enabling or resuming the CronJob.

To rotate the target, provision and validate the replacement image first,
update both configuration values, run a one-off smoke Job, and only then remove
the old image or category.

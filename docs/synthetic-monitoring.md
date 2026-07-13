# Synthetic Monitoring

HRIV ships a Playwright-based synthetic journey that continuously exercises the
critical "student can log in, browse, and view a deep-zoom image" path from the
outside, the same way a real user would. It is the fastest signal that the full
stack — auth, API, deep-zoom tile pipeline, and frontend — is healthy end to
end, independent of internal metrics.

- **Source:** `synthetic-monitoring/`
- **Journey:** `synthetic-monitoring/tests/student-journey.spec.ts`
- **Image:** `ghcr.io/bcit-tlu/hriv/hriv-synthetic-monitoring`
- **Released as:** the `synthetic-monitoring` Release Please component (image
  only — no Helm chart).

## What the journey asserts

1. Loads the app in synthetic mode (`/?synthetic=1`) so the frontend tags its
   telemetry as synthetic.
2. Logs in with local credentials.
3. Reaches the browse page and opens the seeded "Duomo di Milano" image.
4. Confirms the OpenSeadragon `<canvas>` renders.
5. **Asserts a successful deep-zoom response** by observing the network: it
   waits for a `200` `.dzi` descriptor under `/api/tiles/...` and verifies that
   no tile/descriptor response returned a `4xx`/`5xx`. A visible canvas alone
   is not sufficient — tiles can 404 while the canvas still appears — so this
   network assertion is the authoritative "viewer is genuinely healthy" check.

Each step is wrapped in `test.step(...)` and logs a `[synthetic] …` line, so CI
logs and the Playwright report show a readable, timed breakdown and the session
id used to correlate the run's frontend events in Loki.

## Configuration

| Variable             | Default                        | Purpose                                |
| -------------------- | ------------------------------ | -------------------------------------- |
| `BASE_URL`           | `http://localhost:5173`        | Target environment base URL            |
| `SYNTHETIC_EMAIL`    | `synthetic.student@example.ca` | Login email for the monitor account    |
| `SYNTHETIC_PASSWORD` | `password`                     | Login password for the monitor account |

The monitor account should be a dedicated user whose database `metadata_`
carries `{"synthetic": true}`. The backend uses that flag to mark the account's
telemetry and login events as synthetic server-side, so dashboards and reports
can exclude monitor traffic (see
[`observability-conventions.md`](observability-conventions.md)).

## Running locally

```bash
cd synthetic-monitoring
npm ci
npx playwright install --with-deps chromium
BASE_URL=http://localhost:5173 \
SYNTHETIC_EMAIL=synthetic.student@example.ca \
SYNTHETIC_PASSWORD=password \
  npm test
```

Or via the published image:

```bash
docker run --rm \
  -e BASE_URL=https://hriv.example.ca \
  -e SYNTHETIC_EMAIL=synthetic.student@example.ca \
  -e SYNTHETIC_PASSWORD='<password>' \
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
   - **Fails opening the image / canvas not visible** → the seeded image is
     missing or the frontend failed to load; check the frontend deploy and that
     image id `1` ("Duomo di Milano") still exists in the target environment.
   - **Fails at "assert a successful DZI/tile response"** → the deep-zoom tile
     pipeline is unhealthy. Check that tiles exist on the tiles volume, the
     backend `/api/tiles/` route and the nginx tile proxy are serving, and that
     image processing completed for the seeded image.
2. Cross-reference the logged session id against Loki (`browser.tab.session_id`)
   and traces in Tempo for the same window to see the backend-side error.
3. If the failure is environmental (target down, network), re-run once the
   dependency recovers; the journey is idempotent.

**Deployment prerequisites** (out of scope for this repo — configured in
`bcit-tlu/flux-fleet`): a scheduler (e.g. a `CronJob`) to run the image on an
interval, the `BASE_URL` for the target environment, and the monitor account
credentials delivered as a secret. The monitor account itself must be seeded
with `metadata_.synthetic = true` in the target database.

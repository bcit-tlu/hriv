## Browser & Test Environment Tips

- **Chrome CDP:** The provisioned Chrome exposes CDP on `http://localhost:29229`.
  Use it for Playwright scripts (`p.chromium.connect_over_cdp(...)`) when native
  computer-use is awkward (file uploads, flaky timing, snackbars).
- **Chrome binary (if you need to relaunch):** `/opt/.devin/chrome/chrome/linux-*/chrome-linux64/chrome`
  with `--user-data-dir=/home/ubuntu/.browser_data_dir` to keep profile state. The
  `google-chrome` wrapper requires the CDP proxy.
- **Maximize the window before recording** so the full app is captured:
  ```bash
  wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
  ```
  Install `wmctrl` first if needed (`sudo apt-get install -y wmctrl`). Keyboard
  shortcuts like Super+Up only tile to half-screen on some window managers.
- **Seed images use external DZI tiles** (openseadragon.github.io). Dark/black tiles
  on first load usually mean the CDN is still warming — wait a few seconds.
- **Small vs large test images:** a 1024×1024 solid-color JPEG processes in
  milliseconds; anything beyond ~200 MB is needed to observe tile-processing progress.
- **Chrome CDP proxy may not be running:** If `curl -s http://localhost:29229/json/version`
  returns empty, launch Chrome manually with `--remote-debugging-port=9222` and
  connect Playwright to `http://localhost:9222`.
- **Playwright may not be pre-installed.** Install with `pip install playwright && python3 -m playwright install chromium`.
  Use ImageMagick `convert` instead of PIL for generating test images (it's available by default).
- **Redis image rate limits:** If Docker Hub returns a 429 for Redis, use the
  mirror as a fallback:
  ```bash
  docker pull mirror.gcr.io/library/redis:7-alpine
  docker tag mirror.gcr.io/library/redis:7-alpine redis:7-alpine
  ```
  Do not replace the default registry.
- **Standalone Vite with the Compose API:** Set the API URL explicitly:
  ```bash
  VITE_API_URL=http://localhost:8000 npm run dev -- --host
  ```
- **Reusing a live local frontend (bind-mount revision check):** Before
  trusting a running Vite server, inspect which checkout the frontend container
  mounts; Compose can serve a separate worktree. Match the mount's host `Source`
  to the frontend tree, then compare that checkout's revision with the one you
  intend to test:
  ```bash
  docker inspect <frontend-container> --format '{{json .Mounts}}'
  git -C <mounted-worktree-root> rev-parse HEAD
  git -C <intended-checkout> rev-parse HEAD
  ```
- **Compose environment flag changes:** Recreate the backend instead of only
  restarting it:
  ```bash
  FLAG=value docker compose up -d --no-deps --force-recreate backend
  ```
  Restore the original flag values afterward and sign in again through the UI.
- **Reorder fixtures and viewer assertions:** Reorder fixtures may not include
  media. Use a seeded image known to have working DZI data for viewer assertions.
- **Student hidden-category visibility:** Student-owned collections in excluded
  categories remain excluded. Test hidden-category greying with an instructor,
  and inherited visible-category chips with a student; do not construct an
  impossible student state.

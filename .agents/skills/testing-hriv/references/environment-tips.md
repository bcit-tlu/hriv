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

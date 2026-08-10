"""Profile Browse drag-and-drop at fixture scale (issue #981).

Connects to the provisioned Chrome over CDP, logs in to the production
preview build (http://localhost:4173), navigates to a fixture scope, and
performs a scripted pointer drag while sampling:
  - rAF frame rate during the drag
  - long tasks (PerformanceObserver 'longtask')
  - event-timing entries for pointer events
  - mounted tile counts
Prereqs: docker-compose stack up, fixture seeded (see docs/reorder-fixture.md),
production preview on :4173 (`npm run build && npm run preview -- --port 4173`),
Chrome CDP on :29229, `pip install playwright`.
Run: python3 scripts/profile_reorder_drag.py [scope] [steps]
  scope in {flat, gallery, root}; see docs/reorder-performance.md.
"""

import json
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:4173"
SCOPE = sys.argv[1] if len(sys.argv) > 1 else "flat"
STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 120

INSTRUMENT = """
() => {
  window.__prof = { longtasks: [], events: [], frames: 0, rafStart: 0, rafStop: 0, running: false };
  const lt = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__prof.longtasks.push({ start: e.startTime, dur: e.duration });
  });
  lt.observe({ type: 'longtask', buffered: false });
  try {
    const et = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name.startsWith('pointer') || e.name === 'mousemove')
          window.__prof.events.push({ name: e.name, dur: e.duration, delay: e.processingStart - e.startTime });
      }
    });
    et.observe({ type: 'event', durationThreshold: 16, buffered: false });
  } catch (err) { /* event timing unsupported */ }
  const tick = (t) => {
    if (!window.__prof.running) return;
    window.__prof.frames += 1;
    requestAnimationFrame(tick);
  };
  window.__profStart = () => {
    window.__prof.running = true;
    window.__prof.longtasks.length = 0;
    window.__prof.events.length = 0;
    window.__prof.frames = 0;
    window.__prof.markFrames = undefined;
    window.__prof.markTime = undefined;
    window.__prof.rafStart = performance.now();
    requestAnimationFrame(tick);
  };
  // Marks the end of the pointer-movement phase: drag FPS is computed over
  // movement only, while long tasks keep accumulating through drag end so
  // the idle settle tail cannot inflate the FPS figure.
  window.__profMark = () => {
    window.__prof.markFrames = window.__prof.frames;
    window.__prof.markTime = performance.now();
  };
  window.__profStop = () => {
    window.__prof.running = false;
    window.__prof.rafStop = performance.now();
    const p = window.__prof;
    const wall = p.rafStop - p.rafStart;
    const moveWall = (p.markTime ?? p.rafStop) - p.rafStart;
    const moveFrames = p.markFrames ?? p.frames;
    const ltTotal = p.longtasks.reduce((a, b) => a + b.dur, 0);
    const ltMax = p.longtasks.reduce((a, b) => Math.max(a, b.dur), 0);
    return {
      wallMs: Math.round(wall),
      moveMs: Math.round(moveWall),
      frames: p.frames,
      fps: Math.round((moveFrames / moveWall) * 1000),
      longtaskCount: p.longtasks.length,
      longtaskTotalMs: Math.round(ltTotal),
      longtaskMaxMs: Math.round(ltMax),
      slowEvents: p.events.length,
      slowEventMaxMs: Math.round(p.events.reduce((a, b) => Math.max(a, b.dur), 0)),
      longtaskStartsMs: p.longtasks.map((t) => Math.round(t.start - p.rafStart)),
    };
  };
}
"""


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp("http://localhost:29229")
        ctx = browser.contexts[0]
        page = ctx.new_page()
        page.goto(BASE, wait_until="networkidle")

        if page.get_by_placeholder("username@example.ca").count() > 0:
            page.get_by_placeholder("username@example.ca").fill("admin@example.ca")
            page.get_by_placeholder("Password").fill("password")
            page.get_by_role("button", name="Sign in").or_(
                page.get_by_role("button", name="Log in")
            ).or_(page.locator("button[type=submit]")).first.click()
            page.wait_for_load_state("networkidle")

        # Navigate into the requested fixture scope from the Browse root.
        if SCOPE == "flat":
            page.get_by_text("RF-Root-01", exact=True).first.click()
        elif SCOPE == "gallery":
            page.get_by_text("RF-Root-02", exact=True).first.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(3000)

        grid = page.get_by_role("region", name="Sortable tile grid")
        grid.wait_for(state="visible", timeout=30000)

        page.evaluate(INSTRUMENT)

        # Defensive: exclude any non-tile region children (the file drop
        # zone mounts as a region during native file drags; it is absent
        # during scripted pointer drags, so this normally filters nothing).
        tiles = grid.locator(':scope > div:not([role="region"])')
        tile_count = tiles.count()
        if tile_count < 4:
            raise SystemExit(
                f"Grid has only {tile_count} tiles; need at least 4 for a meaningful drag — "
                "seed the reorder fixture first (see docs/reorder-fixture.md)."
            )
        src_idx = min(2, tile_count - 2)
        dst_idx = min(8, tile_count - 1)
        src = tiles.nth(src_idx)
        dst = tiles.nth(dst_idx)
        sb = src.bounding_box()
        db = dst.bounding_box()
        assert sb and db

        page.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
        page.mouse.down()
        page.evaluate("window.__profStart()")
        t0 = time.time()
        # Many small moves to approximate a real drag across the grid.
        x0, y0 = sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2
        x1, y1 = db["x"] + db["width"] * 0.8, db["y"] + db["height"] / 2
        for i in range(1, STEPS + 1):
            f = i / STEPS
            page.mouse.move(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f)
        drag_wall = time.time() - t0
        # End of the movement phase: FPS is computed up to here. Long-task
        # sampling continues through the cancel + pointer release so the
        # drag-end cluster is captured without diluting the FPS figure.
        page.evaluate("window.__profMark()")
        page.keyboard.press("Escape")  # cancel: profiling only, no persistence
        page.mouse.up()
        page.wait_for_timeout(500)
        stats = page.evaluate("window.__profStop()")

        heap = page.evaluate(
            "performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null"
        )
        result = {
            "scope": SCOPE,
            "tileCount": tile_count,
            "moveSteps": STEPS,
            "pythonDragWallMs": round(drag_wall * 1000),
            "usedJSHeapMB": heap,
            **stats,
        }
        print(json.dumps(result, indent=2))
        page.close()


if __name__ == "__main__":
    main()

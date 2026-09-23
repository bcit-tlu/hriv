## OpenSeadragon Viewer Toolbar

Bottom-left of the viewer, left to right:

| #   | Icon           | Function                         |
| --- | -------------- | -------------------------------- |
| 1   | +              | Zoom in                          |
| 2   | –              | Zoom out                         |
| 3   | House          | Home (reset view)                |
| 4   | Arrows         | Fullscreen toggle                |
| 5   | CCW arrow      | Rotate left                      |
| 6   | CW arrow       | Rotate right                     |
| 7   | Diagonal arrow | Selection tool (draw rectangles) |
| 8   | Padlock        | Lock / unlock overlays           |
| 9   | X              | Clear overlays                   |
| 10  | Pencil         | Canvas annotation edit           |

**Warning:** Fullscreen (4) is adjacent to the selection tool (7) and easy to hit
accidentally. Press Escape to exit fullscreen.

When testing viewer stability after metadata edits, watch the URL — `zoom=`, `x=`,
`y=` params should remain unchanged if the viewport was preserved.

## Magnification Badge (Navigator Mini-Map)

The viewer displays a real-time magnification badge (`NX`) in the **bottom-left
corner of the navigator mini-map** (the mini-map itself is in the bottom-right
of the viewer). The badge updates on every zoom animation frame.

### Two display modes

| Condition                           | Display                                         |
| ----------------------------------- | ----------------------------------------------- |
| No measurement settings on image    | Raw image-zoom ratio (e.g. `<1X`, `1X`, `4X`)   |
| Measurement scale + unit configured | Real-world magnification (e.g. `155X`, `2117X`) |

Seed images have no measurement settings by default, so the badge shows `<1X` at
home zoom. To test measurement-aware magnification:

1. Click **Edit Details** on any image.
2. Set **Scale** = `8`, **Unit** = `um` (8 pixels per micrometre).
3. Save → badge immediately shows a high value (e.g. `155X` at home zoom).
4. **Clean up after testing** — clear Scale and Unit fields and save again.

### Expected badge values

- At home zoom without measurement: `<1X` (image is smaller than viewport)
- At home zoom with 8px/µm: ~`155X` (depends on image dimensions and viewport)
- Zooming in increases the value linearly
- Sub-unity magnification displays `<1X` instead of `0X`

### Key implementation details for testing

- Badge uses `pointerEvents: none` — it should never block clicks on the navigator
- Badge is appended to `viewer.navigator.element`, NOT added via `viewer.addControl()`
- Updates on both `animation` and `animation-finish` events (matches `repositionLabels` pattern)
- After page reload with a share-link URL, the badge should show the correct value
  for the restored viewport (not stale `1X`)

## Canvas Annotation Edit Mode

The viewer's pencil icon (toolbar button 10) toggles canvas annotation edit mode,
powered by Fabric.js. Annotations are stored as JSON in `metadata_extra.canvas_annotations`.

### Drawing Tools

| Tool      | Fabric Object    | Notes                                                           |
| --------- | ---------------- | --------------------------------------------------------------- |
| Rectangle | `fabric.Rect`    | Outlined or filled via fill-mode toggle                         |
| Ellipse   | `fabric.Ellipse` | Outlined or filled via fill-mode toggle                         |
| Arrow     | `fabric.Line`    | Has arrowhead style selector (none, standard, triangle, circle) |
| Text      | `fabric.IText`   | Inline editable                                                 |
| Link      | `fabric.IText`   | Like text but serialises a URL; shown as clickable in view mode |

### Dual Rendering Modes

- **Edit mode** renders via Fabric.js canvas objects (vector, interactive).
- **View mode** renders via 2D canvas context using `drawArrowhead()` in `CanvasOverlay.tsx`.

When testing arrowhead appearance, check **both** modes — a bug in `drawArrowhead()`
only affects view mode, while Fabric object styling only affects edit mode.

### Arrowhead Scaling

The view-mode arrowhead scaling formula is:

```
sw = strokeWidth * zoom
headLen = Math.max(24, sw * 12)
arrowLineWidth = Math.max(1, sw)
```

**Key fix history (PR #589):** Standard arrowhead prong stroke was previously
`headLen / 4` = `sw * 3` (3x thicker than line shaft). Fixed to use `lineWidth` = `sw`
so prongs match the shaft thickness.

**Testing procedure:**

1. Open an image, enter edit mode (pencil icon).
2. Draw 4 arrows, each with a different arrowhead style (standard, triangle, circle, plain-line).
3. Exit edit mode to see the view-mode rendering.
4. Zoom to ~2x: verify standard prongs match line thickness (not 3x thicker).
5. Zoom to ~4x: verify proportional scaling, no blowup.
6. Return to home zoom: verify all 4 styles render correctly.

### Line Width Options

`LINE_WIDTHS = [1, 2, 4, 8, 16]` — follows a 2x scaling pattern. The 16px option
ensures annotations remain visible at low zoom levels.

### Multi-Object Operations

- **Select all:** Click one object to focus the Fabric canvas, then Shift+click others
  (Ctrl+A selects HTML page text, not canvas objects).
- **Copy/Paste:** Ctrl+C / Ctrl+V. Pasted objects appear near originals with a small offset.
- **Right-click:** Should NOT start drawing (guarded since Fabric v7 flipped `fireRightClick` default).

### Fabric.js v7 Breaking Changes (PR #589)

- `originX`/`originY` defaults changed from `'left'/'top'` to `'center'/'center'`.
  All 10 fabric constructors explicitly set `originX: 'left', originY: 'top'`.
- `fireRightClick`/`fireMiddleClick` flipped to `true`. Mouse handler guards against
  non-left-button events.
- `fabric.Line` is deprecated in v7 but still functional. Tracked for future migration.

## In-app guide runtime testing

- Enter through Notifications → Documentation as instructor/admin. The guide uses
  `?page=guide&doc=<slug>` inside the React app, retaining its AppBar and footer.
  Check student entry absence and direct-query fallback separately.
- Guide sources and screenshots live in `frontend/guide`. When compose does not
  bind-mount this directory, new files or edits require a frontend image rebuild:
  `docker compose up -d --build --no-deps frontend`. If navigation renders but
  content is blank, inspect `/app/guide` inside the container before diagnosing
  the Markdown renderer.
- Exercise all seven documents, inline links, previous/next, cross-page anchors,
  refresh and browser Back/Forward. Inspect actual URL and visible heading
  together; a document switch alone does not prove history persistence.
- Visually check wrapped bullets, ordered/nested lists, underscore emphasis,
  callouts and the toolbar table. Decode every rendered screenshot as a
  supplementary check, rather than relying only on file existence.
- Await screenshot decoding before asserting anchor placement, especially on a
  cold page. Distinguish existing localhost:4318 telemetry failures from
  guide-asset or renderer errors.

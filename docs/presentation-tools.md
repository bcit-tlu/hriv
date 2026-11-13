# Presentation pointer tools (epic #1876)

Full-screen pointer tools for presenting an image to a room — the motivation
was user testing where students projected the viewer to a class and the OS
cursor was too small for participants in the back to follow.

- [`frontend/src/components/ImageViewer.tsx`](../frontend/src/components/ImageViewer.tsx)
  — wiring: full-page arming, MouseTracker modes, mutual exclusion, cleanup.
- [`frontend/src/components/presentationTools.ts`](../frontend/src/components/presentationTools.ts)
  — pure helpers: fade math, path building, the SVG layer factory.
- `frontend/public/openseadragon-svg-icons/laser_pointer_*`, `ink_*` — themed
  toolbar icons (rest / grouphover / hover / pressed × inactive / active).
- Tests: `frontend/tests/presentationTools.test.ts` (unit) and the
  "presentation tools (#1876)" describe block in
  `frontend/tests/components/ImageViewer.test.tsx` (integration).
- Behaviour contract:
  [`docs/ui-behaviour-spec.md`](ui-behaviour-spec.md#viewer-presentation-pointer-tools-imagerviewertesttsx-presentationtoolstestts).

## Availability

- Every role — presenting is a student activity too, so there is no
  `canEditContent` gate.
- The tools exist **only in OSD full-page mode** (entered via the full-page
  toolbar button or the browser-fullscreen handoff used by the collection
  viewers). Two buttons — **Laser pointer** and **Freehand ink** — appear in
  the bottom-left control dock while `viewer.isFullPage()`; they hide again
  on exit. Entering full-page auto-arms the laser; exiting disarms the tool
  and clears all ink.
- While in full-page the zoom +/- buttons are hidden (user testing found
  them useless in that context); they return in normal view. Mouse
  click-to-zoom is disabled everywhere — scroll, pinch and touch double-tap
  zoom are unchanged (#1877).

## Laser pointer

- A saturated-red dot (4.5px core + 14px glow halo, ~28px total) that follows
  the pointer, with a 450ms fading trail of pooled circles.
- The native cursor is hidden while armed (`cursor: none` on
  `viewer.canvas`), but mouse navigation stays enabled — presenters keep
  panning and zooming while pointing.
- The dot stays hidden until the first pointer move and again whenever the
  pointer leaves the viewer, so no stale dot lingers at (0,0) or the last
  position.

## Freehand ink

- Bright-cyan (`#00E5FF`) strokes, ~4px screen-width, round caps/joins,
  `crosshair` cursor while armed. Mouse navigation is disabled so drags
  draw instead of panning.
- Strokes are stored in **viewport coordinates** and reprojected to pixels
  on every animation/viewport event, so they stay glued to structures across
  pan/zoom (rotation included).
- Each stroke is fully opaque for ~8s, fades linearly to zero at ~10s, and
  is removed. At most ~100 strokes are kept (oldest dropped). A press with
  no drag renders a round-capped dot.
- A `requestAnimationFrame` loop runs only while the trail is alive or a
  stroke is actually fading; opaque strokes schedule a one-shot
  `setTimeout` wake at their fade start instead of spinning 60fps.
- Both colours are theme tokens (`getPresentationColors` in
  `frontend/src/theme.ts`); the overlay re-themes on palette switches.

## Interaction rules

- Laser / ink / selection / canvas-edit are **mutually exclusive**; a single
  `syncMouseNav` arbiter computes `viewer.setMouseNavEnabled` from the
  active modes so one mode's exit can't re-enable navigation while another
  still needs it off.
- A pointer tool never arms over an active canvas-edit session: arming first
  triggers the cancel flow (a dirty draft shows the discard prompt), and
  the tool stays queued behind `pendingPresentationTool` until edit mode
  actually exits — "Keep editing" leaves everything untouched. Entering
  full-page during an edit queues the laser the same way, since annotation
  editing works in full-page too.
- The shared `MouseTracker`'s `preProcessEventHandler` skips gestures whose
  target is tagged `data-hriv-canvas-ui` **or outside `viewer.canvas`**, so
  presses on the OSD control dock/navigator can't start a rect or stroke.
- Everything is ephemeral: ink is never persisted to metadata, share links
  or exports, and is cleared on full-page exit and unmount.
- Telemetry rides `ui.toolbar_action`: `laser_pointer_on|off`,
  `ink_on|off`.

## Out of scope (deferred)

- Magic-lasso edge-detected outlines (too risky to fail visibly in front of
  a class), numbered pins and quiz/reveal (deferred to the Inuksuks & Boards
  epic [#1765](https://github.com/bcit-tlu/hriv/issues/1765)), ink
  persistence, extra colours/shapes/eraser, spotlight/loupe, remote pointer
  broadcast.

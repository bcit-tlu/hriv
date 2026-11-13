# Object counting

Object counting outlines objects in a selection rectangle and tells you how
many there are. It is a **counter, not a classifier** — it finds and outlines
objects but does not identify what they are. Detected objects are grouped by
appearance (size, colour, texture) into unnamed groups (Group 1, Group 2, …).

## How to use it

1. Click the **selection** button in the viewer toolbar and drag a rectangle.
2. Click **Count objects** above the rectangle and choose **Cells** or
   **Nuclei**.
3. The report opens when counting finishes: outlines clipped to the
   selection, a group legend with counts, and a total. Reopen it any time
   with **View results**.

Every selection rectangle is its own count — overlapping selections each get
their own outlines and legend.

## Cells or Nuclei?

- **Cells** outlines whole cells by their stained shape — best for blood
  smears and other preparations where cells sit apart from each other.
- **Nuclei** outlines cell nuclei with a model trained on brightfield
  tissue and cytology images. Only blue/purple (hematoxylin-stained)
  objects are kept, so pink or red objects such as red blood cells are
  ignored in this mode.

The counter picks the viewing resolution itself from the size of the
objects in your box, so it does not matter how far you are zoomed in when
you draw it — only how large the box is.

## The edge rule

An object counts only when its **centre** lies inside your selection box.
Outlines are cut off exactly at the box edge. Objects you can partially see
in the margin but that are centred outside the box are not counted — the
same rule a person would use.

## Fixing a count

The report opens ready to adjust. **Click an outline** to remove it — it
stays visible, dashed and dimmed, and a second click brings it back.
**Click a missed object** to drop an outline on it, or **drag** around it
to draw one; new outlines join the closest-sized group. **Reset** restores
the original result, and **Done** locks the outlines for view-only
inspection. Adjustments are never saved — recounting starts fresh.

## Results are temporary

Counts are **not saved**. They disappear when you clear the selection
rectangles, switch image, leave the page, or refresh. Draw the same box and
count again if you need the result back.

## Known difficulties

Automatic counting can be wrong — always double-check the outlines visually
against the specimen. Expect weaker results for:

- overlapping or clumped cells,
- thick smear areas and tissue folds,
- debris and stain artefacts,
- very faint or very dense regions,
- uneven staining or illumination drift across the field,
- selections that are too large (the count may be refused — draw a smaller
  box or zoom in).

The counter automatically corrects for slowly-varying background staining
(flat-field preprocessing) and honours detection settings tuned during
measurement review when they were saved onto the image. Neither replaces a
visual check.

If a count looks wrong, remove the outlines that shouldn't count or add
the ones it missed — or cancel and try a tighter selection.

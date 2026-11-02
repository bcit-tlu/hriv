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

## The edge rule

An object counts only when its **centre** lies inside your selection box.
Outlines are cut off exactly at the box edge. Objects you can partially see
in the margin but that are centred outside the box are not counted — the
same rule a person would use.

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
- selections that are too large (the count may be refused — draw a smaller
  box or zoom in).

If a count looks wrong, cancel it or clear the rectangle and try a tighter
selection.

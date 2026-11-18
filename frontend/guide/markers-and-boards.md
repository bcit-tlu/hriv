# Markers & Boards

An **Marker** bookmarks a precise view of an image: its position, zoom and rotation.
A **Board** arranges these saved views into an ordered study.
These controls appear only when your deployment enables Markers and Boards.

## Save and revisit a view

Open an image and toggle **Add Marker**. You can still drag, scroll or pinch to
pan and zoom. A quick click or tap places a blue marker and opens a small panel at
the top-right. Type a title and choose a Board; your last-used Board is selected
when available. The **Add Marker** panel's Boards dropdown has checkboxes, alphabetic
options and no chips. Selected names show as text (`A, B +1`). A pinned
**+ Add Board** row sits at the bottom of the fixed-height menu while options
scroll above it. It slides a New Board pane in from the right with the full Add
Board fields (name, description, “Visible to” radios and restricted
Program/Group chips); the top-left back arrow or Escape returns with your draft
intact, and creating selects the new Board. Expand **More options**
for a description; toggle the outlined/filled star in the title row for Favourite.
**Save** keeps the tool on for
another placement. **Cancel** or Escape removes the unsaved marker; Escape again,
or the toolbar pin, turns placement off. An unsaved view also appears in the drawer.

Click a saved marker to restore its view and open its information card. The card
shows its Marker icon, title, description, visible Boards and favourite state. The
pencil sits immediately beside its title, and authorized users can toggle the
star directly in view mode. Use the pencil
to edit in place if permitted. The card has no X: press outside to deselect and
close it, or Escape. Another marker selects that Marker. Drawer **⋮ → Edit** selects,
focuses and pans to the same Marker and opens the same inline editor, with Boards,
star, Save/Cancel and permitted Delete. Description is collapsed under More options
even when filled; opening it reveals the saved text. Delete opens a separate
confirmation dialog; cancelling that dialog leaves your draft untouched.
While editing, outside presses—including other markers/rows—keep your editor open;
finish with Save/Cancel, or explicitly Escape to cancel and close. The Boards menu
does not dismiss it. Version conflicts retain your fields and offer Reload current.
This works in image, Sequence and Synchronized viewers; BoardsPage keeps its modal edit form.
Saving a Marker does not modify the source image.
The drawer/panel omits the redundant Markers total heading. Rows are grouped by
their associated Boards: each Board name is a heading-link that opens the Board
dialog right over the image — marker tiles inside it jump to their saved views,
and **Open in Boards & Markers** reaches the full management page. Your own
Boards list first, then
instructor-owned or program Boards; Boards shared by classmates sit under a
collapsed **Public & Shared** section — open it to browse them, and their
markers stay off the canvas until you show them (the section's eye icon shows
them all). Headings are not collapsible and
show no counts; saved views with no visible Board sit under **Other**, and an
open draft sits under **Unsaved**.
Choosing a marker — from the drawer, from Boards & Markers, or from search —
always shows it on the canvas, even if you had hidden it, and recentres on its
saved view.
Markers have white circular backgrounds with blue icons, staying upright and
the same size as you zoom or rotate; label styling is unchanged.

The top-left pin opens the Markers drawer without hiding the image toolbar.
Use **⋮** for Show/Hide marker, then Show/Hide label and, when allowed,
Edit or Delete. Label actions use LabelOff (Hide) / Label (Show) icons, including
the eye and label icons beside each group heading. A group action applies to all
views in that Board; a Mixed group action shows all.
These display preferences are remembered for your account.
Hidden-marker titles are dimmed and identified as hidden to screen readers.
**Pin Markers** keeps the drawer open between images, through sequence navigation
and when opening another image page. The pin is remembered for your account.
Unpinning keeps it open until you press elsewhere; outside presses (including
on the image) then retract it immediately. Drawer menus do not count as outside.
In placement mode, pressing the image closes an unpinned drawer and still places
the new marker. Escape closes an unpinned drawer; pinned drawers stay open.

## Organize a Board

Open **Boards** to see your owned Board chips across the top and your personally owned
saved views under **My Markers** below. **New Board** is the first chip. Use Title, Scope
(Private / Restricted / Public), Owner/Mine or Favourite to narrow both lists;
remove filter chips or use Clear filters to reset. Each saved view shows its
image's parent category under the title.
The page heading is **My Boards**, aligned like Collections without extra page padding.
Boards are rounded chips with a square cover, a one-line name and a scope pill
below it. Your row includes only owned Boards you can edit, including program-owned Boards when permitted.
Read-only Boards are discoverable through All Boards → **Public & Shared** instead, for instructors and admins.
Drag an editable Board chip by its surface to reorder it; there is no grip icon.
Clicking still opens the Board. Active filters disable Board reordering.
Use the outlined **All Boards** button at the right of the title row — available
to admins, instructors and staff — for a large dialog listing every Board returned
by the API, including others' private Boards and Boards already in your chip row.
Students never see it. Filter chips sit in a row beneath the dialog title:
**Public & Shared** keeps public, program/group-restricted or co-owned/program-member
Boards outside your chip row (other people's private Boards stay excluded for
every role), and **Instructor Boards** keeps program-owned or
admin/instructor-owned Boards. Chips toggle independently and combine; clearing
them all restores the complete list. Tiles show title, scope pill and
**Managed by {name}** (or program name / No owner). Choose a tile to open its usual
dialog and see its authorized saved views. These are UX lists; backend visibility
remains authoritative and unchanged.
The discovery list is independent of the overview filters.

Choose **Cards** or **Table** beside My Markers; the filter bar sits underneath.
The outlined **Select** button sits at the right of the Filter by row in both views,
and every selection action — including **Cancel Selection** — stays on the same row.
Both overview views are alphabetical by title, ignoring case. Favouriting or moving
a view does not move its position; renaming places it at the new alphabetical position.
Favourite stars are filled white in Cards and Table, with a contrasting background
so the selected state stays visible on light surfaces too.
Cards are 234px wide with 96px thumbnails and content-fit height, and use Collections-style pin/title/category metadata;
the scope pill lives on the Board tiles instead, so saved-view cards are shorter.
Table shows title, category, Boards, favourite and actions. Click a Board name
in the table to open it.
The top-right star toggles Favourite; the move icon opens **Move/Save to…**.
The pencil beside the title opens Edit, with Delete and Remove from this Board
when permitted. Clicking a view still opens its saved image location.

Drag a saved-view card onto an editable Board chip to save it there too;
the other Board memberships stay intact. A highlighted target and confirmation
message show the result. Read-only Boards do not accept saves.
Rejected drops show why: **Already in {Board name}** or **You can't add Markers
to {Board name}**. Ineligible targets do not highlight and no save is sent.
Messages use the standard bottom-centre filled alert: green for a successful save,
info for an existing link and warning for other refusals.
**Move/Save to…** via the move icon is the explicit alternative, including moving between Boards.

Click a Board tab to open its large dialog (full-screen on a phone). The heading
keeps its title, scope, count and controls visible while the saved views scroll.
The title is larger than its smaller secondary Marker count, matching Collections.
The Collections-style scope pill sits beside **Managed by {owner names}**; its
transfer icon opens owner management when permitted. The pencil opens Edit Board,
where **Delete Board** sits below the fields. It requires confirmation and warns
that Markers left without a Board will be permanently deleted. Conflicts require
Reload latest before saving or deleting. **Create Collection** is an
outlined button just left of Close (disabled for an empty Board). There is no Board
**⋮** menu. Reorder cards by dragging them to arrange
the study. **Select**, at the right of the collage toolbar, enables Collection
actions and keeps every selection control, including **Cancel Selection**, on
the same row. Click a saved view to open its image; Back returns to the Board dialog,
and Back again returns to the overview. Board owners can edit their Boards;
visibility and program/group restrictions determine who can view them.
Sharing a Board does not grant access to a restricted source image.

## Find saved views

Use the main **Search** dialog and enter words from a title or description.
The **Boards** and **Markers** chips narrow the results. Choose a Board to open it,
or choose a Marker to open its source image at the saved view. Search only returns
Boards and Markers you can view.

## Turn saved views into a Collection

Use a Board's **Create Collection** action to make an ordered
walkthrough. In **Select** mode, select any number of cards for a Sequence, or 2–4
cards for a Synchronized comparison. You can also add selected views to an existing
Collection, subject to that Collection's limits and your editing permissions.

In a Collection's Manage dialog, search for a Board or Marker and choose its result
to stage saved views into the draft. Review and save the draft to apply the additions.
Choosing a Board stages its visible views in Board order.

Each Collection slot keeps its own label, thumbnail and viewport, even when several
slots use the same source image. Changing a Collection's saved view does not change
the original Marker. See [Collections](collections) for the viewer controls.

## Image and Sequence viewer panel

When Markers is enabled, use **Open viewer panel** at the image's top-right.
Choose the pin for **Markers**, the link icon for **Shared View**, or the info icon for **Image details**.
The panel stays open until you choose **Close viewer panel**; it does not need
pinning and canvas clicks do not retract it. Your open state and selected content
carry across images, Sequence steps and reloads for your account.
The panel is 256px wide on larger screens. Shared View's **Copy current view**
copies the current image location, zoom and selection boxes; it replaces the old
Share View button. In Sequence it creates a standalone image link at that view.
With the feature disabled the original Share View control remains unchanged.

Image, Sequence and Synchronized lists keep your own and instructor views
prominent (including markers on instructor/admin or program-owned Boards).
Markers that only reach you through a classmate's public or shared Board are
listed too, tucked under the collapsed **Public & Shared** section and hidden
from the canvas until you opt in. You can also browse them through
**Boards & Markers → All Boards → Public & Shared**.

On larger screens the image and minimap make room for the panel. On phones it
covers the image until closed. The row **⋮** menus and the eye/label icons
beside each group control marker/label visibility, editing and deletion. Placement still floats over the
image; starting a new view with Details open switches the panel to Markers.
Escape still cancels a draft before turning off placement, without closing the panel.
The earlier pin instructions apply only to the legacy Synchronized-pane drawers;
flag-off viewers keep their original Details drawer.

Saving a new Marker selects it and opens its information card. Its panel row
scrolls into view and receives keyboard focus, even if the panel was closed or
showing Details. The card's star beside Close indicates favourite status; use Edit
to change it. The panel and forms use compact text and spacing like the page footer.

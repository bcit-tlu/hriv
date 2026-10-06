# Collections

Collections gather a handful of images into a named set — for example, the
four views of one specimen, or a sequence that tells a story over time.

Open the **Collections** tab in the app bar and pick **Sequence** or
**Synchronized** from the menu — each page lists only collections of that
type. Everyone who is signed in,
including students, can see the tab; admins, instructors, staff and students
can all create their own collections (staff see every collection and, like
students, edit the ones they own or co-own). (If
your HRIV instance doesn't show a Collections tab yet, the feature hasn't
been switched on there — ask your administrator.)

## Two kinds of collection

- **Synchronized** – up to four images shown together; pan and zoom move
  all of them together.
- **Sequence** – any number of images in a fixed order, stepped through one
  at a time.

You choose the type when you create a collection and can't change it later —
create a new collection instead.

## Viewing a synchronized collection

Open a synchronized collection and you get read-only viewers for every
image in it — two side by side for a pair, a 2×2 grid for three or four —
with annotations and measurement markings visible on each.

- Pan, zoom or rotate any pane and the others follow, keeping their
  relative positions — handy when the views highlight different spots.
- Each pane's caption shows the image name and an **Open image** link to
  the normal image view.
- The **pin** at the top-right of each pane keeps it linked to the others —
  panes start pinned. Click it to unpin a pane and adjust it on its own;
  click again to re-pin, which keeps the new relative positions.
- **Restore view** returns every pane to the saved view (or its starting
  position if none was saved).
- On a phone held upright the panes are replaced by a hint to rotate to
  landscape — your view is still there when you rotate back.

::: tip Saving the view
If you can edit the collection, a **Save view** button stores every pane's
current position for everyone — next time the collection opens, it lands
exactly there. Anyone can pan and zoom freely; only saving changes what
others see. Use the saved positions to line the images up around
different highlights.
:::

## Viewing a sequence collection

Open a sequence collection and you get a read-only viewer that shows one
image at a time — annotations and measurement markings on each image are
visible but can't be changed here.

- Step through with the **‹** and **›** buttons that appear on the viewer's
  left and right edges when you point at it (they fade away when idle, like
  the image toolbar), click a thumbnail in the strip above the viewer, or
  press the ← and → arrow keys — the viewer already has focus, so the keys
  work as soon as the collection opens.
- The caption under the viewer shows the image name, the position
  (`n of N` — part of the page link, so copying the URL shares the exact
  image you're looking at), and **Open image**, which jumps to the normal
  image view where you can edit annotations with the usual permissions.
- If you can edit the collection, a **Manage** button in the top-right
  header opens a dialog of thumbnails — a miniature Browse view. Drag
  thumbnails to reorder, drop one on the trash drop target (or click its
  corner remove icon) to take it out of the collection, and click **+** to
  add images through search. This works for synchronized collections too.

The breadcrumb at the top of the page shows where the collection lives in
Browse — for example _Home : Hematology : MLSC-3200 : Lab 3_ — and each
link jumps to that spot in Browse. A collection filed at the top level just
shows **Home**.

## Create a collection

1. Click **New collection**.
2. Give it a name (a description is optional).
3. Pick the **type** and who it's **visible to**:
   - **Private** – only you.
   - **Public** – everyone who can sign in.
   - **Restricted** – only students in the programs or groups you pick.
     Instructors can choose from the programs they belong to and the groups
     they manage; this option isn't offered to students or staff.
4. Click **Create**.

## Add an image to a collection

While viewing an image, click **Add to Collection** (next to **Share View**)
and pick one of your collections — or one owned by a program you teach in.
Type in the filter box to narrow a long list.

- The image is added to the end of the collection. If it is already there,
  nothing changes and a note tells you so.
- A synchronized collection that already holds four images is greyed out;
  hover it to see why.
- Use **New collection…** in the dialog to create a collection that starts
  with this image.
- After adding, the message at the bottom offers **View collection** to jump
  straight to it. Your browser's back button returns you to the image.

The button is unavailable while you are editing annotations on the canvas —
finish or cancel that first.

### Add several images at once (from search)

In the top-bar **Search**, click **Select** next to the result count, tick
each image you want, then click **Add to collection** in the footer. The
same dialog opens with all of them selected. You can keep selecting across
searches — images you picked under an earlier query still count, and they
are added in the order they appeared in your results. Only image results
can be selected; categories, collections, and other kinds still open when
you click them.

### Add an image from Browse (drag onto the tile)

On the **Browse** page, an editable collection's tile doubles as a drop
zone: drag an image tile onto its highlighted half and the image is
appended. The tile is a drop zone only when you can edit the collection —
you co-own it or teach in its program — and image dragging itself needs
admin/instructor rights, so this gesture is for instructors adding to
collections they manage. The same rules as the dialog above apply (dedupe,
the four-image cap on synchronized collections). An **Undo** action in the
message at the bottom removes the image again.

## Collections in Browse

Collection tiles appear on the **Browse** page alongside category and image
tiles — at the top level or nested inside categories, so a "Lab 2"
collection can sit inside _Histology → Epithelium_ like any other tile. Open
a tile to view the collection; the breadcrumb at the top of the collection
page shows its filed location and links back into Browse.

- Tiles keep a fixed width and can be dragged to reorder them among the
  images and categories in the same folder; the order is shared for every
  viewer.
- Admins and instructors can **file** a collection into a category (or back
  to the top level) with the card's **Move** action (the folder icon in the
  cover's top-right corner), the **Category** picker in the collection's
  edit dialog, or by dragging the tile
  onto a category tile's _Move here_ zone. Filing is curatorial, not
  ownership-bound — any admin/instructor can file any collection.
- A category tile's detail line counts the collections inside its subtree
  (`N collections`).
- When `COLLECTIONS_ENABLED` is off, collection tiles disappear from Browse
  entirely — existing placements are kept and return with the flag.

## Hide or show a collection (instructors and admins)

Curators can hide a collection with the **Hide collection** link at the top
right of the collection page or the **Hide Collection** link in the edit
dialog's title row — like hiding an image or a category. A hidden
collection:

- disappears from students' lists, Browse tiles, and search results —
  **except for its owners**, who keep full access to their own work;
- stays visible to admins, instructors and staff, shown desaturated with an
  eye-off marker on cards and in the Manage → Collections table, plus a
  **Hidden** chip on the collection page;
- keeps its place in the category structure and tile order — nothing moves.

Click **Show collection** in the same spot to make it visible again. Hiding
is curatorial, not ownership-bound: any admin or instructor can hide any
collection, and owners can't hide or unhide their own collections.

## Find a collection

Pick the type first — **Collections → Sequence** or **Collections →
Synchronized** in the app bar — then use the filters in the header row:

- **My collections** – just the collections you co-own.
- **Owner** – collections co-owned by a particular person, or owned by a
  program (not shown to students).

Each card shows the cover image, how many images it holds, its owners, a
type chip on the cover, and a visibility chip.

Collections also appear in the top-bar **Search** — both name and
description are searched, and the **Collections** chip narrows results to
just collections. Choosing a result opens it here.

## Edit or delete

If you co-own a collection (or teach in the program that owns it), the card
shows a **pencil** icon and the collection page shows an **Edit** button. A
collection can have several user co-owners plus, or instead of, a program
owner.

- **Edit** lets you change the name, description, visibility, and — for
  restricted collections — the programs and groups. Admins and instructors
  also get a **Category** picker that refiles the collection in Browse.
  Student co-owners can
  change the name, description and images, but the visibility, category and
  program / group scope stay locked (they can only change those on a
  collection they own alone).
- **Delete Collection** lives inside the edit dialog, at the bottom — click
  once to arm, then again to confirm. Deleting a collection never deletes
  the images in it. Co-owned and program-owned collections can't be deleted
  by a student co-owner — ask an instructor or administrator.

::: tip Changed elsewhere?
If someone else edited the collection while your dialog was open, saving
shows a "modified by another user" message with a **Reload** button. Reload
picks up their changes so you can re-apply yours.
:::

## Manage owners

If a collection shows an **Owners** action (in the card's cover overlay, at
the top of the collection page, or on its Manage → Collections table row),
you can manage who owns it — administrators for any
collection, instructors for collections they co-own or that belong to a
program they teach:

- **User owners** — pick co-owners from the **Students** or **Instructors**
  tabs (administrators also get **Everyone**). The student tab offers an
  optional **Filter by program** to narrow the search — the same people
  picker used when managing groups. Instructors only ever see students and
  fellow instructors; administrator and staff accounts can only be added by
  an administrator. A collection can have several co-owners of any role,
  including students. The last user owner can't be removed unless a program
  owns the collection.
- **Program owner** — administrators can pick any program; instructors only
  a program they belong to. Assigning a program makes it the sole owner —
  the user-owner list clears, and picking a program disables the user list
  to say so. Clearing a program hands the collection back to its user
  owners, so there must be at least one first.

Confirm to save — the collection keeps its images and visibility; only who
manages it changes. If the collection was edited by someone else while the
dialog was open, you'll see the "modified by another user" message — reopen
the dialog and try again.

::: tip Orphaned collections
When a collection's last user owner and its program owner are gone (both
deleted), the collection becomes _orphaned_. Administrators can find these
with the **Owner** filter's _No owner (orphaned)_ option and assign owners
with **Owners**.
:::

## Manage → Collections (instructors, staff, admins)

The **Manage → Collections** table lists every collection you can see —
both types together — in sortable columns with filter facets for name,
type, visibility, owner, and category. The **Category** column links into
Browse at that location. Rows offer the same actions the cards do where you
have permission: **Edit** and **Owners** — filing lives in the edit
dialog's Category picker, and delete stays inside the edit dialog. Clicking
a row you can edit opens
the editor; clicking a read-only row opens the collection itself.

## Share a link

The address bar shows `?collection=…` while a collection is open. Copy it to
share; anyone who can see the collection lands straight on it. Your browser's
back and forward buttons move between the library, images, and collections as
usual.

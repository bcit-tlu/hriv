# Collections

Collections gather a handful of images into a named set — for example, the
four views of one specimen, or a sequence that tells a story over time.

Open the **Collections** tab in the app bar. Everyone who is signed in,
including students, can see the tab; admins, instructors, staff and students
can all create their own collections (staff see every collection and, like
students, edit the ones they own or co-own). (If
your HRIV instance doesn't show a Collections tab yet, the feature hasn't
been switched on there — ask your administrator.)

## Two kinds of collection

- **Synchronized** – two images shown side by side; pan and zoom move both
  of them together.
- **Sequence** – any number of images in a fixed order, stepped through one
  at a time.

You choose the type when you create a collection and can't change it later —
create a new collection instead.

## Viewing a synchronized collection

Open a synchronized collection and you get two read-only viewers side by
side — the first two images in the collection — with annotations and
measurement markings visible on each.

- Pan, zoom or rotate either pane and the other follows, keeping its
  relative position — handy when two views highlight different spots.
- Each pane's caption shows the image name and an **Open image** link to
  the normal image view.
- If the collection holds more than two images, only the first two render —
  a note tells you how many more are stored.
- **Link views** (the switch above the viewers) unlinks the panes so you
  can adjust one side on its own; switching it back on keeps the new
  relative position.
- **Reset view** returns both panes to the saved view (or their starting
  positions if none was saved).
- On a phone held upright the panes are replaced by a hint to rotate to
  landscape — your view is still there when you rotate back.

::: tip Saving the view
If you can edit the collection, a **Save view** button stores both panes'
current positions for everyone — next time the collection opens, it lands
exactly there. Anyone can pan and zoom freely; only saving changes what
others see. Use the saved positions to line the two images up around
different highlights.
:::

## Viewing a sequence collection

Open a sequence collection and you get a read-only viewer that shows one
image at a time — annotations and measurement markings on each image are
visible but can't be changed here.

- Step through with **Previous** / **Next**, click a thumbnail in the strip
  below the viewer, or press the ← and → arrow keys.
- The position (`n of N`) is part of the page link, so copying the URL
  shares the exact image you're looking at.
- **Open image** jumps to the normal image view, where you can edit
  annotations with the usual permissions.
- If you can edit the collection, a **Reorder** button turns the thumbnail
  strip into a drag-and-drop list; drag images into place and choose
  **Done**.

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

## Find a collection

Use the filters above the grid:

- **All / Synchronized / Sequence** – narrow by type.
- **My collections** – just the collections you co-own.
- **Owner** – collections co-owned by a particular person, or owned by a
  program (not shown to students).

Each card shows the cover image, how many images it holds, its owners, and
chips for its type and visibility.

Collections also appear in the top-bar **Search** — both name and
description are searched, and the **Collections** chip narrows results to
just collections. Choosing a result opens it here.

## Edit or delete

If you co-own a collection (or teach in the program that owns it), the card
and the collection page show **pencil** and **trash** icons. A collection
can have several user co-owners plus, or instead of, a program owner.

- **Edit** lets you change the name, description, visibility, and — for
  restricted collections — the programs and groups. Student co-owners can
  change the name, description and images, but the visibility and program /
  group scope stay locked (they can only change those on a collection they
  own alone).
- **Delete** asks you to confirm first. Deleting a collection never deletes
  the images in it. Co-owned and program-owned collections can't be deleted
  by a student co-owner — ask an instructor or administrator.

::: tip Changed elsewhere?
If someone else edited the collection while your dialog was open, saving
shows a "modified by another user" message with a **Reload** button. Reload
picks up their changes so you can re-apply yours.
:::

## Manage owners

If a collection shows an **Owners** action (on its card or at the top of the
collection page), you can manage who owns it — administrators for any
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

## Share a link

The address bar shows `?collection=…` while a collection is open. Copy it to
share; anyone who can see the collection lands straight on it. Your browser's
back and forward buttons move between the library, images, and collections as
usual.

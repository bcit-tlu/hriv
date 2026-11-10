# Announcements

One stream for class notices and release notes (epic #1832). Authors post from
one composer, every role reads from one Inbox behind the AppBar bell, and
release notes are just announcements with `kind='release'`. This page covers
the data model and the `/api/announcements` API (#1833, #1834); the frontend
surfaces land with #1837/#1838 and are documented here as they ship.

## Rollout flag

`ANNOUNCEMENTS_ENABLED` (chart value `announcements.enabled`, default `false`;
exposed as `announcements` by `GET /api/features`) dark-launches the whole
`/api/announcements` surface — every route answers 404 while it is off. The
legacy `/api/announcement/` and `/api/changelog/` shims (see
[changelog-notifications.md](changelog-notifications.md)) are served regardless
and are removed by #1838.

## Model

See [domain-model.md](domain-model.md#announcement) for columns. In short:

| Field                       | Meaning                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `title`, `message`          | Card title and Markdown body (≤ 10 000 chars; images/videos via `/api/media/{id}`, #1835)     |
| `kind`                      | Controlled icon set — the icon _is_ the kind and fixes the severity (table below)             |
| `audience`                  | `everyone` · `staff` (admin + instructor + staff roles) · `targeted` (programs ∪ groups)      |
| `publish_at` / `expires_at` | Live window; `publish_at IS NULL` is a draft, a future `publish_at` is scheduled              |
| `notified_at`               | Version marker: readers are "unseen" until their marker matches it; **Notify again** bumps it |
| `pinned`                    | Sorts first in the Inbox and feeds the Home notices shelf (#1838)                             |
| `banner`                    | Also shown as the AppBar / login banner while live (#1838)                                    |
| `author_id`                 | `NULL` renders as author "Site" (migrated release notes)                                      |

### Kinds

| `kind`        | Icon                  | Severity  | Who may post      |
| ------------- | --------------------- | --------- | ----------------- |
| `notice`      | `Campaign`            | `info`    | admin, instructor |
| `event`       | `Event`               | `info`    | admin, instructor |
| `reminder`    | `NotificationsActive` | `info`    | admin, instructor |
| `celebration` | `Celebration`         | `success` | admin, instructor |
| `release`     | `RocketLaunch`        | `info`    | admin only        |
| `warning`     | `WarningAmber`        | `warning` | admin only        |

Emoji are **reactions only** (`+1`, `heart`, `laugh`, `confused`, `hooray`,
`rocket`, `eyes`, `clap`), never a kind.

## Who sees what (audience rule)

A reader sees an announcement when **any** of these holds
(`app/announcements.py::can_view`):

- `audience='everyone'`;
- `audience='staff'` and the reader's role is `admin`, `instructor` or `staff`;
- the reader is the author;
- `audience='targeted'` and the reader is a member of **any** attached program,
  a member of **any** attached group, or an instructor who co-manages **any**
  attached group.

This is deliberately a **union** — unlike category visibility, which is the
dual gate (programs **AND** groups, evaluated up the ancestor chain). A targeted
announcement is a message to a set of people, not a permission boundary, so
matching one program or one group is enough. Admins get no implicit reach into
targeted posts they did not author (their **Mine** scope shows everything).

The `inbox` scope additionally applies the live window
(`publish_at <= now < expires_at`). `PUT …/seen` and the reaction routes use
the same `can_view` predicate so the three paths cannot drift; readers outside
the audience get **404**, not 403.

## API

All routes are gated by the rollout flag. Minimum roles:

| Method   | Path                                        | Role               | Notes                                                                                            |
| -------- | ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/announcements/broadcast`              | — (public)         | Live `everyone` ∧ `banner` posts, minimal shape for the login screen                             |
| `GET`    | `/api/announcements/?scope=inbox`           | any authenticated  | Live posts visible to the caller, `pinned DESC, notified_at DESC`                                |
| `GET`    | `/api/announcements/?scope=mine`            | admin, instructor  | Instructor: own posts (all states) + posts targeted at co-managed groups (read-only); admin: all |
| `POST`   | `/api/announcements/`                       | admin, instructor  | 201; see authority rules                                                                         |
| `PATCH`  | `/api/announcements/{id}`                   | author or admin    | `notify_again=true` bumps `notified_at`; other edits never resurface a post                      |
| `DELETE` | `/api/announcements/{id}`                   | author or admin    | 204                                                                                              |
| `PUT`    | `/api/announcements/{id}/seen`              | any visible reader | Idempotent; 204                                                                                  |
| `PUT`    | `/api/announcements/{id}/reactions/{emoji}` | any visible reader | Live posts only; idempotent add; returns counts                                                  |
| `DELETE` | `/api/announcements/{id}/reactions/{emoji}` | any visible reader | Live posts only; idempotent remove; returns counts                                               |

### Authority rules (`POST` / `PATCH`)

- Instructors may only use `audience='targeted'`, and only with programs they
  belong to (`can_attach_program_to_category`) and groups they manage
  (`can_manage_group`) → **403** otherwise. `everyone`, `staff`, `release` and
  `warning` are admin-only (**403**).
- `targeted` with no program/group ids → **422**; unknown ids → **422**;
  `expires_at <= publish_at` → **422**.
- `PATCH` re-validates audience/kind/target authority **only** when those
  fields are in the body, so an author who has since lost a group can still fix
  a typo (message-only edit) but cannot re-target.
- `POST` publishes immediately unless `draft=true` or an explicit `publish_at`
  is given; publishing sets `notified_at = publish_at`. `PATCH draft=true`
  unpublishes (clears both); `draft=false` on a draft publishes now.

### Seen-state

Per user, in `users.metadata["announcement_seen"]` as
`{"<announcement id>": "<notified_at ISO>"}` — always merged, never
overwritten (`app/announcements.py::mark_seen`). A card is `seen` when the
stored marker is ≥ the post's current `notified_at`; **Notify again** therefore
flips every reader back to unseen, while ordinary edits do not. Seen cards stay
in the Inbox (quieter styling); nothing is ever dismissed/deleted for a reader.

### Seen counts (staff only)

Admin, instructor and staff callers receive `seen_count` (readers whose marker
matches the current version) and `audience_size` (distinct users the post can
reach: `null` for `everyone`, active staff-role head-count for `staff`, the
distinct union of program members, group members and group instructors for
`targeted`). Students never receive these fields and no payload ever lists
_who_ has seen or reacted — only counts and the caller's own reactions.

### Response shape (`AnnouncementOut`)

`id, title, message, kind, icon, severity, audience, author_id, author_name,
program_ids/names, group_ids/names, publish_at, expires_at, notified_at,
pinned, banner, status (draft|scheduled|live|expired), seen, reactions
{emoji: count}, my_reactions [emoji], media_tokens {media_id: token} (tokens
minted by #1835), can_edit, seen_count?, audience_size?, created_at,
updated_at`.

## Media (images and video)

Authors upload through `POST /api/media/` (admin, instructor; multipart `file`).
Accepted: images `image/jpeg|png|webp|gif` ≤ 10 MB (magic bytes must match the
declared type), video `video/mp4|webm` ≤ 50 MB (declared type + extension).
Files are streamed to `<data_dir>/media/<uuid><ext>` via a staging name and a
`content_media` row keeps `original_name`, `content_type`, `size_bytes` and
`uploader_id`. The response's `tokenized_url` is ready to paste into Markdown:

```markdown
![caption](/api/media/12) ← image
/api/media/13 ← standalone line = video
```

`GET /api/media/{id}?token=…` serves the file with its stored content type,
`Content-Disposition: inline`, `Cache-Control: private, max-age=3600` and the
same realpath containment guard as tiles (404 on any rejection). The token is a
signed, 60-minute, media-id-bound HMAC (`app/media_tokens.py`, mirrors
`tile_tokens.py`); announcement responses mint fresh tokens for every
`/api/media/{id}` reference in `message` (`media_tokens: {id: token}`), so
`<img>`/`<video>` tags never carry a bearer JWT. The nginx front door whitelists
`/api/media` in its unlimited-body upload location. No listing or delete in v1;
orphaned files are tolerated.

## Frontend

Everything below is gated on `features.announcements` (`GET /api/features`);
while the flag is off the pre-#1832 surfaces keep working through the shims
described in [changelog-notifications.md](changelog-notifications.md). #1838
(banner policy, Home notices shelf, login broadcast, legacy cleanup) removes
those shims.

| Surface            | File                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bell (every role)  | `AnnouncementsBell.tsx`    | Badge = unseen live Inbox posts. Popover peeks the newest ≤5 unseen titles (kind icon + relative time); clicking one opens the page focused on it; **See all** → `?page=announcements`.                                                                                                                                                                                                                                                                                                                                                                                       |
| Page               | `AnnouncementsPage.tsx`    | **Inbox** for all roles; **Mine** + **New announcement** for admin/instructor/staff (`canEditContent`). Inbox posts are marked seen once on screen, once per `(id, notified_at)`, and stay listed (quieter). Mine has Draft/Scheduled/Live/Expired filters; Edit/Duplicate/Delete only where `can_edit`; co-managed rows are read-only and show the author. Delete confirms. `?id=` deep links scroll to and highlight a card.                                                                                                                                                |
| Card               | `AnnouncementCard.tsx`     | Kind icon (severity-tinted), title, author ("Site" fallback), audience chips, relative time with absolute tooltip, Markdown body with `media_tokens`, reaction pills + picker, "Seen by N of M" (staff viewers, counts from the API only).                                                                                                                                                                                                                                                                                                                                    |
| Composer           | `AnnouncementComposer.tsx` | Dialog. One grouped `To:` multi-select (Audience → Everyone/Staff for admins only; Programs; Groups) with sentinel/target exclusivity; instructors need ≥1 target. Kind picker hides admin-only kinds from instructors. Markdown textarea, media upload toolbar (`![name](/api/media/{id})` for images, bare `/api/media/{id}` for video, each on its own paragraph), Preview via `MarkdownContent`. "More options": publish/expiry (`datetime-local` ↔ ISO UTC), pin, banner (admin), **Notify readers again** (edit). Draft = `draft: true`. Duplicate clears the schedule. |
| Contextual compose | `GroupManagementModal.tsx` | Row menu **Post to group** opens the page with the composer pre-targeted at that group.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Shared feed        | `useAnnouncements.ts`      | One fetch for bell + page (`scope=inbox`), background refresh at the standard cadence, optimistic seen/reactions with rollback.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Kinds              | `announcementKinds.ts`     | `ANNOUNCEMENT_KINDS` (icon, label, severity, `adminOnly`), `ANNOUNCEMENT_REACTIONS`, status labels, audience chips, sort (pinned first, newest notified).                                                                                                                                                                                                                                                                                                                                                                                                                     |

Navigation changes behind the flag: Documentation and About move from the
bell menu to the profile popover (`AboutMenuItems.tsx`); the legacy
Manage → Announcement and profile → View Announcement links are hidden. The
singleton banner and What's New dialog are untouched until #1838.

## Testing

Frontend: `tests/announcementKinds.test.ts`, `tests/announcementsApi.test.ts`,
`tests/useAnnouncements.test.tsx`, `tests/components/Announcement{Card,Composer,sBell,sPage}.test.tsx`
(`npx vitest run --config vite.config.ts tests/components/Announcement*`).

Backend: `backend/tests/test_router_announcements.py` (visibility matrix, authority,
seen-state, seen counts, reactions, route ordering, flag gate),
`test_announcements_helpers.py`, and the shim tests
`test_router_announcement.py` / `test_router_changelog.py`.

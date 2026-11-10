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

## Frontend

Pending #1837 (Announcements page: Inbox / Mine, composer, bell for all roles)
and #1838 (banner policy, Home notices shelf, login broadcast, legacy cleanup).
Until then the pre-#1832 surfaces keep working through the shims described in
[changelog-notifications.md](changelog-notifications.md).

## Testing

`backend/tests/test_router_announcements.py` (visibility matrix, authority,
seen-state, seen counts, reactions, route ordering, flag gate),
`test_announcements_helpers.py`, and the shim tests
`test_router_announcement.py` / `test_router_changelog.py`.

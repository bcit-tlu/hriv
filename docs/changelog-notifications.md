# Changelog Notifications

Admins can publish in-app changelog entries that appear separately from the
existing site-wide announcement banner.

## Summary

- The notification bell is visible to `admin` and `instructor` users only.
- Opening **What's New** shows changelog entries as Markdown cards, newest
  first.
- The unread dot clears when the user opens **What's New**, not when they only
  open the bell menu.
- Admins manage entries from the Admin page's default **Changelog** tab;
  instructors can read entries but cannot create, edit, or delete them.
- Editing an existing entry republishes it by bumping `published_at`, which
  makes it unread again for users who already cleared it.
- Changelog cards support safe bare `http/https` links and Markdown
  `[label](https://...)` links, which open in a new tab while preserving the
  existing card typography.

## Data Model

### `changelog_entries`

The backend stores changelog content in a dedicated `changelog_entries` table.

| Column         | Type        | Notes                                           |
| -------------- | ----------- | ----------------------------------------------- |
| `id`           | integer PK  |                                                 |
| `title`        | string(500) | Card title shown in both admin and reader views |
| `body`         | text        | Markdown body                                   |
| `published_at` | timestamptz | Updated on create and republish                 |
| `created_at`   | timestamptz | Insert timestamp                                |
| `updated_at`   | timestamptz | Standard update timestamp                       |

### Per-user read state

Read state is stored in `users.metadata_` under the
`changelog_last_read_at` key. The frontend also caches the latest read
timestamp in `localStorage` under `hriv_changelog_last_read_<email>` so the
badge clears instantly on open and stays scoped to the current account.
`NotificationMenu` hydrates from the server-backed `metadata_extra` value
returned by `/api/auth/me` and uses `localStorage` as the same-browser fast
path.

## API

| Method   | Endpoint                   | Minimum role | Purpose                               |
| -------- | -------------------------- | ------------ | ------------------------------------- |
| `GET`    | `/api/changelog/`          | instructor   | List entries, newest first            |
| `POST`   | `/api/changelog/`          | admin        | Create a new entry                    |
| `PATCH`  | `/api/changelog/{id}`      | admin        | Update and republish an entry         |
| `DELETE` | `/api/changelog/{id}`      | admin        | Delete an entry                       |
| `POST`   | `/api/changelog/mark-read` | instructor   | Persist the caller's latest read time |

## Frontend Locations

| Concern                                                        | File                                           |
| -------------------------------------------------------------- | ---------------------------------------------- |
| Notification bell, unread dot, What's New dialog, About dialog | `frontend/src/components/NotificationMenu.tsx` |
| Admin tab layout and tab state                                 | `frontend/src/components/AdminPage.tsx`        |
| Admin CRUD table and dialogs                                   | `frontend/src/components/ChangelogAdmin.tsx`   |
| Shared Markdown rendering                                      | `frontend/src/components/MarkdownContent.tsx`  |
| AppBar insertion point                                         | `frontend/src/components/AppShell.tsx`         |
| Role-gated wiring                                              | `frontend/src/App.tsx`                         |

## Invariants

- This feature is **parallel to** the existing announcement feature; do not
  merge their state, UI, or backend routes.
- The `mark-read` route must stay ahead of `/{entry_id}` routes in
  `backend/app/routers/changelog.py`.
- A republish is never silent: updating an entry always bumps
  `published_at`.
- Students never see the bell, and the API also blocks student access.

# Domain model reference

A quick reference to the data model before changing schemas or migrations. All
models live in `backend/app/models.py`. **Alembic is the sole source of truth for
the schema** — change the model *and* generate a migration in the same PR (see
[`AGENTS.md`](../AGENTS.md) → Database schema changes and `backend/README.md`).

## Entities

### User
- **Purpose:** authenticated user with role-based access.
- **Key fields:** `name`; `email` (unique, **case-insensitive** via
  `ix_users_email_lower`); `password_hash` (nullable — OIDC users have none);
  `oidc_subject` (nullable, unique); `role` (default `"student"`);
  `last_access`; `metadata_` (JSONB, DB column `metadata`).
- **Relationships:** `programs` (M2M via `user_programs`); `groups` (M2M via
  `group_members`, `viewonly` — the user's group memberships).
- **Deletion:** no cascade targets; `admin_tasks.created_by` and
  `groups.created_by_user_id` are `SET NULL` on delete.

### Program
- **Purpose:** access-control unit gating category visibility for students
  (admin/OIDC-managed; flat).
- **Key fields:** `name` (unique); `oidc_group` (nullable, unique — maps an OIDC
  group claim to auto-assign users).
- **Relationships:** `users` (M2M `viewonly`).
- **Deletion:** cascades through the `user_programs` and `category_programs`
  junctions.

### Group _(added in `0010_add_groups`)_
- **Purpose:** instructor-managed visibility dimension, independent of programs.
- **Key fields:** `name` (unique); `description` (nullable);
  `created_by_user_id` (FK to User, **SET NULL** — audit only).
- **Relationships:** `members` (M2M students via `group_members`, eager
  `selectin`); `instructors` (M2M instructor co-owners via `group_instructors`,
  eager `selectin`); `categories` (M2M via `category_groups`, `viewonly`).
- **Deletion:** blocked at the API layer with **409** if attached to any
  category; otherwise `category_groups` rows `CASCADE` when a category is
  deleted.
- See [Groups](groups.md) for membership/lifecycle invariants.

### Category
- **Purpose:** hierarchical folder structure for organising images.
- **Key fields:** `label`; `parent_id` (nullable self-FK, `CASCADE`); `status`
  (`"active"` / `"hidden"`, default `active`); `sort_order`; `version` (integer,
  starts at 1, used for optimistic concurrency); `metadata_` (JSONB, DB column
  `metadata`).
- **Relationships:** `children` (self-referential, `cascade="all, delete-orphan"`);
  `parent`; `images`; `programs` (M2M via `category_programs`, eager `selectin`);
  `groups` (M2M via `category_groups`, eager `selectin`). Programs and groups are
  **independent** restriction dimensions.
- **Deletion:** `CASCADE` to children, `category_programs`, and `category_groups`;
  images get `category_id = NULL` (`SET NULL`).

### Image
- **Purpose:** a processed, viewable image served via deep-zoom tiles.
- **Key fields:** `name`; `thumb`; `tile_sources` (DZI path); `category_id`
  (nullable FK, `SET NULL`); `copyright`; `note`; `active` (boolean — inactive
  images are hidden from students); `metadata_` (JSONB, DB column `metadata` —
  stores `canvas_annotations`, `locked_overlays`, `measurement_scale`,
  `measurement_unit`); `sort_order`; `version` (integer, starts at 1, used for
  optimistic concurrency); `width`; `height`; `file_size`.
- **Common mistakes:**
  - `metadata_` is the Python attribute but the DB column is `metadata`.
  - `Image.active` controls *image* visibility; `Category.status` controls
    *category* visibility — they are **independent**.

### SourceImage
- **Purpose:** original uploaded file before tiling/processing.
- **Key fields:** `original_filename`; `stored_path`; `status` (`pending` /
  `processing` / `completed` / `failed`); `progress`; `error_message`;
  `status_message`; `name`; `category_id` (`SET NULL`); `copyright`; `note`;
  `active`; `image_id` (FK to Image, `SET NULL` — linked after processing);
  `file_size` (BigInteger).
- **Relationships:** `image` (nullable).

### BulkImportJob
- **Purpose:** tracks multi-file upload/import operations.
- **Key fields:** `status` (`pending` / `processing` / `completed` / `failed`);
  `category_id` (nullable FK, `SET NULL`); `total_count`; `completed_count`;
  `failed_count`; `errors` (JSONB array).
- **Relationships:** `category`.

### Announcement
- **Purpose:** system-wide banner message.
- **Key fields:** `message` (text); `enabled` (boolean).
- **Note:** singleton — only `id=1` is used in practice.

### ChangelogEntry _(added in `0012_add_changelog_entries`)_
- **Purpose:** admin-authored in-app release notes shown in the **What's New**
  feed for admin and instructor users.
- **Key fields:** `title`; `body` (Markdown text rendered by the frontend);
  `published_at` (defaults to creation time and is bumped on edit/republish).
- **Relationships:** none — this is a standalone content table.
- **Deletion:** no cascade targets; deleting an entry only removes that
  changelog item.

### AdminTask
- **Purpose:** tracks long-running admin import/export operations.
- **Key fields:** `task_type` (`db_export` / `db_import` / `files_export` /
  `files_import`); `status` (`uploading` / `pending` / `running` / `completed` /
  `failed` / `cancelling` / `cancelled`); `progress`; `log` (append-only);
  `result_filename`; `result_path`; `input_path`; `error_message`; `created_by`
  (FK to User, `SET NULL`).
- See [Admin import/export](admin-import-export.md) for the task lifecycle.

## Junction tables

| Table | Composite PK | FK behaviour | Constraint |
|-------|--------------|--------------|------------|
| `user_programs` | `(user_id, program_id)` | both `CASCADE` | — |
| `category_programs` | `(category_id, program_id)` | both `CASCADE` | — |
| `group_members` | `(group_id, user_id)` | both `CASCADE` | members must be **students** (422 on mismatch) |
| `group_instructors` | `(group_id, user_id)` | both `CASCADE` | instructors must be **instructors** (422); last instructor cannot be removed (409) |
| `category_groups` | `(category_id, group_id)` | both `CASCADE` | group attached to a category cannot be deleted (409) |

`group_members` and `group_instructors` also carry a `created_at` timestamp.

## Conventions & gotchas

- **`metadata_` (Python) vs `metadata` (DB column).** Both `User`, `Category`,
  and `Image` map the JSONB column `metadata` to the attribute `metadata_`.
- **Nullable FKs use `SET NULL`** where deleting the parent should orphan rather
  than delete the child: `images.category_id`, `source_images.category_id`,
  `source_images.image_id`, `bulk_import_jobs.category_id`,
  `admin_tasks.created_by`, `groups.created_by_user_id`.
- **`active` (Image) vs `status` (Category)** are independent visibility
  mechanisms — don't conflate them.
- **`sort_order`** exists on both `Category` and `Image` for manual ordering.
- **Programs and groups are independent.** Group membership does not imply
  program membership; do not derive one from the other.
- **Migrations:** review `alembic revision --autogenerate` output carefully —
  several indexes are named explicitly in `__table_args__` to keep autogenerate
  from proposing spurious rename/drop operations.

See also: [Groups](groups.md),
[Category visibility & program restriction](category-visibility-and-programs.md),
[Admin import/export](admin-import-export.md),
[agent feature map](agent-feature-map.md).

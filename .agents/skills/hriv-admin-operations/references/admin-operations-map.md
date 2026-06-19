# Admin Operations Map

## Backend Files

| Concern               | Files                                                   |
| --------------------- | ------------------------------------------------------- |
| Admin endpoints       | `backend/app/routers/admin.py`                          |
| Export/import runners | `backend/app/admin_ops.py`                              |
| Background enqueue    | `backend/app/worker.py`                                 |
| Task model            | `backend/app/models.py` (`AdminTask`)                   |
| Task schemas          | `backend/app/schemas.py`                                |
| Maintenance mode      | `backend/app/maintenance.py`, `routers/announcement.py` |
| Changelog             | `backend/app/routers/changelog.py`                      |
| Issues                | `backend/app/routers/issues.py`                         |

## Frontend Files

| Concern                               | Files                                             |
| ------------------------------------- | ------------------------------------------------- |
| Admin page                            | `frontend/src/components/AdminPage.tsx`           |
| Import confirmation                   | `ConfirmImportDialog.tsx`                         |
| Announcements and maintenance banners | `AnnouncementBanner.tsx`, `MaintenanceBanner.tsx` |
| Changelog admin                       | `ChangelogAdmin.tsx`, `NotificationMenu.tsx`      |
| Issue reports                         | `ReportIssueModal.tsx`                            |
| API wrappers                          | `frontend/src/api.ts`                             |

## Task Status Model

```text
uploading -> pending -> running -> completed
                       -> failed
                       -> cancelling -> cancelled
```

`pending`, `running`, `uploading`, and `cancelling` are active for concurrency
guards. Cancellation is soft first and can be forced from `cancelling` to
`cancelled`.

## Import/Export Data

DB export/import includes programs, groups, categories and restrictions, images,
source images, users and memberships, changelog entries, and announcement data.
Filesystem export/import handles source-image filesystem archives.

## Docs And Tests

- `../../../../docs/admin-import-export.md`
- `../../../../docs/changelog-notifications.md`
- `backend/tests/test_admin_ops.py`
- `backend/tests/test_router_admin.py`

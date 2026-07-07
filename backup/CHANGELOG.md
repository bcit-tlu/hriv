# Changelog

## [0.10.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.9.0...backup-v0.10.0) (2026-07-07)


### Features

* **admin:** per-file restore from backup snapshots via Admin UI ([#828](https://github.com/bcit-tlu/hriv/issues/828)) ([dc047ae](https://github.com/bcit-tlu/hriv/commit/dc047aeb7f62b827bc03febf342d604d9348c742))

## [0.9.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.8.0...backup-v0.9.0) (2026-07-06)


### Features

* **backup:** last-success heartbeat, status command, and operator DR runbook ([#822](https://github.com/bcit-tlu/hriv/issues/822)) ([36bc2d0](https://github.com/bcit-tlu/hriv/commit/36bc2d0c0e8018807662134f1846ed465b20b76c))

## [0.8.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.7.0...backup-v0.8.0) (2026-06-30)


### Features

* **backup:** add BACKUP_MODE for production tile exclusion ([#753](https://github.com/bcit-tlu/hriv/issues/753)) ([1ae8897](https://github.com/bcit-tlu/hriv/commit/1ae8897b304e642bad027aa03931594d5ffac66e))


### Documentation

* publish production backup and disaster recovery strategy ([#755](https://github.com/bcit-tlu/hriv/issues/755)) ([c89a210](https://github.com/bcit-tlu/hriv/commit/c89a21035f40ba51a2c8088386035ddd745445ba))

## [0.7.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.6.1...backup-v0.7.0) (2026-06-23)


### Features

* **charts:** split source image and tile pvcs ([#739](https://github.com/bcit-tlu/hriv/issues/739)) ([a29bf53](https://github.com/bcit-tlu/hriv/commit/a29bf53fbc212fd5ca1358328aa7788911ecf4b1))

## [0.6.1](https://github.com/bcit-tlu/hriv/compare/backup-v0.6.0...backup-v0.6.1) (2026-05-18)

### Bug Fixes

- **backup:** correct stale S3 reference in run_backup docstring ([#412](https://github.com/bcit-tlu/hriv/issues/412)) ([fa20c91](https://github.com/bcit-tlu/hriv/commit/fa20c910732df1602e830363a9f8ce3a40b3f05c))

## [0.6.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.5.0...backup-v0.6.0) (2026-05-09)

### Features

- add automated maintenance mode for backup restores ([#285](https://github.com/bcit-tlu/hriv/issues/285)) ([98f2d67](https://github.com/bcit-tlu/hriv/commit/98f2d67fbf61ad7cd2f63ae69f03b0484654c71f))

## [0.5.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.4.0...backup-v0.5.0) (2026-04-23)

### Features

- **backup:** add OpenTelemetry instrumentation ([#212](https://github.com/bcit-tlu/hriv/issues/212)) ([24c50a0](https://github.com/bcit-tlu/hriv/commit/24c50a02404d2c9709d1283359dae033c1ee7030))

## [0.4.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.3.1...backup-v0.4.0) (2026-04-22)

### Features

- **version:** split build-identity from display-identity; inject APP_VERSION via Helm ([#197](https://github.com/bcit-tlu/hriv/issues/197)) ([c20730a](https://github.com/bcit-tlu/hriv/commit/c20730adf04497bd52f599e7476b01003c9f937f))

## [0.3.1](https://github.com/bcit-tlu/hriv/compare/backup-v0.3.0...backup-v0.3.1) (2026-04-21)

### Bug Fixes

- **release:** switch to language-specific release types ([#179](https://github.com/bcit-tlu/hriv/issues/179)) ([1ebba10](https://github.com/bcit-tlu/hriv/commit/1ebba106d1ed743087aea2f0f7a3b9905f07af81))

## [0.3.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.2.0...backup-v0.3.0) (2026-04-21)

### Features

- gate footer versions to admins and surface per-component versions ([#149](https://github.com/bcit-tlu/hriv/issues/149)) ([#150](https://github.com/bcit-tlu/hriv/issues/150)) ([b3447dd](https://github.com/bcit-tlu/hriv/commit/b3447dd997a419485b17804b8823d0b0d3c06fda))

## [0.2.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.1.0...backup-v0.2.0) (2026-04-15)

### Features

- add disaster recovery backup service ([1233bc4](https://github.com/bcit-tlu/hriv/commit/1233bc420ab1dca51d941079c1374d27f0ec58ea))
- **ci:** switch to per-component Release Please packages for independent versioning ([de8ff81](https://github.com/bcit-tlu/hriv/commit/de8ff8108da1d4a8af08cc4017de251435d700ba))
- replace S3 with Azure Blob Storage for backup service ([e122462](https://github.com/bcit-tlu/hriv/commit/e122462d8c6c4af86e95e157966e136c69cf91dc))

### Bug Fixes

- add local retention enforcement and include filesystem checksums in manifest ([bcfad00](https://github.com/bcit-tlu/hriv/commit/bcfad009add1ee419a2382013b5664e1843b91e8))
- add ON_ERROR_STOP to psql restore to catch SQL errors ([c20ec79](https://github.com/bcit-tlu/hriv/commit/c20ec7960723519537da9bd1869eee7c008669c8))
- address review findings - tarfile filter, pg16 client, remove unused import, stream filesystem data ([7e02e7a](https://github.com/bcit-tlu/hriv/commit/7e02e7afb9b11e7ae8ba997ed02a0adb6a2de03a))
- make backup glob patterns match both old corgi-backup-_ and new hriv-backup-_ archives ([394bf53](https://github.com/bcit-tlu/hriv/commit/394bf534b287419fb85fa494e29d8dc2fc2bb07e))
- sort mixed-prefix backup archives by timestamp, not filename ([e4d8a94](https://github.com/bcit-tlu/hriv/commit/e4d8a94ce0d59f91a6b0ed01ed0536d68286a917))
- use default Trixie postgresql-client (PG 17, backward-compatible with PG 16 server) ([60fa284](https://github.com/bcit-tlu/hriv/commit/60fa284ffbedd6cee44f03aeabeabc175920f2cb))
- use python:3.13-slim-bookworm + postgresql-client-16 to match PG 16 server ([af13808](https://github.com/bcit-tlu/hriv/commit/af138082ecb2edd6b808eeacc9b1f14e3706d7ac))

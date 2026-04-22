# Changelog

## [0.4.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.3.1...backup-v0.4.0) (2026-04-22)


### Features

* **version:** split build-identity from display-identity; inject APP_VERSION via Helm ([#197](https://github.com/bcit-tlu/hriv/issues/197)) ([c20730a](https://github.com/bcit-tlu/hriv/commit/c20730adf04497bd52f599e7476b01003c9f937f))

## [0.3.1](https://github.com/bcit-tlu/hriv/compare/backup-v0.3.0...backup-v0.3.1) (2026-04-21)


### Bug Fixes

* **release:** switch to language-specific release types ([#179](https://github.com/bcit-tlu/hriv/issues/179)) ([1ebba10](https://github.com/bcit-tlu/hriv/commit/1ebba106d1ed743087aea2f0f7a3b9905f07af81))

## [0.3.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.2.0...backup-v0.3.0) (2026-04-21)


### Features

* gate footer versions to admins and surface per-component versions ([#149](https://github.com/bcit-tlu/hriv/issues/149)) ([#150](https://github.com/bcit-tlu/hriv/issues/150)) ([b3447dd](https://github.com/bcit-tlu/hriv/commit/b3447dd997a419485b17804b8823d0b0d3c06fda))

## [0.2.0](https://github.com/bcit-tlu/hriv/compare/backup-v0.1.0...backup-v0.2.0) (2026-04-15)


### Features

* add disaster recovery backup service ([1233bc4](https://github.com/bcit-tlu/hriv/commit/1233bc420ab1dca51d941079c1374d27f0ec58ea))
* **ci:** switch to per-component Release Please packages for independent versioning ([de8ff81](https://github.com/bcit-tlu/hriv/commit/de8ff8108da1d4a8af08cc4017de251435d700ba))
* replace S3 with Azure Blob Storage for backup service ([e122462](https://github.com/bcit-tlu/hriv/commit/e122462d8c6c4af86e95e157966e136c69cf91dc))


### Bug Fixes

* add local retention enforcement and include filesystem checksums in manifest ([bcfad00](https://github.com/bcit-tlu/hriv/commit/bcfad009add1ee419a2382013b5664e1843b91e8))
* add ON_ERROR_STOP to psql restore to catch SQL errors ([c20ec79](https://github.com/bcit-tlu/hriv/commit/c20ec7960723519537da9bd1869eee7c008669c8))
* address review findings - tarfile filter, pg16 client, remove unused import, stream filesystem data ([7e02e7a](https://github.com/bcit-tlu/hriv/commit/7e02e7afb9b11e7ae8ba997ed02a0adb6a2de03a))
* make backup glob patterns match both old corgi-backup-* and new hriv-backup-* archives ([394bf53](https://github.com/bcit-tlu/hriv/commit/394bf534b287419fb85fa494e29d8dc2fc2bb07e))
* sort mixed-prefix backup archives by timestamp, not filename ([e4d8a94](https://github.com/bcit-tlu/hriv/commit/e4d8a94ce0d59f91a6b0ed01ed0536d68286a917))
* use default Trixie postgresql-client (PG 17, backward-compatible with PG 16 server) ([60fa284](https://github.com/bcit-tlu/hriv/commit/60fa284ffbedd6cee44f03aeabeabc175920f2cb))
* use python:3.13-slim-bookworm + postgresql-client-16 to match PG 16 server ([af13808](https://github.com/bcit-tlu/hriv/commit/af138082ecb2edd6b808eeacc9b1f14e3706d7ac))

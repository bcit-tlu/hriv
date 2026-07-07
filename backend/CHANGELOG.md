# Changelog

## [0.29.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.28.0...backend-v0.29.0) (2026-07-07)


### Features

* **admin:** per-file restore from backup snapshots via Admin UI ([#828](https://github.com/bcit-tlu/hriv/issues/828)) ([dc047ae](https://github.com/bcit-tlu/hriv/commit/dc047aeb7f62b827bc03febf342d604d9348c742))
* **admin:** source-images-only filesystem export with scan-phase progress and cancellation ([#821](https://github.com/bcit-tlu/hriv/issues/821)) ([c3eae16](https://github.com/bcit-tlu/hriv/commit/c3eae1622918b612bf4ea9f497206297d800d083))


### Bug Fixes

* **admin:** cap pigz parallelism for filesystem export ([#829](https://github.com/bcit-tlu/hriv/issues/829)) ([87516ad](https://github.com/bcit-tlu/hriv/commit/87516ade040dc6ad13a1d1963b3b4a8bc54310d7))
* **admin:** handle session loss during import and make task cancel idempotent ([#820](https://github.com/bcit-tlu/hriv/issues/820)) ([067fb77](https://github.com/bcit-tlu/hriv/commit/067fb776a1af4eddbb3c06c5d70b10a6828c173c))

## [0.28.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.27.1...backend-v0.28.0) (2026-07-03)


### Features

* **backend:** add Teams feedback delivery ([#802](https://github.com/bcit-tlu/hriv/issues/802)) ([2fe8ca3](https://github.com/bcit-tlu/hriv/commit/2fe8ca30cc08878356700822e6d4fddd8fe8a2b5))

## [0.27.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.27.0...backend-v0.27.1) (2026-07-03)


### Bug Fixes

* **backend:** prevent zone anti-affinity rolling-update deadlock ([#798](https://github.com/bcit-tlu/hriv/issues/798)) ([01719a6](https://github.com/bcit-tlu/hriv/commit/01719a6415eb83fa7c444df1c81738b64a448cd3))


### Documentation

* **backend:** document Grafana dashboard filename constraint ([#797](https://github.com/bcit-tlu/hriv/issues/797)) ([c2ccf84](https://github.com/bcit-tlu/hriv/commit/c2ccf848c10fbc423380f4fe456c31bed01fe206))

## [0.27.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.26.0...backend-v0.27.0) (2026-07-02)


### Features

* abstract feedback delivery config ([#791](https://github.com/bcit-tlu/hriv/issues/791)) ([67bba5d](https://github.com/bcit-tlu/hriv/commit/67bba5dbad2a998b9e5fd3ecb197cb390dd13c8a))


### Bug Fixes

* **backend:** reject blank required strings and harden ORM serializers ([#783](https://github.com/bcit-tlu/hriv/issues/783)) ([b7dcad4](https://github.com/bcit-tlu/hriv/commit/b7dcad4809eb910df4b0751ffd0dfdd7227f431e))
* **frontend:** disable non-member program chips + name program in attach error ([#629](https://github.com/bcit-tlu/hriv/issues/629)) ([#778](https://github.com/bcit-tlu/hriv/issues/778)) ([8b5f6c8](https://github.com/bcit-tlu/hriv/commit/8b5f6c8179229c7bd8fb532d2bf68463371a0371))

## [0.26.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.25.1...backend-v0.26.0) (2026-06-30)


### Features

* **people:** chip-based program and group filters on People table ([#761](https://github.com/bcit-tlu/hriv/issues/761)) ([62e5e02](https://github.com/bcit-tlu/hriv/commit/62e5e02ec64c9b77cf27566b5320f68cc28ce3d3))

## [0.25.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.25.0...backend-v0.25.1) (2026-06-29)


### Bug Fixes

* **people:** resolve user update 500, save feedback, deleted program UX, delete dialog UX ([#758](https://github.com/bcit-tlu/hriv/issues/758)) ([e591388](https://github.com/bcit-tlu/hriv/commit/e5913889ca8298614258538438d34d5ba8982bf1))

## [0.25.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.24.1...backend-v0.25.0) (2026-06-24)


### Features

* **backend:** add rebuild-tiles admin task for missing or stale tiles ([#751](https://github.com/bcit-tlu/hriv/issues/751)) ([e91aa6b](https://github.com/bcit-tlu/hriv/commit/e91aa6b0664a55aa14a4a81fa0c1dd83a43f3201))
* **backend:** track tile-cache provenance and staleness ([#747](https://github.com/bcit-tlu/hriv/issues/747)) ([44d2c23](https://github.com/bcit-tlu/hriv/commit/44d2c2354ef4020744c39ee19e5e72ab48eecb4d))

## [0.24.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.24.0...backend-v0.24.1) (2026-06-23)


### Bug Fixes

* **backend:** document split persistence layout ([#745](https://github.com/bcit-tlu/hriv/issues/745)) ([4c1c84d](https://github.com/bcit-tlu/hriv/commit/4c1c84dceaf15e1ba2dd9f046d3c21d9ace62352))

## [0.24.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.23.0...backend-v0.24.0) (2026-06-19)


### Features

* 667 image note metadata field should allow more characters ([#686](https://github.com/bcit-tlu/hriv/issues/686)) ([2a864f8](https://github.com/bcit-tlu/hriv/commit/2a864f89f877f10e2c179a771c8e8448d1e6c8fd))

## [0.23.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.22.0...backend-v0.23.0) (2026-06-18)

### Features

- add changelog notifications for instructors ([#696](https://github.com/bcit-tlu/hriv/issues/696)) ([9f0e365](https://github.com/bcit-tlu/hriv/commit/9f0e3656a3d9fbf09bce0a99bc4f0ea7ae0d314d))
- add optimistic concurrency control to category mutations ([#672](https://github.com/bcit-tlu/hriv/issues/672)) ([8a55eac](https://github.com/bcit-tlu/hriv/commit/8a55eac89aab08dc00cd19c6b4ef8331b51a307f))

### Bug Fixes

- clean up test fixtures and remove unnecessary fetchStatus headers ([#678](https://github.com/bcit-tlu/hriv/issues/678)) ([cc1d76c](https://github.com/bcit-tlu/hriv/commit/cc1d76cbc47301c52e3698f2c8675ad327a56c3a))
- filter 4xx HTTPExceptions from OTel span error recording ([#671](https://github.com/bcit-tlu/hriv/issues/671)) ([515f406](https://github.com/bcit-tlu/hriv/commit/515f4066f3829db21eb5a5a18f661f7aac3409fd))

## [0.22.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.21.0...backend-v0.22.0) (2026-06-10)

### Features

- add groups backend (PR2 of groups refactor) ([#604](https://github.com/bcit-tlu/hriv/issues/604)) ([ebc6e33](https://github.com/bcit-tlu/hriv/commit/ebc6e33596998e08c82c1fec5f3000038eb54f9a))
- paginate/filter user listing + expose group memberships in /me ([#617](https://github.com/bcit-tlu/hriv/issues/617)) ([e282835](https://github.com/bcit-tlu/hriv/commit/e282835e5f2e0844f24ae4e280ca2e11826cae2e))

### Bug Fixes

- harden /api/issues/report against PII leakage and abuse ([#625](https://github.com/bcit-tlu/hriv/issues/625)) ([bb3471c](https://github.com/bcit-tlu/hriv/commit/bb3471cac34a39b72ecc2c5c48113959840b3ab6))
- make category optional for bulk import and display root selection ([#632](https://github.com/bcit-tlu/hriv/issues/632)) ([a602ce7](https://github.com/bcit-tlu/hriv/commit/a602ce742fdd8799430fc5dc3dee3f7b5f44696d))

## [0.21.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.20.1...backend-v0.21.0) (2026-06-05)

### ⚠ BREAKING CHANGES

- remove tenant/cohort program model ([#601](https://github.com/bcit-tlu/hriv/issues/601))

### Features

- remove tenant/cohort program model ([#601](https://github.com/bcit-tlu/hriv/issues/601)) ([818203e](https://github.com/bcit-tlu/hriv/commit/818203ea4ada1e9a697e748f3c7ed4313fcf551c))

## [0.20.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.20.0...backend-v0.20.1) (2026-06-05)

### Bug Fixes

- allow instructors to delete images and categories ([#598](https://github.com/bcit-tlu/hriv/issues/598)) ([e37f0a6](https://github.com/bcit-tlu/hriv/commit/e37f0a6d1bfa56686cc5f23be815db4337919f04))
- normalize email case across all auth paths and cache role mapping ([#590](https://github.com/bcit-tlu/hriv/issues/590)) ([a7e9cc3](https://github.com/bcit-tlu/hriv/commit/a7e9cc36f55156c9e96aaf94bdf171c2978fcc35))

## [0.20.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.19.2...backend-v0.20.0) (2026-06-05)

### Features

- instructor-scoped program (cohort) management ([#581](https://github.com/bcit-tlu/hriv/issues/581)) ([b4ec9c2](https://github.com/bcit-tlu/hriv/commit/b4ec9c2a5906ce3449966ef62f9d5b7076e415ee))

## [0.19.2](https://github.com/bcit-tlu/hriv/compare/backend-v0.19.1...backend-v0.19.2) (2026-06-04)

### Bug Fixes

- **oidc:** case-insensitive email matching and role resolution logging ([#574](https://github.com/bcit-tlu/hriv/issues/574)) ([ef8da2a](https://github.com/bcit-tlu/hriv/commit/ef8da2ad5b2a235483e8518a9d42a496e31ce3c9))

## [0.19.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.19.0...backend-v0.19.1) (2026-06-03)

### Bug Fixes

- resolve OIDC roles by priority instead of token order ([#562](https://github.com/bcit-tlu/hriv/issues/562)) ([9593898](https://github.com/bcit-tlu/hriv/commit/959389852588d49b0d55d570bf3ef118b12ca637))

## [0.19.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.18.1...backend-v0.19.0) (2026-06-02)

### Features

- add sort_order to images for ordering/placement support ([#531](https://github.com/bcit-tlu/hriv/issues/531)) ([453e291](https://github.com/bcit-tlu/hriv/commit/453e291f55b654603d66191484426f3a078d51a8))

## [0.18.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.18.0...backend-v0.18.1) (2026-05-27)

### Bug Fixes

- **backend:** refresh programs before assignment in create_user ([#522](https://github.com/bcit-tlu/hriv/issues/522)) ([bbd5afc](https://github.com/bcit-tlu/hriv/commit/bbd5afce3f00849af288d2736fc37481a794eb45))

## [0.18.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.17.4...backend-v0.18.0) (2026-05-25)

### Features

- **frontend:** PeoplePage bulk management, filters, pagination, and program pills ([#482](https://github.com/bcit-tlu/hriv/issues/482)) ([20558b1](https://github.com/bcit-tlu/hriv/commit/20558b1d638e308cb25f537c070a0812a179a40c))

## [0.17.4](https://github.com/bcit-tlu/hriv/compare/backend-v0.17.3...backend-v0.17.4) (2026-05-25)

### Bug Fixes

- **backend:** allow instructors to see people in search results ([#478](https://github.com/bcit-tlu/hriv/issues/478)) ([1c013e6](https://github.com/bcit-tlu/hriv/commit/1c013e6c12bccb944fab725399d20f6413eddc38))

## [0.17.3](https://github.com/bcit-tlu/hriv/compare/backend-v0.17.2...backend-v0.17.3) (2026-05-25)

### Bug Fixes

- **backend:** remove PII from GitHub issue reports ([#474](https://github.com/bcit-tlu/hriv/issues/474)) ([31609ae](https://github.com/bcit-tlu/hriv/commit/31609aef657e76b104b195341dfddec4c0f2205f))

## [0.17.2](https://github.com/bcit-tlu/hriv/compare/backend-v0.17.1...backend-v0.17.2) (2026-05-25)

### Bug Fixes

- **backend:** prioritize isinstance check in exception handler + add migration role tests ([#467](https://github.com/bcit-tlu/hriv/issues/467)) ([5dd5bc5](https://github.com/bcit-tlu/hriv/commit/5dd5bc538ac2edfa80414a3c9c861b2cb9a6092d))

## [0.17.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.17.0...backend-v0.17.1) (2026-05-25)

### Bug Fixes

- **backend:** extract shared get_client_ip and configure proxy headers ([#461](https://github.com/bcit-tlu/hriv/issues/461)) ([04bff47](https://github.com/bcit-tlu/hriv/commit/04bff476436d9c41c66d0832980e1bfbac80c3ea))

## [0.17.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.16.0...backend-v0.17.0) (2026-05-20)

### Features

- enforce program-scoped student visibility filtering in API ([#431](https://github.com/bcit-tlu/hriv/issues/431)) ([7a4228a](https://github.com/bcit-tlu/hriv/commit/7a4228ad8a261b9d276147ef5966d0da1cf76f81))
- OIDC group-to-program mapping for automated user provisioning ([#432](https://github.com/bcit-tlu/hriv/issues/432)) ([d602c35](https://github.com/bcit-tlu/hriv/commit/d602c3584e42144a260b9a9fcb020a97feb3586b))
- remove image-level program associations ([#386](https://github.com/bcit-tlu/hriv/issues/386), [#387](https://github.com/bcit-tlu/hriv/issues/387), [#396](https://github.com/bcit-tlu/hriv/issues/396)) ([#422](https://github.com/bcit-tlu/hriv/issues/422)) ([29918ab](https://github.com/bcit-tlu/hriv/commit/29918abb1e471ca985fbf56e55a2963cf95d533f))

## [0.16.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.15.0...backend-v0.16.0) (2026-05-19)

### Features

- cancel orphaned tasks on upload failure + atomic replace-image ([#418](https://github.com/bcit-tlu/hriv/issues/418)) ([e8be0f3](https://github.com/bcit-tlu/hriv/commit/e8be0f3448f6ef6507c9d245655cfd2a3830c8ac))

## [0.15.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.14.1...backend-v0.15.0) (2026-05-18)

### Features

- add OpenTelemetry tracing to image and bulk import operations ([#366](https://github.com/bcit-tlu/hriv/issues/366)) ([345b85a](https://github.com/bcit-tlu/hriv/commit/345b85ac819bccfe63edc370e2baa04c158e8d55))

### Bug Fixes

- add pre-flight schema privilege check to Alembic bootstrap ([#380](https://github.com/bcit-tlu/hriv/issues/380)) ([19f22df](https://github.com/bcit-tlu/hriv/commit/19f22df621a23afddc899bdb7f45909be498b10f))
- preserve OpenTelemetry LoggingHandler during logging setup ([#378](https://github.com/bcit-tlu/hriv/issues/378)) ([393349d](https://github.com/bcit-tlu/hriv/commit/393349d7da846f29fdfcfe9886c61f2d8e722d19))

## [0.14.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.14.0...backend-v0.14.1) (2026-05-12)

### Bug Fixes

- check actual table ownership before SET ROLE in migration 0003 ([#357](https://github.com/bcit-tlu/hriv/issues/357)) ([eac57c8](https://github.com/bcit-tlu/hriv/commit/eac57c84577ed595e75e59261d7e4ce49747d136))
- fall back to inherited role when DB owner is not assumable ([#356](https://github.com/bcit-tlu/hriv/issues/356)) ([793485f](https://github.com/bcit-tlu/hriv/commit/793485f336e4599198b6b16614983d5af3cac04e))
- migration 0003 silent failure — introspect FK name + fix logger suppression ([#352](https://github.com/bcit-tlu/hriv/issues/352)) ([17c18ab](https://github.com/bcit-tlu/hriv/commit/17c18abbef2533e0698bed171899aa93d24536e4))
- SET ROLE to DB owner before DDL in migration 0003 ([#354](https://github.com/bcit-tlu/hriv/issues/354)) ([e50643f](https://github.com/bcit-tlu/hriv/commit/e50643f6e00baaae8c800fa1e51f41511594bbd4))

## [0.14.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.13.0...backend-v0.14.0) (2026-05-11)

### Features

- add exception recording and error status to admin and bulk impo… ([#350](https://github.com/bcit-tlu/hriv/issues/350)) ([4d21921](https://github.com/bcit-tlu/hriv/commit/4d21921ad551f5cf5d3da6888df2273e9ea3f3e8))

## [0.13.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.12.0...backend-v0.13.0) (2026-05-11)

### Features

- add exception recording and error status to worker OTEL spans ([#343](https://github.com/bcit-tlu/hriv/issues/343)) ([a1d98c2](https://github.com/bcit-tlu/hriv/commit/a1d98c289e4cffbc6edb89c5021003fbb43ff135))

## [0.12.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.11.0...backend-v0.12.0) (2026-05-11)

### Features

- implement RBAC with program-scoped category visibility ([#327](https://github.com/bcit-tlu/hriv/issues/327)) ([b8c5ee7](https://github.com/bcit-tlu/hriv/commit/b8c5ee71ba47b5d4dad80ca0ba9a9f8b0bf29e8f))

## [0.11.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.10.0...backend-v0.11.0) (2026-05-09)

### Features

- propagate user identity to OTEL trace spans ([#319](https://github.com/bcit-tlu/hriv/issues/319)) ([240a2d2](https://github.com/bcit-tlu/hriv/commit/240a2d2462839dd315822911f815bf94ad62b6b8))
- reject duplicate category names within same parent ([#311](https://github.com/bcit-tlu/hriv/issues/311)) ([9a06a1b](https://github.com/bcit-tlu/hriv/commit/9a06a1b65705e6c54d4c46f2059bb932b346e3f9))

### Bug Fixes

- exclude OIDC subject and password hash from admin export ([#316](https://github.com/bcit-tlu/hriv/issues/316)) ([10e1ac9](https://github.com/bcit-tlu/hriv/commit/10e1ac9118d95ad2aeeccf763d8c840261520509))

## [0.10.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.9.0...backend-v0.10.0) (2026-05-06)

### Features

- add automated maintenance mode for backup restores ([#285](https://github.com/bcit-tlu/hriv/issues/285)) ([98f2d67](https://github.com/bcit-tlu/hriv/commit/98f2d67fbf61ad7cd2f63ae69f03b0484654c71f))
- detect pyramidal TIFF/SVS metadata and auto-populate measurement config ([#307](https://github.com/bcit-tlu/hriv/issues/307)) ([893e4df](https://github.com/bcit-tlu/hriv/commit/893e4df570cb12d172ca698c1968350f0a2c6c60))

### Bug Fixes

- return 507 on disk-full instead of unhandled 500 ([#299](https://github.com/bcit-tlu/hriv/issues/299)) ([2f5fa19](https://github.com/bcit-tlu/hriv/commit/2f5fa191170f1bed8396e6d8b0454685899a0f17))
- show zip upload progress ([#291](https://github.com/bcit-tlu/hriv/issues/291)) ([38ff8b7](https://github.com/bcit-tlu/hriv/commit/38ff8b76a11a5ab7eb1c4db9464a5fa360e66d18))

## [0.9.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.8.2...backend-v0.9.0) (2026-05-03)

### Features

- **chart/backend:** add Redis and arq worker support ([#245](https://github.com/bcit-tlu/hriv/issues/245)) ([206cb86](https://github.com/bcit-tlu/hriv/commit/206cb86ddac474f6b90146ffcc63ff8cc67f48a4))
- implement image replacement in Edit Image modal ([#261](https://github.com/bcit-tlu/hriv/issues/261)) ([d916541](https://github.com/bcit-tlu/hriv/commit/d916541c58d5db5bcf5b1c53bacab763c5c65cd0))
- robust filesystem import with progress tracking and cancellation ([#258](https://github.com/bcit-tlu/hriv/issues/258)) ([50a0c0f](https://github.com/bcit-tlu/hriv/commit/50a0c0f1b33cec6bccf75741971a313c1cf11a65))

### Bug Fixes

- **backend:** add actionable error messages for bootstrap connection failures ([#230](https://github.com/bcit-tlu/hriv/issues/230)) ([e456c34](https://github.com/bcit-tlu/hriv/commit/e456c34d9c148ea8e5b0e117173a187c76ba7a51))
- **backend:** use reporter role instead of name in issue title ([#226](https://github.com/bcit-tlu/hriv/issues/226)) ([33e0a72](https://github.com/bcit-tlu/hriv/commit/33e0a72fc2eae2b527c0b172c95890cf2cf6a1c1))
- **otel:** bootstrap SDK in uvicorn --reload child processes ([#249](https://github.com/bcit-tlu/hriv/issues/249)) ([b63e9fe](https://github.com/bcit-tlu/hriv/commit/b63e9fe8f66d1b1e555981920bacb276c871a4c9))

## [0.8.2](https://github.com/bcit-tlu/hriv/compare/backend-v0.8.1...backend-v0.8.2) (2026-04-23)

### Bug Fixes

- **backend:** improve issue report title, body order, and labeling ([#218](https://github.com/bcit-tlu/hriv/issues/218)) ([118584a](https://github.com/bcit-tlu/hriv/commit/118584a573ad15b40b1d076e5c4edb0a3dc8332b))

## [0.8.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.8.0...backend-v0.8.1) (2026-04-23)

### Bug Fixes

- **backend:** normalize GITHUB_REPO to owner/repo format at startup ([#211](https://github.com/bcit-tlu/hriv/issues/211)) ([6237a90](https://github.com/bcit-tlu/hriv/commit/6237a9093a7188c67c4a93da118174ca3559979a))

## [0.8.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.7.1...backend-v0.8.0) (2026-04-22)

### Features

- **version:** split build-identity from display-identity; inject APP_VERSION via Helm ([#197](https://github.com/bcit-tlu/hriv/issues/197)) ([c20730a](https://github.com/bcit-tlu/hriv/commit/c20730adf04497bd52f599e7476b01003c9f937f))

## [0.7.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.7.0...backend-v0.7.1) (2026-04-21)

### Bug Fixes

- **backend:** log app version on startup ([#183](https://github.com/bcit-tlu/hriv/issues/183)) ([bf37b85](https://github.com/bcit-tlu/hriv/commit/bf37b85192dd605d7dd7f1cd147cbd35a644fb3c))
- **release:** switch to language-specific release types ([#179](https://github.com/bcit-tlu/hriv/issues/179)) ([1ebba10](https://github.com/bcit-tlu/hriv/commit/1ebba106d1ed743087aea2f0f7a3b9905f07af81))

## [0.7.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.6.0...backend-v0.7.0) (2026-04-21)

### Features

- **versions:** auto-publish backup version via ConfigMap mount ([#155](https://github.com/bcit-tlu/hriv/issues/155)) ([0ce22ec](https://github.com/bcit-tlu/hriv/commit/0ce22ecc6ff0c5c48eb58402a81dff7c598e3d95))

### Bug Fixes

- **backend:** include app version in health endpoint response ([#164](https://github.com/bcit-tlu/hriv/issues/164)) ([3906a27](https://github.com/bcit-tlu/hriv/commit/3906a27a710af94eda14eeeccb8e062b78c64799))
- **backend:** include app version in readiness probe response ([#169](https://github.com/bcit-tlu/hriv/issues/169)) ([2fd67cc](https://github.com/bcit-tlu/hriv/commit/2fd67ccea8980eae590ee95ce625772b0ec9db05))
- **backend:** read FastAPI version from APP_VERSION env var ([#160](https://github.com/bcit-tlu/hriv/issues/160)) ([d637f0a](https://github.com/bcit-tlu/hriv/commit/d637f0a45525cc40febea6a39fb0e2a8c74616d7))
- **release:** reset manifest to last stable version for clean 0.7.0 graduation ([#176](https://github.com/bcit-tlu/hriv/issues/176)) ([2c0d2fc](https://github.com/bcit-tlu/hriv/commit/2c0d2fc0d65885b46741689147aa7e751976747e))
- **release:** use rc1 prerelease format instead of rc.1 ([#166](https://github.com/bcit-tlu/hriv/issues/166)) ([277045b](https://github.com/bcit-tlu/hriv/commit/277045b79fdbc652ba1b9864de5fa0f591af324f))
- remove unused release graduation markers to trigger stable releases ([#173](https://github.com/bcit-tlu/hriv/issues/173)) ([b59d14a](https://github.com/bcit-tlu/hriv/commit/b59d14a5fcb8a315d095641302b565f94283faf9))

## [0.7.0-rc3](https://github.com/bcit-tlu/hriv/compare/backend-v0.7.0-rc2...backend-v0.7.0-rc3) (2026-04-21)

### Bug Fixes

- **backend:** include app version in readiness probe response ([#169](https://github.com/bcit-tlu/hriv/issues/169)) ([2fd67cc](https://github.com/bcit-tlu/hriv/commit/2fd67ccea8980eae590ee95ce625772b0ec9db05))

## [0.7.0-rc2](https://github.com/bcit-tlu/hriv/compare/backend-v0.7.0-rc1...backend-v0.7.0-rc2) (2026-04-21)

### Features

- add drag-and-drop reordering to Manage Categories dialog ([444ec21](https://github.com/bcit-tlu/hriv/commit/444ec21c30df24370d44eada69b60518d64a6b83))
- add processing progress percentage to snackbar ([5c7197b](https://github.com/bcit-tlu/hriv/commit/5c7197b3b0c5f04058f39f23a134a4bda2b83d09))
- add server-side concurrency guard for background admin tasks ([c47b775](https://github.com/bcit-tlu/hriv/commit/c47b775f0dcd4449235bc67c1979b3209588f23d))
- add task cancellation with cancel button in UI ([1a60d7d](https://github.com/bcit-tlu/hriv/commit/1a60d7dfc79b90de07f7b69510f8e4128d15f339))
- **admin:** auto-scroll log viewer, byte-based export progress, force-cancel fix ([3a4d240](https://github.com/bcit-tlu/hriv/commit/3a4d24095b96f1ad0c6dfef963d24a83c5e702c2))
- **auth:** enforce JWT_SECRET via REQUIRE_JWT_SECRET flag ([6106b03](https://github.com/bcit-tlu/hriv/commit/6106b03482b19e6c538bb3773b3b860117b1eafa))
- **auth:** enforce JWT_SECRET via REQUIRE_JWT_SECRET flag ([d9ba89d](https://github.com/bcit-tlu/hriv/commit/d9ba89da7f8e58f05bc1e52fe6cd79bd513e0973))
- **backend:** adopt Alembic for database migrations ([68685c2](https://github.com/bcit-tlu/hriv/commit/68685c23f50f060fdef18854c77b8a7039b77117))
- **backend:** adopt Alembic for database migrations ([72d8115](https://github.com/bcit-tlu/hriv/commit/72d811577e58b8a190f18e93449d2f0ca8b63353))
- **backend:** wrap uvicorn with opentelemetry-instrument in production ([0e7b7e7](https://github.com/bcit-tlu/hriv/commit/0e7b7e7a639bb8fb39db5a8de1c4eb53aae99f9d))
- center-crop card thumbnails for recognisable image previews ([#140](https://github.com/bcit-tlu/hriv/issues/140)) ([ec9f31c](https://github.com/bcit-tlu/hriv/commit/ec9f31c3db00de849c66765b74c081794d6225df))
- **ci:** switch to per-component Release Please packages for independent versioning ([de8ff81](https://github.com/bcit-tlu/hriv/commit/de8ff8108da1d4a8af08cc4017de251435d700ba))
- decouple admin import/export into background tasks with snackbar notifications ([374a197](https://github.com/bcit-tlu/hriv/commit/374a197318125f062b5ee214b964935cffc8b80a))
- display image dimensions and file size on image cards ([8f1b244](https://github.com/bcit-tlu/hriv/commit/8f1b2447e5981d1bcb14929e503ffed2b4790365))
- gate footer versions to admins and surface per-component versions ([#149](https://github.com/bcit-tlu/hriv/issues/149)) ([#150](https://github.com/bcit-tlu/hriv/issues/150)) ([b3447dd](https://github.com/bcit-tlu/hriv/commit/b3447dd997a419485b17804b8823d0b0d3c06fda))
- granular progress tracking via pyvips eval signals and status messages ([571b268](https://github.com/bcit-tlu/hriv/commit/571b268fddf9340b138b310fc8bdbf7d72ac57be))
- mirror Add Image fields in Bulk Import modal via shared ImageMetadataFields component ([6a73c6b](https://github.com/bcit-tlu/hriv/commit/6a73c6bd65cfa7467bbb789ae234f53a3ac53fa8))
- Phase 4 — Performance (nginx tile sidecar + optimised category tree) ([afd9912](https://github.com/bcit-tlu/hriv/commit/afd99122ebdf1fc43eb20bd898d28743d2f085c5))
- Phase 5 — Refinements (optimistic concurrency, task queue, rate limiting) ([178de9c](https://github.com/bcit-tlu/hriv/commit/178de9cb51a476ebdc0942178a755783d2cc0e42))
- reduce health check log noise in local dev ([537a3ee](https://github.com/bcit-tlu/hriv/commit/537a3ee6cab543f168c993c06516ba5ac8272ad0))
- **versions:** auto-publish backup version via ConfigMap mount ([#155](https://github.com/bcit-tlu/hriv/issues/155)) ([0ce22ec](https://github.com/bcit-tlu/hriv/commit/0ce22ecc6ff0c5c48eb58402a81dff7c598e3d95))

### Bug Fixes

- add progress and file_size to admin test mock ([fe7b21c](https://github.com/bcit-tlu/hriv/commit/fe7b21c964effe520a22238eb59a4b01fea27584))
- add redis as explicit dependency in pyproject.toml ([a382f4f](https://github.com/bcit-tlu/hriv/commit/a382f4fd2fdf4cc1f75b434b8055ad17c96a3a1e))
- add session.rollback() before error handlers in single-session task runners ([7df7361](https://github.com/bcit-tlu/hriv/commit/7df7361c9da906ee1014a59340172fcbae4f788b))
- address Devin Review findings — sidecar placement + 304 headers ([e325b66](https://github.com/bcit-tlu/hriv/commit/e325b666350ae65287ca15c68cd3af1b558ca21d))
- address review findings — revert arq in bulk import, fix stale version on clear overlays ([3fc53c0](https://github.com/bcit-tlu/hriv/commit/3fc53c08648ca17c49a37190b273ea6c8359bc36))
- **admin_ops:** keep os.rename for same-fs sibling moves to preserve rollback safety ([c23d18a](https://github.com/bcit-tlu/hriv/commit/c23d18a45bff4a3eb9826c87460bbcae689bea8a))
- **admin_ops:** use shutil.move for cross-filesystem safe renames ([d611574](https://github.com/bcit-tlu/hriv/commit/d611574609f9477cb7e4137c12b6f70d0bdf4c43))
- **admin:** allow force-cancel and reconcile orphaned admin tasks on startup ([f6b5434](https://github.com/bcit-tlu/hriv/commit/f6b5434f421f6b348827ec5c07c97daefb708e56))
- **admin:** format leftover queue entries as 'adding &lt;name&gt;' not tuples ([6e4a774](https://github.com/bcit-tlu/hriv/commit/6e4a774c91965968c1778ec2e901e7f16af6b099))
- allow students to read programs (GET endpoints) ([e5153c3](https://github.com/bcit-tlu/hriv/commit/e5153c3732f6bc04ac80625491320b23f6a1c2f8))
- **auth:** derive jwt_instance_epoch from JWT_SECRET for multi-worker consistency ([3c26b2d](https://github.com/bcit-tlu/hriv/commit/3c26b2d69fee25fc27ea2e6c45ac1b3ca1233024))
- **backend:** address Devin Review findings for PR [#95](https://github.com/bcit-tlu/hriv/issues/95) ([677a0e6](https://github.com/bcit-tlu/hriv/commit/677a0e6415a286291a556443caa6f5a21687076d))
- **backend:** align Alembic baseline with SQLAlchemy model nullability/indexes ([9e594e3](https://github.com/bcit-tlu/hriv/commit/9e594e34356667ce09ce5354b8a53098feb07829))
- **backend:** align Alembic baseline with SQLAlchemy model nullability/indexes ([ba7c746](https://github.com/bcit-tlu/hriv/commit/ba7c7463d0398fae4c7c9927b82e271d3b18f91c))
- **backend:** async advisory lock + name remaining status indexes ([97eb523](https://github.com/bcit-tlu/hriv/commit/97eb5235bbe61ec2839fb833e837ba687fbc63bc))
- **backend:** async advisory lock + name remaining status indexes ([2e93f70](https://github.com/bcit-tlu/hriv/commit/2e93f7049db59fe9f0c7cab685b96b4cbc9c3a13))
- **backend:** clean up merge markers in README + stamp specific baseline ([92c706a](https://github.com/bcit-tlu/hriv/commit/92c706a8fc9ff4480597953765732de1b4620fc1))
- **backend:** clean up merge markers in README + stamp specific baseline ([d9752a0](https://github.com/bcit-tlu/hriv/commit/d9752a04c2c682d11e56482b4c9fb85983fc58e1))
- **backend:** dedupe COPY and OpenTelemetry deps, restore legacy-stamp branch ([3dc2bfc](https://github.com/bcit-tlu/hriv/commit/3dc2bfc2524b12fa337cd0aa26e46f1000e1542d))
- **backend:** disable OTEL exporters by default in Docker image ([24baf4f](https://github.com/bcit-tlu/hriv/commit/24baf4f3af1e947c49b75cb088aa693979e4e40d))
- **backend:** handle empty alembic_version left by failed prior migration ([a8c910b](https://github.com/bcit-tlu/hriv/commit/a8c910b452107879ba9e9325e2cae48f73b2c8b0))
- **backend:** include app version in health endpoint response ([#164](https://github.com/bcit-tlu/hriv/issues/164)) ([3906a27](https://github.com/bcit-tlu/hriv/commit/3906a27a710af94eda14eeeccb8e062b78c64799))
- **backend:** offload Alembic to worker thread + align server_defaults ([1778bb9](https://github.com/bcit-tlu/hriv/commit/1778bb93172cc9f093383b4401b600934917f6db))
- **backend:** offload Alembic to worker thread + align server_defaults ([dd51d7f](https://github.com/bcit-tlu/hriv/commit/dd51d7f7788df0ba13c704a4a7e48bdc53d47247))
- **backend:** pg_advisory_lock bootstrap + name indexes to match baseline ([1abdf82](https://github.com/bcit-tlu/hriv/commit/1abdf82eb302375c9b59877bf438dd06829281ee))
- **backend:** pg_advisory_lock bootstrap + name indexes to match baseline ([f6549be](https://github.com/bcit-tlu/hriv/commit/f6549bef8c98abce2615f4eefb37183a75bcb65f))
- **backend:** read FastAPI version from APP_VERSION env var ([#160](https://github.com/bcit-tlu/hriv/issues/160)) ([d637f0a](https://github.com/bcit-tlu/hriv/commit/d637f0a45525cc40febea6a39fb0e2a8c74616d7))
- **backend:** restore legacy-schema stamp in Alembic bootstrap ([1fb998f](https://github.com/bcit-tlu/hriv/commit/1fb998fa649a9fafd915442bfb7bf7ea4e00e738))
- **backend:** run 'upgrade head' after stamping baseline on legacy DBs ([2040d7b](https://github.com/bcit-tlu/hriv/commit/2040d7b1cc251cc299f97aba5ac1e331d2f9617e))
- **backend:** run 'upgrade head' after stamping baseline on legacy DBs ([1f5aabc](https://github.com/bcit-tlu/hriv/commit/1f5aabc398d4140111bdd1933b605753b2358212))
- **backend:** stamp baseline revision instead of head for legacy DBs ([e8ee93c](https://github.com/bcit-tlu/hriv/commit/e8ee93c79852c92c844cf84aeba1edefd86657fc))
- **backend:** update log message to reflect both legacy detection cases ([a9e55e7](https://github.com/bcit-tlu/hriv/commit/a9e55e7dbc82e46fbf053f01aa14a595f7a9c024))
- **backend:** use --workers 1 in prod Dockerfile for OTEL fork safety ([e0636a8](https://github.com/bcit-tlu/hriv/commit/e0636a825327c8af7cfd0003222cedcb3d6e86f5))
- bump version in bulk_update, wrap rate_limit Redis ops in try/except ([3450ed6](https://github.com/bcit-tlu/hriv/commit/3450ed65953dc61df0d28c09da7ea70f4db864c5))
- **chart:** update workload URLs to .latest.ltc.bcit.ca; add epoch derivation tests ([5155709](https://github.com/bcit-tlu/hriv/commit/515570941ad9e43c3c9b64387dab33806230d120))
- check for cancellation after long-running operations in all task runners ([4408653](https://github.com/bcit-tlu/hriv/commit/44086533f4d791166a2b736b654fc6b6c3b430e7))
- check for pre-start cancellation in all 4 background task runners ([5c0084d](https://github.com/bcit-tlu/hriv/commit/5c0084db7f082c7b44aeaefef4a77bac08d2dbfa))
- clean up temp file in run_files_export on cancellation/error ([52b1936](https://github.com/bcit-tlu/hriv/commit/52b1936f5da03a256e4fecc95b07da21056b16c6))
- copy arq CLI binary into runtime image for worker container ([d9a5cf8](https://github.com/bcit-tlu/hriv/commit/d9a5cf87bede6afac08dcbc2227b939e4c4dd5b8))
- correct misleading rollback message and clean up leaked files on task creation failure ([34cc9d9](https://github.com/bcit-tlu/hriv/commit/34cc9d9f960448d8911391430f16301feada026f))
- escape &lt; as \u003c in inline script to prevent &lt;/script&gt; injection ([6823954](https://github.com/bcit-tlu/hriv/commit/68239546e8ad49e62fbde3e5bcdac4310879422c))
- escape interpolated values in OIDC redirect HTML to prevent XSS ([80f5199](https://github.com/bcit-tlu/hriv/commit/80f5199068d7e3cb4c71bfaf9db66024565d3b49))
- exclude admin_tasks/ from filesystem export archive ([2127d6f](https://github.com/bcit-tlu/hriv/commit/2127d6f8d2e796b4fad27a5f82f274235e0a78e6))
- exclude admin_tasks/ from legacy sync filesystem export endpoint ([8b0fd6f](https://github.com/bcit-tlu/hriv/commit/8b0fd6f35050782cc27eb3602f4c8090416c98c4))
- handle multi-value If-None-Match header per RFC 7232 §3.2 ([e0d1fee](https://github.com/bcit-tlu/hriv/commit/e0d1fee9aa9069fa857ef9e94a0241e3d2324083))
- handle poll_task exceptions separately from cancellation, improve cancel test ([1d7fca6](https://github.com/bcit-tlu/hriv/commit/1d7fca609328fc059048e800a1d205fde248cf1f))
- **images:** atomic compare-and-swap for optimistic concurrency ([c32bd70](https://github.com/bcit-tlu/hriv/commit/c32bd7048dbb7c1a7beb9ab2ab9f40e7aacf7c99)), closes [#16](https://github.com/bcit-tlu/hriv/issues/16)
- improve OIDC callback debug logging for IdP claim troubleshooting ([f7332dd](https://github.com/bcit-tlu/hriv/commit/f7332dd36706ebb39def9aafd3a62e0fe84aa4f0))
- include progress and file_size in admin export/import round-trip ([bad7b1f](https://github.com/bcit-tlu/hriv/commit/bad7b1f2d0c158fa75d1431e3e13430cead5390f))
- include sort_order in admin export/import for categories ([fff00c0](https://github.com/bcit-tlu/hriv/commit/fff00c0e163b727006dc55f405fc004411fd6296))
- initialize structured logging in arq worker process ([6656c1e](https://github.com/bcit-tlu/hriv/commit/6656c1e1b123b22e9e874f8c3e59c7f5a092d9b7))
- key rate limiter on IP+email composite to prevent shared-IP bypass ([468ab40](https://github.com/bcit-tlu/hriv/commit/468ab407d28698de3bf27e5d21d68de57736bfd2))
- make db import atomic and use token-based download auth ([b65cc80](https://github.com/bcit-tlu/hriv/commit/b65cc805c2ba924b307d01ab1b93262db8041a30))
- **middleware:** make audit-log path exclusions configurable ([30fad53](https://github.com/bcit-tlu/hriv/commit/30fad532464ef3c2aafb15f3dec74611981a5264))
- **migrations:** run advisory-lock connection with AUTOCOMMIT isolation ([10bdd8e](https://github.com/bcit-tlu/hriv/commit/10bdd8eb87b5104633de47a804418ce29878bb88))
- **migrations:** run advisory-lock connection with AUTOCOMMIT isolation ([3e91748](https://github.com/bcit-tlu/hriv/commit/3e91748c8b2f930cb31a04b60009d7e4369720c9))
- move admin_tasks shelter inside try block to prevent data loss ([5596f6f](https://github.com/bcit-tlu/hriv/commit/5596f6f5032d78727c0c6f62ccf074cecf47279e))
- move admin_tasks.created_by NULL to status_session to prevent deadlock ([829e9f6](https://github.com/bcit-tlu/hriv/commit/829e9f6e58977f79481f8faa89e5cde2b6bb08a1))
- move instance epoch into AuthSettings for multi-worker compatibility ([74a875a](https://github.com/bcit-tlu/hriv/commit/74a875a5e84cd3d7a2b7943737eff4f4db575b5f))
- **oidc:** always log callback errors server-side; stop leaking log_detail in HTTPException body ([c433a06](https://github.com/bcit-tlu/hriv/commit/c433a06cfafc74a7496dd1be59c472d000a3ac2d))
- **oidc:** catch TimeoutException in startup connectivity probe ([fb89b66](https://github.com/bcit-tlu/hriv/commit/fb89b66e9de8f4a81a169161af534dc5124d6ac2))
- **oidc:** graceful error handling for unreachable IdP and sync chart init SQL ([bd3288b](https://github.com/bcit-tlu/hriv/commit/bd3288bc7f0bd09078304b14fd9a61c44be907a4))
- **oidc:** redirect to frontend with error codes instead of raw JSON (P20) ([1b56b17](https://github.com/bcit-tlu/hriv/commit/1b56b1742ff793770380a20afec37aa2c5750d99))
- **oidc:** use generic error detail, catch TimeoutException alongside ConnectError ([b0026ff](https://github.com/bcit-tlu/hriv/commit/b0026ff2b60e85dc6b49ee435976771182f5d561))
- only emit epoch-missing warning when JWT_SECRET was explicitly set ([ab017cf](https://github.com/bcit-tlu/hriv/commit/ab017cfd67edae57bf6a1a339d46e395e91f3ece))
- **otel,docker:** address Devin Review info findings on PR [#75](https://github.com/bcit-tlu/hriv/issues/75) ([19c853c](https://github.com/bcit-tlu/hriv/commit/19c853cf48d26f25a27b3b27491bf1643dd7fa8f))
- pass sort_order to CategoryTree and add cycle detection to reorder endpoint ([31f8dca](https://github.com/bcit-tlu/hriv/commit/31f8dca0e0e45b40ac2e426498d6b20a81bb711c))
- pass width/height/file_size in create_image endpoint ([078629d](https://github.com/bcit-tlu/hriv/commit/078629d1b7bf236b43c2692dd80bf1c12e5a4005))
- pin dev test dependency versions to match pyproject.toml ranges ([86e52ad](https://github.com/bcit-tlu/hriv/commit/86e52ad789dcd8608accd5726d903a9ca6f0c7a9))
- preserve admin_tasks directory during filesystem import restore ([48b2440](https://github.com/bcit-tlu/hriv/commit/48b2440ba0d501f2b15aef2d93b180c317d85d10))
- preserve oidc_subject in user export/import round-trips ([9bec1f5](https://github.com/bcit-tlu/hriv/commit/9bec1f5f7d09153e5646935025677344148c40c4))
- prevent deadlock in run_db_import by NULLing admin_tasks.created_by before DELETE FROM users ([0f9bff6](https://github.com/bcit-tlu/hriv/commit/0f9bff624252f87dc52566842387efe4864635fe))
- refresh task after rollback in error handlers to prevent MissingGreenlet ([3a2f70e](https://github.com/bcit-tlu/hriv/commit/3a2f70e2d53d34d41e9419a3151ea31d829f3d36))
- refresh task before cancel handlers to preserve log; scope created_by NULL ([40346db](https://github.com/bcit-tlu/hriv/commit/40346db6ee1fa77b8386280045f987780353f0aa))
- **release:** use rc1 prerelease format instead of rc.1 ([#166](https://github.com/bcit-tlu/hriv/issues/166)) ([277045b](https://github.com/bcit-tlu/hriv/commit/277045b79fdbc652ba1b9864de5fa0f591af324f))
- remove internal details from client-facing OIDC error responses ([98cc802](https://github.com/bcit-tlu/hriv/commit/98cc802ac6c42643115ac012456a2107a537611d))
- remove post-commit cancellation check from import runners ([8cca834](https://github.com/bcit-tlu/hriv/commit/8cca834d40698095fb0a09ea9ee9b9a3d432978c))
- remove post-restore cancellation check from run_files_import ([ad5a5fa](https://github.com/bcit-tlu/hriv/commit/ad5a5fa447b86eaf1caa6bb45775a221ea5fee38))
- rename JWT claim from 'iss' to '\_epoch' to avoid OIDC IdP conflict ([6b42aa5](https://github.com/bcit-tlu/hriv/commit/6b42aa594215a0b40fee9462371e848448179751))
- reset rate limit on successful login, close Redis client on ping failure ([9af8475](https://github.com/bcit-tlu/hriv/commit/9af8475a85680320221e3ebb4732a5b9a509d2fe))
- resolve stale metadata, overlay validation, and viewer re-creation ([#40](https://github.com/bcit-tlu/hriv/issues/40), [#41](https://github.com/bcit-tlu/hriv/issues/41), [#42](https://github.com/bcit-tlu/hriv/issues/42)) ([#123](https://github.com/bcit-tlu/hriv/issues/123)) ([32838ea](https://github.com/bcit-tlu/hriv/commit/32838eaa6f1ca9ac76989ca399658836141bd759))
- resolve stale UI and delayed visit-link after mutations ([5bb206f](https://github.com/bcit-tlu/hriv/commit/5bb206f06339c47eb4f753721b98dee33caa3ecc))
- scope created_by NULLing to current task only in run_db_import ([7d0bf2c](https://github.com/bcit-tlu/hriv/commit/7d0bf2c85121df5b62a2f277fa947f659c040d24))
- **tests:** mock pyvips for CI environments without libvips ([5a3071b](https://github.com/bcit-tlu/hriv/commit/5a3071bae5261a387fc6170e3095bd9ce1a3004b))
- **tests:** update migrations_bootstrap tests for legacy stamp interface ([243ccfc](https://github.com/bcit-tlu/hriv/commit/243ccfc8fb7b01d8c5a34d34db61f636ca4c35cd))
- update pre-existing tests for Phase 5 request param and version field ([50f3234](https://github.com/bcit-tlu/hriv/commit/50f323408ce55b1b15df81faa2db3157c21f453e))
- use backend instance epoch instead of sessionStorage for session invalidation ([d4c921f](https://github.com/bcit-tlu/hriv/commit/d4c921f440d67306bac1fb2534635d8aef2688bb))
- use BigInteger for file_size to support large pathology images (&gt;2GB) ([b61b4df](https://github.com/bcit-tlu/hriv/commit/b61b4dfa92d8d202d6c1e08a2fa83c19234bd49a))
- use client-side redirect for OIDC token delivery ([69e215a](https://github.com/bcit-tlu/hriv/commit/69e215a697c6a2ee4520414e59b7a27d760f2ea1))
- use urlparse for Redis URL in worker to handle auth and database ([f9a401a](https://github.com/bcit-tlu/hriv/commit/f9a401a8c55af8b181d511df96749ef820451c75))
- use uuid for import staging filenames to prevent collisions ([54ccd89](https://github.com/bcit-tlu/hriv/commit/54ccd89de104e575594213a79e41dcf300313235))
- use X-Forwarded-For for client IP, add TTL-based Redis retry backoff ([325d464](https://github.com/bcit-tlu/hriv/commit/325d464b9b7c37a54e49deec6e08480e017e3018))
- verbose archive output and responsive cancellation for filesystem export ([5ef2419](https://github.com/bcit-tlu/hriv/commit/5ef2419c288dbce0076566082f7d782e232e09f0)), closes [#97](https://github.com/bcit-tlu/hriv/issues/97) [#98](https://github.com/bcit-tlu/hriv/issues/98)
- wrap reset_login_rate_limit Redis call in try/except to prevent 500 on transient failure ([99f8565](https://github.com/bcit-tlu/hriv/commit/99f85659f8f00d80a6239727c95d967e38805317))
- write files export archive to /tmp before moving to \_TASKS_DIR ([88aaed7](https://github.com/bcit-tlu/hriv/commit/88aaed7bb3828dc1f2e2def9773eb9ce0a72f6d2))

### Performance Improvements

- isolate Poetry in builder venv to exclude it from runtime image ([fc6212b](https://github.com/bcit-tlu/hriv/commit/fc6212ba90f10c3fce21369455410c91651b5167))
- optimize backend Dockerfile with multi-stage build (1.03GB → 398MB) ([dceb4f3](https://github.com/bcit-tlu/hriv/commit/dceb4f3174e696353675cd6ef599cdc481e8a9d7))

## [0.7.0-rc](https://github.com/bcit-tlu/hriv/compare/backend-v0.6.0...backend-v0.7.0-rc) (2026-04-21)

### Features

- **versions:** auto-publish backup version via ConfigMap mount ([#155](https://github.com/bcit-tlu/hriv/issues/155)) ([0ce22ec](https://github.com/bcit-tlu/hriv/commit/0ce22ecc6ff0c5c48eb58402a81dff7c598e3d95))

### Bug Fixes

- **backend:** read FastAPI version from APP_VERSION env var ([#160](https://github.com/bcit-tlu/hriv/issues/160)) ([d637f0a](https://github.com/bcit-tlu/hriv/commit/d637f0a45525cc40febea6a39fb0e2a8c74616d7))

## [0.6.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.6.0-rc...backend-v0.6.0) (2026-04-21)

### Features

- gate footer versions to admins and surface per-component versions ([#149](https://github.com/bcit-tlu/hriv/issues/149)) ([#150](https://github.com/bcit-tlu/hriv/issues/150)) ([b3447dd](https://github.com/bcit-tlu/hriv/commit/b3447dd997a419485b17804b8823d0b0d3c06fda))

## [0.6.0-rc](https://github.com/bcit-tlu/hriv/compare/backend-v0.5.2-rc...backend-v0.6.0-rc) (2026-04-20)

### Features

- center-crop card thumbnails for recognisable image previews ([#140](https://github.com/bcit-tlu/hriv/issues/140)) ([ec9f31c](https://github.com/bcit-tlu/hriv/commit/ec9f31c3db00de849c66765b74c081794d6225df))

## [0.5.2-rc](https://github.com/bcit-tlu/hriv/compare/backend-v0.5.1...backend-v0.5.2-rc) (2026-04-20)

### Bug Fixes

- resolve stale metadata, overlay validation, and viewer re-creation ([#40](https://github.com/bcit-tlu/hriv/issues/40), [#41](https://github.com/bcit-tlu/hriv/issues/41), [#42](https://github.com/bcit-tlu/hriv/issues/42)) ([#123](https://github.com/bcit-tlu/hriv/issues/123)) ([32838ea](https://github.com/bcit-tlu/hriv/commit/32838eaa6f1ca9ac76989ca399658836141bd759))

## [0.5.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.5.0...backend-v0.5.1) (2026-04-18)

### Bug Fixes

- **admin_ops:** keep os.rename for same-fs sibling moves to preserve rollback safety ([c23d18a](https://github.com/bcit-tlu/hriv/commit/c23d18a45bff4a3eb9826c87460bbcae689bea8a))
- **admin_ops:** use shutil.move for cross-filesystem safe renames ([d611574](https://github.com/bcit-tlu/hriv/commit/d611574609f9477cb7e4137c12b6f70d0bdf4c43))
- **images:** atomic compare-and-swap for optimistic concurrency ([c32bd70](https://github.com/bcit-tlu/hriv/commit/c32bd7048dbb7c1a7beb9ab2ab9f40e7aacf7c99)), closes [#16](https://github.com/bcit-tlu/hriv/issues/16)
- **middleware:** make audit-log path exclusions configurable ([30fad53](https://github.com/bcit-tlu/hriv/commit/30fad532464ef3c2aafb15f3dec74611981a5264))
- **oidc:** always log callback errors server-side; stop leaking log_detail in HTTPException body ([c433a06](https://github.com/bcit-tlu/hriv/commit/c433a06cfafc74a7496dd1be59c472d000a3ac2d))
- **oidc:** redirect to frontend with error codes instead of raw JSON (P20) ([1b56b17](https://github.com/bcit-tlu/hriv/commit/1b56b1742ff793770380a20afec37aa2c5750d99))

## [0.5.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.4.1...backend-v0.5.0) (2026-04-18)

### Features

- **admin:** auto-scroll log viewer, byte-based export progress, force-cancel fix ([3a4d240](https://github.com/bcit-tlu/hriv/commit/3a4d24095b96f1ad0c6dfef963d24a83c5e702c2))

### Bug Fixes

- **admin:** allow force-cancel and reconcile orphaned admin tasks on startup ([f6b5434](https://github.com/bcit-tlu/hriv/commit/f6b5434f421f6b348827ec5c07c97daefb708e56))
- **admin:** format leftover queue entries as 'adding &lt;name&gt;' not tuples ([6e4a774](https://github.com/bcit-tlu/hriv/commit/6e4a774c91965968c1778ec2e901e7f16af6b099))

## [0.4.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.4.0...backend-v0.4.1) (2026-04-18)

### Bug Fixes

- handle poll_task exceptions separately from cancellation, improve cancel test ([1d7fca6](https://github.com/bcit-tlu/hriv/commit/1d7fca609328fc059048e800a1d205fde248cf1f))
- verbose archive output and responsive cancellation for filesystem export ([5ef2419](https://github.com/bcit-tlu/hriv/commit/5ef2419c288dbce0076566082f7d782e232e09f0)), closes [#97](https://github.com/bcit-tlu/hriv/issues/97) [#98](https://github.com/bcit-tlu/hriv/issues/98)

## [0.4.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.3.1...backend-v0.4.0) (2026-04-18)

### Features

- add server-side concurrency guard for background admin tasks ([c47b775](https://github.com/bcit-tlu/hriv/commit/c47b775f0dcd4449235bc67c1979b3209588f23d))
- add task cancellation with cancel button in UI ([1a60d7d](https://github.com/bcit-tlu/hriv/commit/1a60d7dfc79b90de07f7b69510f8e4128d15f339))
- decouple admin import/export into background tasks with snackbar notifications ([374a197](https://github.com/bcit-tlu/hriv/commit/374a197318125f062b5ee214b964935cffc8b80a))

### Bug Fixes

- add session.rollback() before error handlers in single-session task runners ([7df7361](https://github.com/bcit-tlu/hriv/commit/7df7361c9da906ee1014a59340172fcbae4f788b))
- check for cancellation after long-running operations in all task runners ([4408653](https://github.com/bcit-tlu/hriv/commit/44086533f4d791166a2b736b654fc6b6c3b430e7))
- check for pre-start cancellation in all 4 background task runners ([5c0084d](https://github.com/bcit-tlu/hriv/commit/5c0084db7f082c7b44aeaefef4a77bac08d2dbfa))
- clean up temp file in run_files_export on cancellation/error ([52b1936](https://github.com/bcit-tlu/hriv/commit/52b1936f5da03a256e4fecc95b07da21056b16c6))
- correct misleading rollback message and clean up leaked files on task creation failure ([34cc9d9](https://github.com/bcit-tlu/hriv/commit/34cc9d9f960448d8911391430f16301feada026f))
- exclude admin_tasks/ from filesystem export archive ([2127d6f](https://github.com/bcit-tlu/hriv/commit/2127d6f8d2e796b4fad27a5f82f274235e0a78e6))
- exclude admin_tasks/ from legacy sync filesystem export endpoint ([8b0fd6f](https://github.com/bcit-tlu/hriv/commit/8b0fd6f35050782cc27eb3602f4c8090416c98c4))
- make db import atomic and use token-based download auth ([b65cc80](https://github.com/bcit-tlu/hriv/commit/b65cc805c2ba924b307d01ab1b93262db8041a30))
- move admin_tasks shelter inside try block to prevent data loss ([5596f6f](https://github.com/bcit-tlu/hriv/commit/5596f6f5032d78727c0c6f62ccf074cecf47279e))
- move admin_tasks.created_by NULL to status_session to prevent deadlock ([829e9f6](https://github.com/bcit-tlu/hriv/commit/829e9f6e58977f79481f8faa89e5cde2b6bb08a1))
- preserve admin_tasks directory during filesystem import restore ([48b2440](https://github.com/bcit-tlu/hriv/commit/48b2440ba0d501f2b15aef2d93b180c317d85d10))
- preserve oidc_subject in user export/import round-trips ([9bec1f5](https://github.com/bcit-tlu/hriv/commit/9bec1f5f7d09153e5646935025677344148c40c4))
- prevent deadlock in run_db_import by NULLing admin_tasks.created_by before DELETE FROM users ([0f9bff6](https://github.com/bcit-tlu/hriv/commit/0f9bff624252f87dc52566842387efe4864635fe))
- refresh task after rollback in error handlers to prevent MissingGreenlet ([3a2f70e](https://github.com/bcit-tlu/hriv/commit/3a2f70e2d53d34d41e9419a3151ea31d829f3d36))
- refresh task before cancel handlers to preserve log; scope created_by NULL ([40346db](https://github.com/bcit-tlu/hriv/commit/40346db6ee1fa77b8386280045f987780353f0aa))
- remove post-commit cancellation check from import runners ([8cca834](https://github.com/bcit-tlu/hriv/commit/8cca834d40698095fb0a09ea9ee9b9a3d432978c))
- remove post-restore cancellation check from run_files_import ([ad5a5fa](https://github.com/bcit-tlu/hriv/commit/ad5a5fa447b86eaf1caa6bb45775a221ea5fee38))
- scope created_by NULLing to current task only in run_db_import ([7d0bf2c](https://github.com/bcit-tlu/hriv/commit/7d0bf2c85121df5b62a2f277fa947f659c040d24))
- use uuid for import staging filenames to prevent collisions ([54ccd89](https://github.com/bcit-tlu/hriv/commit/54ccd89de104e575594213a79e41dcf300313235))
- write files export archive to /tmp before moving to \_TASKS_DIR ([88aaed7](https://github.com/bcit-tlu/hriv/commit/88aaed7bb3828dc1f2e2def9773eb9ce0a72f6d2))

## [0.3.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.3.0...backend-v0.3.1) (2026-04-17)

### Bug Fixes

- **backend:** handle empty alembic_version left by failed prior migration ([a8c910b](https://github.com/bcit-tlu/hriv/commit/a8c910b452107879ba9e9325e2cae48f73b2c8b0))
- **backend:** restore legacy-schema stamp in Alembic bootstrap ([1fb998f](https://github.com/bcit-tlu/hriv/commit/1fb998fa649a9fafd915442bfb7bf7ea4e00e738))
- **backend:** stamp baseline revision instead of head for legacy DBs ([e8ee93c](https://github.com/bcit-tlu/hriv/commit/e8ee93c79852c92c844cf84aeba1edefd86657fc))
- **backend:** update log message to reflect both legacy detection cases ([a9e55e7](https://github.com/bcit-tlu/hriv/commit/a9e55e7dbc82e46fbf053f01aa14a595f7a9c024))

## [0.3.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.2.0...backend-v0.3.0) (2026-04-17)

### Features

- **auth:** enforce JWT_SECRET via REQUIRE_JWT_SECRET flag ([6106b03](https://github.com/bcit-tlu/hriv/commit/6106b03482b19e6c538bb3773b3b860117b1eafa))
- **auth:** enforce JWT_SECRET via REQUIRE_JWT_SECRET flag ([d9ba89d](https://github.com/bcit-tlu/hriv/commit/d9ba89da7f8e58f05bc1e52fe6cd79bd513e0973))
- **backend:** adopt Alembic for database migrations ([68685c2](https://github.com/bcit-tlu/hriv/commit/68685c23f50f060fdef18854c77b8a7039b77117))
- **backend:** adopt Alembic for database migrations ([72d8115](https://github.com/bcit-tlu/hriv/commit/72d811577e58b8a190f18e93449d2f0ca8b63353))
- **backend:** wrap uvicorn with opentelemetry-instrument in production ([0e7b7e7](https://github.com/bcit-tlu/hriv/commit/0e7b7e7a639bb8fb39db5a8de1c4eb53aae99f9d))

### Bug Fixes

- **backend:** align Alembic baseline with SQLAlchemy model nullability/indexes ([9e594e3](https://github.com/bcit-tlu/hriv/commit/9e594e34356667ce09ce5354b8a53098feb07829))
- **backend:** align Alembic baseline with SQLAlchemy model nullability/indexes ([ba7c746](https://github.com/bcit-tlu/hriv/commit/ba7c7463d0398fae4c7c9927b82e271d3b18f91c))
- **backend:** async advisory lock + name remaining status indexes ([97eb523](https://github.com/bcit-tlu/hriv/commit/97eb5235bbe61ec2839fb833e837ba687fbc63bc))
- **backend:** async advisory lock + name remaining status indexes ([2e93f70](https://github.com/bcit-tlu/hriv/commit/2e93f7049db59fe9f0c7cab685b96b4cbc9c3a13))
- **backend:** clean up merge markers in README + stamp specific baseline ([92c706a](https://github.com/bcit-tlu/hriv/commit/92c706a8fc9ff4480597953765732de1b4620fc1))
- **backend:** clean up merge markers in README + stamp specific baseline ([d9752a0](https://github.com/bcit-tlu/hriv/commit/d9752a04c2c682d11e56482b4c9fb85983fc58e1))
- **backend:** dedupe COPY and OpenTelemetry deps, restore legacy-stamp branch ([3dc2bfc](https://github.com/bcit-tlu/hriv/commit/3dc2bfc2524b12fa337cd0aa26e46f1000e1542d))
- **backend:** disable OTEL exporters by default in Docker image ([24baf4f](https://github.com/bcit-tlu/hriv/commit/24baf4f3af1e947c49b75cb088aa693979e4e40d))
- **backend:** offload Alembic to worker thread + align server_defaults ([1778bb9](https://github.com/bcit-tlu/hriv/commit/1778bb93172cc9f093383b4401b600934917f6db))
- **backend:** offload Alembic to worker thread + align server_defaults ([dd51d7f](https://github.com/bcit-tlu/hriv/commit/dd51d7f7788df0ba13c704a4a7e48bdc53d47247))
- **backend:** pg_advisory_lock bootstrap + name indexes to match baseline ([1abdf82](https://github.com/bcit-tlu/hriv/commit/1abdf82eb302375c9b59877bf438dd06829281ee))
- **backend:** pg_advisory_lock bootstrap + name indexes to match baseline ([f6549be](https://github.com/bcit-tlu/hriv/commit/f6549bef8c98abce2615f4eefb37183a75bcb65f))
- **backend:** run 'upgrade head' after stamping baseline on legacy DBs ([2040d7b](https://github.com/bcit-tlu/hriv/commit/2040d7b1cc251cc299f97aba5ac1e331d2f9617e))
- **backend:** run 'upgrade head' after stamping baseline on legacy DBs ([1f5aabc](https://github.com/bcit-tlu/hriv/commit/1f5aabc398d4140111bdd1933b605753b2358212))
- **backend:** use --workers 1 in prod Dockerfile for OTEL fork safety ([e0636a8](https://github.com/bcit-tlu/hriv/commit/e0636a825327c8af7cfd0003222cedcb3d6e86f5))
- **migrations:** run advisory-lock connection with AUTOCOMMIT isolation ([10bdd8e](https://github.com/bcit-tlu/hriv/commit/10bdd8eb87b5104633de47a804418ce29878bb88))
- **migrations:** run advisory-lock connection with AUTOCOMMIT isolation ([3e91748](https://github.com/bcit-tlu/hriv/commit/3e91748c8b2f930cb31a04b60009d7e4369720c9))
- **otel,docker:** address Devin Review info findings on PR [#75](https://github.com/bcit-tlu/hriv/issues/75) ([19c853c](https://github.com/bcit-tlu/hriv/commit/19c853cf48d26f25a27b3b27491bf1643dd7fa8f))
- **tests:** update migrations_bootstrap tests for legacy stamp interface ([243ccfc](https://github.com/bcit-tlu/hriv/commit/243ccfc8fb7b01d8c5a34d34db61f636ca4c35cd))

## [0.2.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.1.0...backend-v0.2.0) (2026-04-15)

### Features

- add bulk edit capability to Images page ([baeccee](https://github.com/bcit-tlu/hriv/commit/baeccee2723beca6de143e25572c4578cd7ec980))
- add bulk image import capability for admin role ([834f550](https://github.com/bcit-tlu/hriv/commit/834f55000987c3e4667c17af38e40e15ab8c89c3))
- add drag-and-drop reordering to Manage Categories dialog ([444ec21](https://github.com/bcit-tlu/hriv/commit/444ec21c30df24370d44eada69b60518d64a6b83))
- add filesystem snapshot export/import and source_images to DB backup ([e764a6a](https://github.com/bcit-tlu/hriv/commit/e764a6a99a9999e67b80c14d58dfca554dd1e2c3))
- add processing progress percentage to snackbar ([5c7197b](https://github.com/bcit-tlu/hriv/commit/5c7197b3b0c5f04058f39f23a134a4bda2b83d09))
- add Report Issue modal and version footer ([82fa81f](https://github.com/bcit-tlu/hriv/commit/82fa81fdfe7b61572b55c777715cb3dd68b43f4f))
- add server-side filtering of hidden categories for student role ([963853f](https://github.com/bcit-tlu/hriv/commit/963853fc927424a97b0817f337918aa94f872418))
- add structured JSON logging to backend processing pipeline ([c6b4390](https://github.com/bcit-tlu/hriv/commit/c6b4390529139a3ac94f851fcb3e31e8948ddbd3))
- add TIFF file support with large file upload handling ([04b57a1](https://github.com/bcit-tlu/hriv/commit/04b57a1a42e2bdf37f13f67194234c4b20b95a64))
- **ci:** switch to per-component Release Please packages for independent versioning ([de8ff81](https://github.com/bcit-tlu/hriv/commit/de8ff8108da1d4a8af08cc4017de251435d700ba))
- convert image active status from string to boolean with role-based visibility ([2e9f5fa](https://github.com/bcit-tlu/hriv/commit/2e9f5faabe0e2e043375d8fdef2397ec46512cd9))
- display image dimensions and file size on image cards ([8f1b244](https://github.com/bcit-tlu/hriv/commit/8f1b2447e5981d1bcb14929e503ffed2b4790365))
- frontend design tweaks – breadcrumbs, metadata, toolbars, page styling ([39d7cce](https://github.com/bcit-tlu/hriv/commit/39d7cce036b16a78bec201f3640b4a8a33e07126))
- granular progress tracking via pyvips eval signals and status messages ([571b268](https://github.com/bcit-tlu/hriv/commit/571b268fddf9340b138b310fc8bdbf7d72ac57be))
- mirror Add Image fields in Bulk Import modal via shared ImageMetadataFields component ([6a73c6b](https://github.com/bcit-tlu/hriv/commit/6a73c6bd65cfa7467bbb789ae234f53a3ac53fa8))
- Phase 4 — Performance (nginx tile sidecar + optimised category tree) ([afd9912](https://github.com/bcit-tlu/hriv/commit/afd99122ebdf1fc43eb20bd898d28743d2f085c5))
- Phase 5 — Refinements (optimistic concurrency, task queue, rate limiting) ([178de9c](https://github.com/bcit-tlu/hriv/commit/178de9cb51a476ebdc0942178a755783d2cc0e42))
- reduce health check log noise in local dev ([537a3ee](https://github.com/bcit-tlu/hriv/commit/537a3ee6cab543f168c993c06516ba5ac8272ad0))
- standardize program selection across Upload Image and Bulk Edit modals ([2d68233](https://github.com/bcit-tlu/hriv/commit/2d682335a5ad3443af81b41d3645308e5d1058f0))

### Bug Fixes

- add active param to SourceImage model, upload endpoint, and processing ([0723e8c](https://github.com/bcit-tlu/hriv/commit/0723e8c8620fb5ea6a66297c8fa0f8be3bd5d46d))
- add progress and file_size to admin test mock ([fe7b21c](https://github.com/bcit-tlu/hriv/commit/fe7b21c964effe520a22238eb59a4b01fea27584))
- add redis as explicit dependency in pyproject.toml ([a382f4f](https://github.com/bcit-tlu/hriv/commit/a382f4fd2fdf4cc1f75b434b8055ad17c96a3a1e))
- address Devin Review findings — sidecar placement + 304 headers ([e325b66](https://github.com/bcit-tlu/hriv/commit/e325b666350ae65287ca15c68cd3af1b558ca21d))
- address review concerns - atomic counters, failure detection, category validation ([c975de0](https://github.com/bcit-tlu/hriv/commit/c975de0dd22c2e45448025b0d31fa6b7f6017607))
- address review findings — revert arq in bulk import, fix stale version on clear overlays ([3fc53c0](https://github.com/bcit-tlu/hriv/commit/3fc53c08648ca17c49a37190b273ea6c8359bc36))
- allow students to read programs (GET endpoints) ([e5153c3](https://github.com/bcit-tlu/hriv/commit/e5153c3732f6bc04ac80625491320b23f6a1c2f8))
- assign tmp_path before chunked read loop to prevent temp file leak on error ([c03b8df](https://github.com/bcit-tlu/hriv/commit/c03b8df35339f988b05c8d94ba3cba95e76141ec))
- **auth:** derive jwt_instance_epoch from JWT_SECRET for multi-worker consistency ([3c26b2d](https://github.com/bcit-tlu/hriv/commit/3c26b2d69fee25fc27ea2e6c45ac1b3ca1233024))
- **backend:** address Devin Review findings for PR [#95](https://github.com/bcit-tlu/hriv/issues/95) ([677a0e6](https://github.com/bcit-tlu/hriv/commit/677a0e6415a286291a556443caa6f5a21687076d))
- broaden file cleanup to catch all exceptions, not just HTTPException ([e9882a0](https://github.com/bcit-tlu/hriv/commit/e9882a0616089890cb825ac97b86d6857878ebdf))
- bump version in bulk_update, wrap rate_limit Redis ops in try/except ([3450ed6](https://github.com/bcit-tlu/hriv/commit/3450ed65953dc61df0d28c09da7ea70f4db864c5))
- **chart:** update workload URLs to .latest.ltc.bcit.ca; add epoch derivation tests ([5155709](https://github.com/bcit-tlu/hriv/commit/515570941ad9e43c3c9b64387dab33806230d120))
- clarify login failure log message for missing password_hash case ([0e2c101](https://github.com/bcit-tlu/hriv/commit/0e2c101b51f2681e7c20180f6dd042bd93713f80))
- copy arq CLI binary into runtime image for worker container ([d9a5cf8](https://github.com/bcit-tlu/hriv/commit/d9a5cf87bede6afac08dcbc2227b939e4c4dd5b8))
- eagerly load programs relationship before assignment to prevent MissingGreenlet error ([3ab414f](https://github.com/bcit-tlu/hriv/commit/3ab414fe5636069d648fd640b4a38f63d21cdb68))
- escape &lt; as \u003c in inline script to prevent &lt;/script&gt; injection ([6823954](https://github.com/bcit-tlu/hriv/commit/68239546e8ad49e62fbde3e5bcdac4310879422c))
- escape interpolated values in OIDC redirect HTML to prevent XSS ([80f5199](https://github.com/bcit-tlu/hriv/commit/80f5199068d7e3cb4c71bfaf9db66024565d3b49))
- grant instructor role access to bulk import endpoints and update docs ([b9173ec](https://github.com/bcit-tlu/hriv/commit/b9173ecc597aaac6cfe32161777d1033f8af9f34))
- grant instructor role access to programs and announcement backend endpoints ([07fc154](https://github.com/bcit-tlu/hriv/commit/07fc154f7aadaabb297add62fdf30ebd4c7504de))
- handle multi-value If-None-Match header per RFC 7232 §3.2 ([e0d1fee](https://github.com/bcit-tlu/hriv/commit/e0d1fee9aa9069fa857ef9e94a0241e3d2324083))
- handle unhandled \_process_one exceptions and clean up orphaned files ([e7de66d](https://github.com/bcit-tlu/hriv/commit/e7de66dacdc62e9f071dad1287dbe6f4f3a993a3))
- improve OIDC callback debug logging for IdP claim troubleshooting ([f7332dd](https://github.com/bcit-tlu/hriv/commit/f7332dd36706ebb39def9aafd3a62e0fe84aa4f0))
- include progress and file_size in admin export/import round-trip ([bad7b1f](https://github.com/bcit-tlu/hriv/commit/bad7b1f2d0c158fa75d1431e3e13430cead5390f))
- include sort_order in admin export/import for categories ([fff00c0](https://github.com/bcit-tlu/hriv/commit/fff00c0e163b727006dc55f405fc004411fd6296))
- initialize structured logging in arq worker process ([6656c1e](https://github.com/bcit-tlu/hriv/commit/6656c1e1b123b22e9e874f8c3e59c7f5a092d9b7))
- key rate limiter on IP+email composite to prevent shared-IP bypass ([468ab40](https://github.com/bcit-tlu/hriv/commit/468ab407d28698de3bf27e5d21d68de57736bfd2))
- move instance epoch into AuthSettings for multi-worker compatibility ([74a875a](https://github.com/bcit-tlu/hriv/commit/74a875a5e84cd3d7a2b7943737eff4f4db575b5f))
- move PATCH /bulk before /{image_id} to fix route ordering ([6eae2a8](https://github.com/bcit-tlu/hriv/commit/6eae2a8eff7a1df7b2aacf9369416cb253cbb3d1))
- move setup_logging() into lifespan to run after uvicorn init ([110b222](https://github.com/bcit-tlu/hriv/commit/110b2223c81dbfc48e5db37f50966b8ae5ded162))
- **oidc:** catch TimeoutException in startup connectivity probe ([fb89b66](https://github.com/bcit-tlu/hriv/commit/fb89b66e9de8f4a81a169161af534dc5124d6ac2))
- **oidc:** graceful error handling for unreachable IdP and sync chart init SQL ([bd3288b](https://github.com/bcit-tlu/hriv/commit/bd3288bc7f0bd09078304b14fd9a61c44be907a4))
- **oidc:** use generic error detail, catch TimeoutException alongside ConnectError ([b0026ff](https://github.com/bcit-tlu/hriv/commit/b0026ff2b60e85dc6b49ee435976771182f5d561))
- only emit epoch-missing warning when JWT_SECRET was explicitly set ([ab017cf](https://github.com/bcit-tlu/hriv/commit/ab017cfd67edae57bf6a1a339d46e395e91f3ece))
- pass sort_order to CategoryTree and add cycle detection to reorder endpoint ([31f8dca](https://github.com/bcit-tlu/hriv/commit/31f8dca0e0e45b40ac2e426498d6b20a81bb711c))
- pass width/height/file_size in create_image endpoint ([078629d](https://github.com/bcit-tlu/hriv/commit/078629d1b7bf236b43c2692dd80bf1c12e5a4005))
- pin dev test dependency versions to match pyproject.toml ranges ([86e52ad](https://github.com/bcit-tlu/hriv/commit/86e52ad789dcd8608accd5726d903a9ca6f0c7a9))
- reject scoped JWTs (e.g. file-export) from Bearer auth ([f4ab2ca](https://github.com/bcit-tlu/hriv/commit/f4ab2ca979e4a8e321d1102bd729be0660cb82f6))
- remove internal details from client-facing OIDC error responses ([98cc802](https://github.com/bcit-tlu/hriv/commit/98cc802ac6c42643115ac012456a2107a537611d))
- rename JWT claim from 'iss' to '\_epoch' to avoid OIDC IdP conflict ([6b42aa5](https://github.com/bcit-tlu/hriv/commit/6b42aa594215a0b40fee9462371e848448179751))
- replace \_time_mod.time() with datetime.now(timezone.utc).timestamp() ([9725d7e](https://github.com/bcit-tlu/hriv/commit/9725d7ee9650db04979087133d61f5435c66d483))
- replace extra-keys allowlist with auto-capture, rename filename to original_filename ([fa8519d](https://github.com/bcit-tlu/hriv/commit/fa8519d2e150eae42aed4cdbe5fb202194b9564e))
- reset rate limit on successful login, close Redis client on ping failure ([9af8475](https://github.com/bcit-tlu/hriv/commit/9af8475a85680320221e3ebb4732a5b9a509d2fe))
- resolve stale UI and delayed visit-link after mutations ([5bb206f](https://github.com/bcit-tlu/hriv/commit/5bb206f06339c47eb4f753721b98dee33caa3ecc))
- **tests:** mock pyvips for CI environments without libvips ([5a3071b](https://github.com/bcit-tlu/hriv/commit/5a3071bae5261a387fc6170e3095bd9ce1a3004b))
- update pre-existing tests for Phase 5 request param and version field ([50f3234](https://github.com/bcit-tlu/hriv/commit/50f323408ce55b1b15df81faa2db3157c21f453e))
- update processing.py to use active=True instead of status='active' ([738a09c](https://github.com/bcit-tlu/hriv/commit/738a09c08ff809102349a04956ff5c48da980392))
- use Annotated[] for validation_alias to suppress Pydantic warning ([85d96e6](https://github.com/bcit-tlu/hriv/commit/85d96e697a67db9c88609241b7f19cacdbaaaf7b))
- use atomic JSONB concatenation for errors field to prevent race condition ([3961a88](https://github.com/bcit-tlu/hriv/commit/3961a889555d73e35481ea331fc8edd1ebae2904))
- use backend instance epoch instead of sessionStorage for session invalidation ([d4c921f](https://github.com/bcit-tlu/hriv/commit/d4c921f440d67306bac1fb2534635d8aef2688bb))
- use BigInteger for file_size to support large pathology images (&gt;2GB) ([b61b4df](https://github.com/bcit-tlu/hriv/commit/b61b4dfa92d8d202d6c1e08a2fa83c19234bd49a))
- use client-side redirect for OIDC token delivery ([69e215a](https://github.com/bcit-tlu/hriv/commit/69e215a697c6a2ee4520414e59b7a27d760f2ea1))
- use set() for duplicate ID handling in bulk endpoints ([6c75976](https://github.com/bcit-tlu/hriv/commit/6c75976cf884be4e47d48a103af05815ac0cb452))
- use signed JWT for download tokens to support multi-worker deployment ([c26a470](https://github.com/bcit-tlu/hriv/commit/c26a47076b10c4169f3249e2b6ae48432529eabb))
- use urlparse for Redis URL in worker to handle auth and database ([f9a401a](https://github.com/bcit-tlu/hriv/commit/f9a401a8c55af8b181d511df96749ef820451c75))
- use X-Forwarded-For for client IP, add TTL-based Redis retry backoff ([325d464](https://github.com/bcit-tlu/hriv/commit/325d464b9b7c37a54e49deec6e08480e017e3018))
- wrap reset_login_rate_limit Redis call in try/except to prevent 500 on transient failure ([99f8565](https://github.com/bcit-tlu/hriv/commit/99f85659f8f00d80a6239727c95d967e38805317))
- wrap temp file lifecycle in try/finally to prevent leak when zip streaming fails ([7c3dd40](https://github.com/bcit-tlu/hriv/commit/7c3dd40bda6877935408d9fecac9879e9a9ede8c))

### Performance Improvements

- isolate Poetry in builder venv to exclude it from runtime image ([fc6212b](https://github.com/bcit-tlu/hriv/commit/fc6212ba90f10c3fce21369455410c91651b5167))
- optimize backend Dockerfile with multi-stage build (1.03GB → 398MB) ([dceb4f3](https://github.com/bcit-tlu/hriv/commit/dceb4f3174e696353675cd6ef599cdc481e8a9d7))

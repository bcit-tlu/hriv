# Changelog

## [0.3.1](https://github.com/bcit-tlu/hriv/compare/backend-v0.3.0...backend-v0.3.1) (2026-04-17)


### Bug Fixes

* **backend:** handle empty alembic_version left by failed prior migration ([a8c910b](https://github.com/bcit-tlu/hriv/commit/a8c910b452107879ba9e9325e2cae48f73b2c8b0))
* **backend:** restore legacy-schema stamp in Alembic bootstrap ([1fb998f](https://github.com/bcit-tlu/hriv/commit/1fb998fa649a9fafd915442bfb7bf7ea4e00e738))
* **backend:** stamp baseline revision instead of head for legacy DBs ([e8ee93c](https://github.com/bcit-tlu/hriv/commit/e8ee93c79852c92c844cf84aeba1edefd86657fc))
* **backend:** update log message to reflect both legacy detection cases ([a9e55e7](https://github.com/bcit-tlu/hriv/commit/a9e55e7dbc82e46fbf053f01aa14a595f7a9c024))

## [0.3.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.2.0...backend-v0.3.0) (2026-04-17)


### Features

* **auth:** enforce JWT_SECRET via REQUIRE_JWT_SECRET flag ([6106b03](https://github.com/bcit-tlu/hriv/commit/6106b03482b19e6c538bb3773b3b860117b1eafa))
* **auth:** enforce JWT_SECRET via REQUIRE_JWT_SECRET flag ([d9ba89d](https://github.com/bcit-tlu/hriv/commit/d9ba89da7f8e58f05bc1e52fe6cd79bd513e0973))
* **backend:** adopt Alembic for database migrations ([68685c2](https://github.com/bcit-tlu/hriv/commit/68685c23f50f060fdef18854c77b8a7039b77117))
* **backend:** adopt Alembic for database migrations ([72d8115](https://github.com/bcit-tlu/hriv/commit/72d811577e58b8a190f18e93449d2f0ca8b63353))
* **backend:** wrap uvicorn with opentelemetry-instrument in production ([0e7b7e7](https://github.com/bcit-tlu/hriv/commit/0e7b7e7a639bb8fb39db5a8de1c4eb53aae99f9d))


### Bug Fixes

* **backend:** align Alembic baseline with SQLAlchemy model nullability/indexes ([9e594e3](https://github.com/bcit-tlu/hriv/commit/9e594e34356667ce09ce5354b8a53098feb07829))
* **backend:** align Alembic baseline with SQLAlchemy model nullability/indexes ([ba7c746](https://github.com/bcit-tlu/hriv/commit/ba7c7463d0398fae4c7c9927b82e271d3b18f91c))
* **backend:** async advisory lock + name remaining status indexes ([97eb523](https://github.com/bcit-tlu/hriv/commit/97eb5235bbe61ec2839fb833e837ba687fbc63bc))
* **backend:** async advisory lock + name remaining status indexes ([2e93f70](https://github.com/bcit-tlu/hriv/commit/2e93f7049db59fe9f0c7cab685b96b4cbc9c3a13))
* **backend:** clean up merge markers in README + stamp specific baseline ([92c706a](https://github.com/bcit-tlu/hriv/commit/92c706a8fc9ff4480597953765732de1b4620fc1))
* **backend:** clean up merge markers in README + stamp specific baseline ([d9752a0](https://github.com/bcit-tlu/hriv/commit/d9752a04c2c682d11e56482b4c9fb85983fc58e1))
* **backend:** dedupe COPY and OpenTelemetry deps, restore legacy-stamp branch ([3dc2bfc](https://github.com/bcit-tlu/hriv/commit/3dc2bfc2524b12fa337cd0aa26e46f1000e1542d))
* **backend:** disable OTEL exporters by default in Docker image ([24baf4f](https://github.com/bcit-tlu/hriv/commit/24baf4f3af1e947c49b75cb088aa693979e4e40d))
* **backend:** offload Alembic to worker thread + align server_defaults ([1778bb9](https://github.com/bcit-tlu/hriv/commit/1778bb93172cc9f093383b4401b600934917f6db))
* **backend:** offload Alembic to worker thread + align server_defaults ([dd51d7f](https://github.com/bcit-tlu/hriv/commit/dd51d7f7788df0ba13c704a4a7e48bdc53d47247))
* **backend:** pg_advisory_lock bootstrap + name indexes to match baseline ([1abdf82](https://github.com/bcit-tlu/hriv/commit/1abdf82eb302375c9b59877bf438dd06829281ee))
* **backend:** pg_advisory_lock bootstrap + name indexes to match baseline ([f6549be](https://github.com/bcit-tlu/hriv/commit/f6549bef8c98abce2615f4eefb37183a75bcb65f))
* **backend:** run 'upgrade head' after stamping baseline on legacy DBs ([2040d7b](https://github.com/bcit-tlu/hriv/commit/2040d7b1cc251cc299f97aba5ac1e331d2f9617e))
* **backend:** run 'upgrade head' after stamping baseline on legacy DBs ([1f5aabc](https://github.com/bcit-tlu/hriv/commit/1f5aabc398d4140111bdd1933b605753b2358212))
* **backend:** use --workers 1 in prod Dockerfile for OTEL fork safety ([e0636a8](https://github.com/bcit-tlu/hriv/commit/e0636a825327c8af7cfd0003222cedcb3d6e86f5))
* **migrations:** run advisory-lock connection with AUTOCOMMIT isolation ([10bdd8e](https://github.com/bcit-tlu/hriv/commit/10bdd8eb87b5104633de47a804418ce29878bb88))
* **migrations:** run advisory-lock connection with AUTOCOMMIT isolation ([3e91748](https://github.com/bcit-tlu/hriv/commit/3e91748c8b2f930cb31a04b60009d7e4369720c9))
* **otel,docker:** address Devin Review info findings on PR [#75](https://github.com/bcit-tlu/hriv/issues/75) ([19c853c](https://github.com/bcit-tlu/hriv/commit/19c853cf48d26f25a27b3b27491bf1643dd7fa8f))
* **tests:** update migrations_bootstrap tests for legacy stamp interface ([243ccfc](https://github.com/bcit-tlu/hriv/commit/243ccfc8fb7b01d8c5a34d34db61f636ca4c35cd))

## [0.2.0](https://github.com/bcit-tlu/hriv/compare/backend-v0.1.0...backend-v0.2.0) (2026-04-15)


### Features

* add bulk edit capability to Images page ([baeccee](https://github.com/bcit-tlu/hriv/commit/baeccee2723beca6de143e25572c4578cd7ec980))
* add bulk image import capability for admin role ([834f550](https://github.com/bcit-tlu/hriv/commit/834f55000987c3e4667c17af38e40e15ab8c89c3))
* add drag-and-drop reordering to Manage Categories dialog ([444ec21](https://github.com/bcit-tlu/hriv/commit/444ec21c30df24370d44eada69b60518d64a6b83))
* add filesystem snapshot export/import and source_images to DB backup ([e764a6a](https://github.com/bcit-tlu/hriv/commit/e764a6a99a9999e67b80c14d58dfca554dd1e2c3))
* add processing progress percentage to snackbar ([5c7197b](https://github.com/bcit-tlu/hriv/commit/5c7197b3b0c5f04058f39f23a134a4bda2b83d09))
* add Report Issue modal and version footer ([82fa81f](https://github.com/bcit-tlu/hriv/commit/82fa81fdfe7b61572b55c777715cb3dd68b43f4f))
* add server-side filtering of hidden categories for student role ([963853f](https://github.com/bcit-tlu/hriv/commit/963853fc927424a97b0817f337918aa94f872418))
* add structured JSON logging to backend processing pipeline ([c6b4390](https://github.com/bcit-tlu/hriv/commit/c6b4390529139a3ac94f851fcb3e31e8948ddbd3))
* add TIFF file support with large file upload handling ([04b57a1](https://github.com/bcit-tlu/hriv/commit/04b57a1a42e2bdf37f13f67194234c4b20b95a64))
* **ci:** switch to per-component Release Please packages for independent versioning ([de8ff81](https://github.com/bcit-tlu/hriv/commit/de8ff8108da1d4a8af08cc4017de251435d700ba))
* convert image active status from string to boolean with role-based visibility ([2e9f5fa](https://github.com/bcit-tlu/hriv/commit/2e9f5faabe0e2e043375d8fdef2397ec46512cd9))
* display image dimensions and file size on image cards ([8f1b244](https://github.com/bcit-tlu/hriv/commit/8f1b2447e5981d1bcb14929e503ffed2b4790365))
* frontend design tweaks – breadcrumbs, metadata, toolbars, page styling ([39d7cce](https://github.com/bcit-tlu/hriv/commit/39d7cce036b16a78bec201f3640b4a8a33e07126))
* granular progress tracking via pyvips eval signals and status messages ([571b268](https://github.com/bcit-tlu/hriv/commit/571b268fddf9340b138b310fc8bdbf7d72ac57be))
* mirror Add Image fields in Bulk Import modal via shared ImageMetadataFields component ([6a73c6b](https://github.com/bcit-tlu/hriv/commit/6a73c6bd65cfa7467bbb789ae234f53a3ac53fa8))
* Phase 4 — Performance (nginx tile sidecar + optimised category tree) ([afd9912](https://github.com/bcit-tlu/hriv/commit/afd99122ebdf1fc43eb20bd898d28743d2f085c5))
* Phase 5 — Refinements (optimistic concurrency, task queue, rate limiting) ([178de9c](https://github.com/bcit-tlu/hriv/commit/178de9cb51a476ebdc0942178a755783d2cc0e42))
* reduce health check log noise in local dev ([537a3ee](https://github.com/bcit-tlu/hriv/commit/537a3ee6cab543f168c993c06516ba5ac8272ad0))
* standardize program selection across Upload Image and Bulk Edit modals ([2d68233](https://github.com/bcit-tlu/hriv/commit/2d682335a5ad3443af81b41d3645308e5d1058f0))


### Bug Fixes

* add active param to SourceImage model, upload endpoint, and processing ([0723e8c](https://github.com/bcit-tlu/hriv/commit/0723e8c8620fb5ea6a66297c8fa0f8be3bd5d46d))
* add progress and file_size to admin test mock ([fe7b21c](https://github.com/bcit-tlu/hriv/commit/fe7b21c964effe520a22238eb59a4b01fea27584))
* add redis as explicit dependency in pyproject.toml ([a382f4f](https://github.com/bcit-tlu/hriv/commit/a382f4fd2fdf4cc1f75b434b8055ad17c96a3a1e))
* address Devin Review findings — sidecar placement + 304 headers ([e325b66](https://github.com/bcit-tlu/hriv/commit/e325b666350ae65287ca15c68cd3af1b558ca21d))
* address review concerns - atomic counters, failure detection, category validation ([c975de0](https://github.com/bcit-tlu/hriv/commit/c975de0dd22c2e45448025b0d31fa6b7f6017607))
* address review findings — revert arq in bulk import, fix stale version on clear overlays ([3fc53c0](https://github.com/bcit-tlu/hriv/commit/3fc53c08648ca17c49a37190b273ea6c8359bc36))
* allow students to read programs (GET endpoints) ([e5153c3](https://github.com/bcit-tlu/hriv/commit/e5153c3732f6bc04ac80625491320b23f6a1c2f8))
* assign tmp_path before chunked read loop to prevent temp file leak on error ([c03b8df](https://github.com/bcit-tlu/hriv/commit/c03b8df35339f988b05c8d94ba3cba95e76141ec))
* **auth:** derive jwt_instance_epoch from JWT_SECRET for multi-worker consistency ([3c26b2d](https://github.com/bcit-tlu/hriv/commit/3c26b2d69fee25fc27ea2e6c45ac1b3ca1233024))
* **backend:** address Devin Review findings for PR [#95](https://github.com/bcit-tlu/hriv/issues/95) ([677a0e6](https://github.com/bcit-tlu/hriv/commit/677a0e6415a286291a556443caa6f5a21687076d))
* broaden file cleanup to catch all exceptions, not just HTTPException ([e9882a0](https://github.com/bcit-tlu/hriv/commit/e9882a0616089890cb825ac97b86d6857878ebdf))
* bump version in bulk_update, wrap rate_limit Redis ops in try/except ([3450ed6](https://github.com/bcit-tlu/hriv/commit/3450ed65953dc61df0d28c09da7ea70f4db864c5))
* **chart:** update workload URLs to .latest.ltc.bcit.ca; add epoch derivation tests ([5155709](https://github.com/bcit-tlu/hriv/commit/515570941ad9e43c3c9b64387dab33806230d120))
* clarify login failure log message for missing password_hash case ([0e2c101](https://github.com/bcit-tlu/hriv/commit/0e2c101b51f2681e7c20180f6dd042bd93713f80))
* copy arq CLI binary into runtime image for worker container ([d9a5cf8](https://github.com/bcit-tlu/hriv/commit/d9a5cf87bede6afac08dcbc2227b939e4c4dd5b8))
* eagerly load programs relationship before assignment to prevent MissingGreenlet error ([3ab414f](https://github.com/bcit-tlu/hriv/commit/3ab414fe5636069d648fd640b4a38f63d21cdb68))
* escape &lt; as \u003c in inline script to prevent &lt;/script&gt; injection ([6823954](https://github.com/bcit-tlu/hriv/commit/68239546e8ad49e62fbde3e5bcdac4310879422c))
* escape interpolated values in OIDC redirect HTML to prevent XSS ([80f5199](https://github.com/bcit-tlu/hriv/commit/80f5199068d7e3cb4c71bfaf9db66024565d3b49))
* grant instructor role access to bulk import endpoints and update docs ([b9173ec](https://github.com/bcit-tlu/hriv/commit/b9173ecc597aaac6cfe32161777d1033f8af9f34))
* grant instructor role access to programs and announcement backend endpoints ([07fc154](https://github.com/bcit-tlu/hriv/commit/07fc154f7aadaabb297add62fdf30ebd4c7504de))
* handle multi-value If-None-Match header per RFC 7232 §3.2 ([e0d1fee](https://github.com/bcit-tlu/hriv/commit/e0d1fee9aa9069fa857ef9e94a0241e3d2324083))
* handle unhandled _process_one exceptions and clean up orphaned files ([e7de66d](https://github.com/bcit-tlu/hriv/commit/e7de66dacdc62e9f071dad1287dbe6f4f3a993a3))
* improve OIDC callback debug logging for IdP claim troubleshooting ([f7332dd](https://github.com/bcit-tlu/hriv/commit/f7332dd36706ebb39def9aafd3a62e0fe84aa4f0))
* include progress and file_size in admin export/import round-trip ([bad7b1f](https://github.com/bcit-tlu/hriv/commit/bad7b1f2d0c158fa75d1431e3e13430cead5390f))
* include sort_order in admin export/import for categories ([fff00c0](https://github.com/bcit-tlu/hriv/commit/fff00c0e163b727006dc55f405fc004411fd6296))
* initialize structured logging in arq worker process ([6656c1e](https://github.com/bcit-tlu/hriv/commit/6656c1e1b123b22e9e874f8c3e59c7f5a092d9b7))
* key rate limiter on IP+email composite to prevent shared-IP bypass ([468ab40](https://github.com/bcit-tlu/hriv/commit/468ab407d28698de3bf27e5d21d68de57736bfd2))
* move instance epoch into AuthSettings for multi-worker compatibility ([74a875a](https://github.com/bcit-tlu/hriv/commit/74a875a5e84cd3d7a2b7943737eff4f4db575b5f))
* move PATCH /bulk before /{image_id} to fix route ordering ([6eae2a8](https://github.com/bcit-tlu/hriv/commit/6eae2a8eff7a1df7b2aacf9369416cb253cbb3d1))
* move setup_logging() into lifespan to run after uvicorn init ([110b222](https://github.com/bcit-tlu/hriv/commit/110b2223c81dbfc48e5db37f50966b8ae5ded162))
* **oidc:** catch TimeoutException in startup connectivity probe ([fb89b66](https://github.com/bcit-tlu/hriv/commit/fb89b66e9de8f4a81a169161af534dc5124d6ac2))
* **oidc:** graceful error handling for unreachable IdP and sync chart init SQL ([bd3288b](https://github.com/bcit-tlu/hriv/commit/bd3288bc7f0bd09078304b14fd9a61c44be907a4))
* **oidc:** use generic error detail, catch TimeoutException alongside ConnectError ([b0026ff](https://github.com/bcit-tlu/hriv/commit/b0026ff2b60e85dc6b49ee435976771182f5d561))
* only emit epoch-missing warning when JWT_SECRET was explicitly set ([ab017cf](https://github.com/bcit-tlu/hriv/commit/ab017cfd67edae57bf6a1a339d46e395e91f3ece))
* pass sort_order to CategoryTree and add cycle detection to reorder endpoint ([31f8dca](https://github.com/bcit-tlu/hriv/commit/31f8dca0e0e45b40ac2e426498d6b20a81bb711c))
* pass width/height/file_size in create_image endpoint ([078629d](https://github.com/bcit-tlu/hriv/commit/078629d1b7bf236b43c2692dd80bf1c12e5a4005))
* pin dev test dependency versions to match pyproject.toml ranges ([86e52ad](https://github.com/bcit-tlu/hriv/commit/86e52ad789dcd8608accd5726d903a9ca6f0c7a9))
* reject scoped JWTs (e.g. file-export) from Bearer auth ([f4ab2ca](https://github.com/bcit-tlu/hriv/commit/f4ab2ca979e4a8e321d1102bd729be0660cb82f6))
* remove internal details from client-facing OIDC error responses ([98cc802](https://github.com/bcit-tlu/hriv/commit/98cc802ac6c42643115ac012456a2107a537611d))
* rename JWT claim from 'iss' to '_epoch' to avoid OIDC IdP conflict ([6b42aa5](https://github.com/bcit-tlu/hriv/commit/6b42aa594215a0b40fee9462371e848448179751))
* replace _time_mod.time() with datetime.now(timezone.utc).timestamp() ([9725d7e](https://github.com/bcit-tlu/hriv/commit/9725d7ee9650db04979087133d61f5435c66d483))
* replace extra-keys allowlist with auto-capture, rename filename to original_filename ([fa8519d](https://github.com/bcit-tlu/hriv/commit/fa8519d2e150eae42aed4cdbe5fb202194b9564e))
* reset rate limit on successful login, close Redis client on ping failure ([9af8475](https://github.com/bcit-tlu/hriv/commit/9af8475a85680320221e3ebb4732a5b9a509d2fe))
* resolve stale UI and delayed visit-link after mutations ([5bb206f](https://github.com/bcit-tlu/hriv/commit/5bb206f06339c47eb4f753721b98dee33caa3ecc))
* **tests:** mock pyvips for CI environments without libvips ([5a3071b](https://github.com/bcit-tlu/hriv/commit/5a3071bae5261a387fc6170e3095bd9ce1a3004b))
* update pre-existing tests for Phase 5 request param and version field ([50f3234](https://github.com/bcit-tlu/hriv/commit/50f323408ce55b1b15df81faa2db3157c21f453e))
* update processing.py to use active=True instead of status='active' ([738a09c](https://github.com/bcit-tlu/hriv/commit/738a09c08ff809102349a04956ff5c48da980392))
* use Annotated[] for validation_alias to suppress Pydantic warning ([85d96e6](https://github.com/bcit-tlu/hriv/commit/85d96e697a67db9c88609241b7f19cacdbaaaf7b))
* use atomic JSONB concatenation for errors field to prevent race condition ([3961a88](https://github.com/bcit-tlu/hriv/commit/3961a889555d73e35481ea331fc8edd1ebae2904))
* use backend instance epoch instead of sessionStorage for session invalidation ([d4c921f](https://github.com/bcit-tlu/hriv/commit/d4c921f440d67306bac1fb2534635d8aef2688bb))
* use BigInteger for file_size to support large pathology images (&gt;2GB) ([b61b4df](https://github.com/bcit-tlu/hriv/commit/b61b4dfa92d8d202d6c1e08a2fa83c19234bd49a))
* use client-side redirect for OIDC token delivery ([69e215a](https://github.com/bcit-tlu/hriv/commit/69e215a697c6a2ee4520414e59b7a27d760f2ea1))
* use set() for duplicate ID handling in bulk endpoints ([6c75976](https://github.com/bcit-tlu/hriv/commit/6c75976cf884be4e47d48a103af05815ac0cb452))
* use signed JWT for download tokens to support multi-worker deployment ([c26a470](https://github.com/bcit-tlu/hriv/commit/c26a47076b10c4169f3249e2b6ae48432529eabb))
* use urlparse for Redis URL in worker to handle auth and database ([f9a401a](https://github.com/bcit-tlu/hriv/commit/f9a401a8c55af8b181d511df96749ef820451c75))
* use X-Forwarded-For for client IP, add TTL-based Redis retry backoff ([325d464](https://github.com/bcit-tlu/hriv/commit/325d464b9b7c37a54e49deec6e08480e017e3018))
* wrap reset_login_rate_limit Redis call in try/except to prevent 500 on transient failure ([99f8565](https://github.com/bcit-tlu/hriv/commit/99f85659f8f00d80a6239727c95d967e38805317))
* wrap temp file lifecycle in try/finally to prevent leak when zip streaming fails ([7c3dd40](https://github.com/bcit-tlu/hriv/commit/7c3dd40bda6877935408d9fecac9879e9a9ede8c))


### Performance Improvements

* isolate Poetry in builder venv to exclude it from runtime image ([fc6212b](https://github.com/bcit-tlu/hriv/commit/fc6212ba90f10c3fce21369455410c91651b5167))
* optimize backend Dockerfile with multi-stage build (1.03GB → 398MB) ([dceb4f3](https://github.com/bcit-tlu/hriv/commit/dceb4f3174e696353675cd6ef599cdc481e8a9d7))

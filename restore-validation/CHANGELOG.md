# Changelog

## [0.1.4](https://github.com/bcit-tlu/hriv/compare/restore-validation-v0.1.3...restore-validation-v0.1.4) (2026-09-12)


### Bug Fixes

* **restore-validation:** require tagged PostgreSQL image ([#1274](https://github.com/bcit-tlu/hriv/issues/1274)) ([373faf6](https://github.com/bcit-tlu/hriv/commit/373faf676dbb040b4226a4003296aee13fa9c6c2))
* **restore-validation:** validate PostgreSQL image tag ([#1276](https://github.com/bcit-tlu/hriv/issues/1276)) ([12a1764](https://github.com/bcit-tlu/hriv/commit/12a1764c00a61d234dd05a8361f4a87dc5d27ec5))

## [0.1.3](https://github.com/bcit-tlu/hriv/compare/restore-validation-v0.1.2...restore-validation-v0.1.3) (2026-09-12)


### Bug Fixes

* **restore-validation:** rotate immutable ConfigMaps to v5 ([#1271](https://github.com/bcit-tlu/hriv/issues/1271)) ([2967e24](https://github.com/bcit-tlu/hriv/commit/2967e24b55ef42e21d8ab4b35e84c83dd28b7367))

## [0.1.2](https://github.com/bcit-tlu/hriv/compare/restore-validation-v0.1.1...restore-validation-v0.1.2) (2026-09-12)


### Bug Fixes

* **restore-validation:** accept long digest-pinned image refs ([#1269](https://github.com/bcit-tlu/hriv/issues/1269)) ([baae528](https://github.com/bcit-tlu/hriv/commit/baae528cef13a5b4e571a5dfee3d2b92f1bd0862))
* **restore-validation:** rotate immutable configmaps to v3 ([#1267](https://github.com/bcit-tlu/hriv/issues/1267)) ([42e22ad](https://github.com/bcit-tlu/hriv/commit/42e22ad85d5f6ad30e2639fdb843771b1cc13faf))
* **restore-validation:** rotate immutable configmaps to v4 ([#1270](https://github.com/bcit-tlu/hriv/issues/1270)) ([7bb2791](https://github.com/bcit-tlu/hriv/commit/7bb279191a0b29c3369e5d2eeab408c5189e752f))

## [0.1.1](https://github.com/bcit-tlu/hriv/compare/restore-validation-v0.1.0...restore-validation-v0.1.1) (2026-09-12)


### Bug Fixes

* **restore-validation:** serialize lease times as MicroTime ([#1266](https://github.com/bcit-tlu/hriv/issues/1266)) ([b603405](https://github.com/bcit-tlu/hriv/commit/b6034053f9d1a5151fc00a36f8493da4f920446d))
* **restore:** bound Helm chart label ([#1264](https://github.com/bcit-tlu/hriv/issues/1264)) ([f307323](https://github.com/bcit-tlu/hriv/commit/f307323bb019ced1a0662e734c68f1e7544df929))

## 0.1.0 (2026-09-12)


### Features

* **restore:** operate weekly core recovery drills ([#1261](https://github.com/bcit-tlu/hriv/issues/1261)) ([b9b8500](https://github.com/bcit-tlu/hriv/commit/b9b85009b8cbd02ae06613ac991b4239b004c749))
* **restore:** orchestrate isolated core recovery ([#1259](https://github.com/bcit-tlu/hriv/issues/1259)) ([08bd4ee](https://github.com/bcit-tlu/hriv/commit/08bd4ee2dc066ddb371726b31a45ba2f093a08dc))


### Bug Fixes

* triggering CI build for all components ([#937](https://github.com/bcit-tlu/hriv/issues/937)) ([2f5745a](https://github.com/bcit-tlu/hriv/commit/2f5745a1845399f7cb964cfa73999483d1f7624b))

## 0.0.0

- Add the issue #1251 core-only restore-validation controller and chart integration.
- Use deployed CNPG `targetTLI`, fixed validation-local Barman source authority, read-only Azure credentials, and fresh generated superuser credentials.
- Add strict profile/policy/template and machine schemas, psycopg database/consistency children, Pod-log result ownership checks, quota preflight, and asynchronous cleanup.
- Preserve the explicit `core_succeeded` boundary without advancing `last_complete_success`.

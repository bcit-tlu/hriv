# Changelog

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

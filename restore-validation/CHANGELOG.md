# Changelog

## 0.0.0

- Add the issue #1251 core-only restore-validation controller and chart integration.
- Use deployed CNPG `targetTLI`, fixed validation-local Barman source authority, read-only Azure credentials, and fresh generated superuser credentials.
- Add strict profile/policy/template and machine schemas, psycopg database/consistency children, Pod-log result ownership checks, quota preflight, and asynchronous cleanup.
- Preserve the explicit `core_succeeded` boundary without advancing `last_complete_success`.

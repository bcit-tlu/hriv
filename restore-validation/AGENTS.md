# Restore Validation

Isolated Python orchestrator for production-shaped restore drills —
independent from `backup/`. Its chart must remain non-runnable by default
and requires reviewed, digest-pinned images and environment-specific source
inputs. #1251 renders default-deny only; #1253 owns fixed reviewed
Azure/API/DNS/CNPG egress, admission enforcement, and rollout.

Commands run from `restore-validation/`:

- Install dependencies: `poetry install --with dev`
- Tests: `poetry run python -m unittest discover tests` — requires `helm`
  already on `PATH` (`nix-shell -p kubernetes-helm` when needed); a
  `helm unavailable` skip is not acceptable chart coverage.
- Compile check: `poetry run python -m compileall -q hriv_restore_validation tests`

The normative isolation/least-privilege contract is
[`docs/restore-validation.md`](../docs/restore-validation.md); the
"Changed restore-validation controller or chart" row of
[`docs/agent-test-matrix.md`](../docs/agent-test-matrix.md) lists the full
verification set.

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from .controller import Controller, make_run_id
from .kubernetes_gateway import KubernetesGateway
from .models import Config, SourcePolicy, SourceProfile, Templates, Trigger
from .strict import ValidationError
from .validators import emit_result, validate_consistency, validate_database

LOG = logging.getLogger("hriv_restore_validation")


def _path(environment: str, default: str) -> Path:
    return Path(os.environ.get(environment, default))


def _read(environment: str, default: str) -> bytes:
    return _path(environment, default).read_bytes()


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="hriv-restore-validation")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("run")
    database = commands.add_parser("validate-database")
    database.add_argument("--host", required=True)
    database.add_argument("--capture-started-at", required=True)
    database.add_argument("--wal-fence-committed-at", required=True)
    database.add_argument("--target-lsn", required=True)
    database.add_argument("--target-tli", required=True, type=int)
    consistency = commands.add_parser("validate-consistency")
    consistency.add_argument("--host", required=True)
    consistency.add_argument("--source", required=True)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    try:
        profile = SourceProfile.parse(_read("RESTORE_VALIDATION_PROFILE", "/etc/hriv/profile.json"))
        if args.command == "validate-database":
            emit_result(validate_database(profile, args.host, args.capture_started_at, args.wal_fence_committed_at, args.target_lsn, args.target_tli, _path("RESTORE_VALIDATION_DB_CREDENTIALS", "/credentials")))
            return 0
        policy = SourcePolicy.parse(_read("RESTORE_VALIDATION_POLICY", "/etc/hriv/policy.json"))
        if args.command == "validate-consistency":
            emit_result(validate_consistency(profile, policy, args.host, Path(args.source), _path("RESTORE_VALIDATION_DB_CREDENTIALS", "/credentials")))
            return 0
        settings = Config.parse(_read("RESTORE_VALIDATION_CONFIG", "/etc/hriv/config.json"))
        templates = Templates.parse(_read("RESTORE_VALIDATION_TEMPLATES", "/etc/hriv/templates.yaml"), profile)
        trigger = Trigger(os.environ.get("TRIGGER", "on_demand"), os.environ["JOB_NAME"], os.environ["JOB_UID"], os.environ.get("POD_UID"))
        run_id = os.environ.get("RUN_ID") or make_run_id(datetime.now(timezone.utc))
        controller = Controller(KubernetesGateway(settings.namespace), settings, profile, policy, templates)
        while True:
            outcome = controller.run(trigger, run_id)
            if outcome != "running":
                LOG.info("restore validation terminal outcome=%s run_id=%s", outcome, run_id)
                return 0 if outcome in {"succeeded", "rejected"} else 1
            time.sleep(min(10, settings.lease_seconds // 3))
            controller.renew(trigger, run_id)
    except ValidationError as exc:
        if args.command in {"validate-database", "validate-consistency"}:
            emit_result({"schema_version": 1, "operation": args.command, "success": False, "failure_code": exc.code})
        else:
            LOG.error("restore validation failed code=%s", exc.code)
        return 1
    except Exception as exc:
        LOG.error("unexpected runtime exception type=%s", type(exc).__name__)
        if args.command in {"validate-database", "validate-consistency"}:
            emit_result({"schema_version": 1, "operation": args.command, "success": False, "failure_code": "INTERNAL_FAILURE"})
        return 1


if __name__ == "__main__":
    sys.exit(main())

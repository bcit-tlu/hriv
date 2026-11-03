"""Create (or delete) the 45 prefixed load-test accounts for #1670.

Run inside the hriv-backend pod:
    kubectl exec -i deploy/hriv-backend -- env LOADTEST_PASSWORD=... python - create < scripts/count_load_accounts.py
    kubectl exec -i deploy/hriv-backend -- python - delete < scripts/count_load_accounts.py

Idempotent. Accounts: loadtest-count-s01..s40 (student), -i01..i05
(instructor), emails <name>@loadtest.invalid; every row is flagged
synthetic so auth/actor logs classify it. Only the exact roster emails
are ever touched — no wildcard.
"""

import asyncio
import os
import sys

from sqlalchemy import delete, select

from app.auth import hash_password
from app.auth_events import SYNTHETIC_METADATA_KEY
from app.database import async_session
from app.models import User

PREFIX = "loadtest-count-"
DOMAIN = "@loadtest.invalid"
ACCOUNTS = [(f"{PREFIX}s{i:02d}", "student") for i in range(1, 41)] + [
    (f"{PREFIX}i{i:02d}", "instructor") for i in range(1, 6)
]
EMAILS = [name + DOMAIN for name, _ in ACCOUNTS]


async def create() -> None:
    password = os.environ["LOADTEST_PASSWORD"]
    pw_hash = hash_password(password)
    async with async_session() as db:
        existing = (
            (await db.execute(select(User).where(User.email.in_(EMAILS))))
            .scalars()
            .all()
        )
        by_email = {row.email: row for row in existing}
        added = 0
        backfilled = 0
        for name, role in ACCOUNTS:
            email = name + DOMAIN
            row = by_email.get(email)
            if row is not None:
                meta = row.metadata_ or {}
                if not meta.get(SYNTHETIC_METADATA_KEY):
                    row.metadata_ = {**meta, SYNTHETIC_METADATA_KEY: True}
                    backfilled += 1
                continue
            db.add(
                User(
                    name=name,
                    email=email,
                    password_hash=pw_hash,
                    role=role,
                    active=True,
                    metadata_={SYNTHETIC_METADATA_KEY: True},
                )
            )
            added += 1
        await db.commit()
    print(f"created={added} backfilled={backfilled} total={len(ACCOUNTS)}")


async def remove() -> None:
    async with async_session() as db:
        result = await db.execute(
            delete(User).where(User.email.in_(EMAILS))
        )
        await db.commit()
    print(f"deleted={result.rowcount}")


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "create"
    asyncio.run(create() if action == "create" else remove())

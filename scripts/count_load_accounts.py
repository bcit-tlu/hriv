"""Create (or delete) prefixed load-test accounts for #1670 on hriv latest.

Run inside the hriv-backend pod:
    kubectl exec -i deploy/hriv-backend -- env LOADTEST_PASSWORD=... python - create < scripts/count_load_accounts.py
    kubectl exec -i deploy/hriv-backend -- python - delete < scripts/count_load_accounts.py

Idempotent. Accounts: loadtest-count-s01..s40 (student), -i01..i05
(instructor), emails <name>@loadtest.invalid. Only rows whose email starts
with the prefix are ever touched.
"""

import asyncio
import os
import sys

from sqlalchemy import delete, select

from app.auth import hash_password
from app.database import async_session
from app.models import User

PREFIX = "loadtest-count-"
DOMAIN = "@loadtest.invalid"
ACCOUNTS = [(f"{PREFIX}s{i:02d}", "student") for i in range(1, 41)] + [
    (f"{PREFIX}i{i:02d}", "instructor") for i in range(1, 6)
]


async def create() -> None:
    password = os.environ["LOADTEST_PASSWORD"]
    pw_hash = hash_password(password)
    async with async_session() as db:
        existing = set(
            (await db.execute(select(User.email).where(User.email.like(f"{PREFIX}%"))))
            .scalars()
            .all()
        )
        added = 0
        for name, role in ACCOUNTS:
            email = name + DOMAIN
            if email in existing:
                continue
            db.add(User(name=name, email=email, password_hash=pw_hash, role=role, active=True))
            added += 1
        await db.commit()
    print(f"created={added} existing={len(existing)} total={len(ACCOUNTS)}")


async def remove() -> None:
    async with async_session() as db:
        result = await db.execute(delete(User).where(User.email.like(f"{PREFIX}%{DOMAIN}")))
        await db.commit()
    print(f"deleted={result.rowcount}")


action = sys.argv[1] if len(sys.argv) > 1 else "create"
asyncio.run(create() if action == "create" else remove())

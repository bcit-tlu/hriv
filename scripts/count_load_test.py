"""#1670 lab-burst load test for object counting (hriv latest).

Scenario (issue #1670): 30 distinct users submit one count each within 30 s,
then 15 more over the next 4 minutes; Cells/Nuclei mix; selection sizes from
small to the budget limit plus deliberate over-budget selections; a few users
cancel and re-run. Clients poll like the UI (1 s -> 1.5 -> 2 -> 3 s backoff).

Usage: python count_load_test.py BASE_URL PASSWORD_FILE OUT_JSONL [--seed N]
Writes one JSON line per job and prints a summary.

Notes:
- PRESETS image ids and coordinates below are specific to the `latest`
  deployment (78 = blood WSI, 83 = H&E WSI, 343 = smear photo) and must
  be adjusted for other environments.
- Accounts come from scripts/count_load_accounts.py.
- Client-side end-to-end times are quantised by the UI-like poll backoff
  (1 s -> 1.5 -> 2 -> 3 s), so they slightly overstate server time.
"""

import asyncio
import json
import random
import sys
import time

import httpx

STUDENTS = [f"loadtest-count-s{i:02d}@loadtest.invalid" for i in range(1, 41)]
INSTRUCTORS = [f"loadtest-count-i{i:02d}@loadtest.invalid" for i in range(1, 6)]
HEADERS = {"X-Client-Synthetic": "true"}
POLL = [1.0, 1.5, 2.0, 3.0]

# (image_id, mode, selection, expectation) — level-0 px. "over" = deliberately
# over budget at the size-driven level (expect 422 or job error too_large).
PRESETS = [
    (78, "cells", (12800, 2560, 1024, 1024), "ok"),     # blood WSI, ~250 RBC
    (78, "cells", (11264, 2048, 600, 600), "ok"),
    (78, "nuclei", (12800, 2560, 800, 800), "ok"),
    (83, "nuclei", (18944, 1024, 800, 800), "ok"),      # H&E, ~700 nuclei
    (83, "nuclei", (19456, 2048, 600, 600), "ok"),
    (83, "nuclei", (19200, 1280, 800, 800), "ok"),      # at the 750k budget incl. margin
    (83, "cells", (18944, 1024, 1200, 1200), "ok"),
    (343, "cells", (0, 0, 2880, 2048), "ok"),           # whole smear photo (d=4)
    (343, "cells", (900, 500, 1200, 1000), "ok"),
    (83, "nuclei", (18000, 1000, 1400, 1400), "over"),  # > ML budget
]


async def login(client: httpx.AsyncClient, base: str, password: str, email: str) -> str:
    r = await client.post(f"{base}/api/auth/login", json={"email": email, "password": password}, headers=HEADERS)
    r.raise_for_status()
    return r.json()["access_token"]


async def run_job(client, base, token, user, preset, out, t0, cancel_after=None, tag=""):
    image_id, mode, (x, y, w, h), expect = preset
    hdr = {**HEADERS, "Authorization": f"Bearer {token}"}
    rec = {"user": user, "image_id": image_id, "mode": mode, "w": w, "h": h, "expect": expect, "tag": tag}
    rec["t_submit"] = time.monotonic() - t0
    s = time.monotonic()
    r = await client.post(f"{base}/api/images/{image_id}/counts", json={"mode": mode, "selection": {"x": x, "y": y, "width": w, "height": h}}, headers=hdr)
    rec["post_ms"] = round((time.monotonic() - s) * 1000)
    rec["post_status"] = r.status_code
    if r.status_code != 202:
        rec["status"] = "rejected"
        rec["detail"] = (r.json() or {}).get("detail") if r.headers.get("content-type", "").startswith("application/json") else r.text[:80]
        out.append(rec)
        return
    job_id = r.json()["job_id"]
    step, polls = 0, []
    first_running = None
    while True:
        await asyncio.sleep(POLL[min(step, len(POLL) - 1)])
        step += 1
        # Always observe the job first: a job that reached done/failed before
        # the cancel point is recorded normally, not mislabelled "cancelled".
        s = time.monotonic()
        g = await client.get(f"{base}/api/counts/{job_id}", headers=hdr)
        polls.append(round((time.monotonic() - s) * 1000))
        if g.status_code != 200:
            rec.update(status=f"http_{g.status_code}", t_end=time.monotonic() - t0)
            break
        j = g.json()
        if j["status"] == "running" and first_running is None:
            first_running = time.monotonic() - t0
        if j["status"] in ("done", "failed"):
            rec.update(status=j["status"], error=j.get("error"), total=j.get("total"), t_end=time.monotonic() - t0)
            break
        if (
            cancel_after is not None
            and step >= cancel_after
            and j["status"] in ("queued", "running")
        ):
            d = await client.delete(f"{base}/api/counts/{job_id}", headers=hdr)
            if d.status_code == 204:
                rec.update(status="cancelled", cancel_status=204, t_end=time.monotonic() - t0)
            else:
                rec.update(status=f"cancel_http_{d.status_code}", cancel_status=d.status_code, t_end=time.monotonic() - t0)
            break
        if time.monotonic() - t0 - rec["t_submit"] > 600:
            rec.update(status="client_timeout", t_end=time.monotonic() - t0)
            break
    rec["t_first_running"] = first_running
    rec["e2e_s"] = round(rec["t_end"] - rec["t_submit"], 2)
    rec["poll_ms"] = polls
    out.append(rec)
    # Free the user's cap and Redis keys like the UI does on clear.
    if rec.get("status") in ("done", "failed"):
        await client.delete(f"{base}/api/counts/{job_id}", headers=hdr)


def is_unexpected(rec: dict) -> bool:
    """Whether a job record is an unexpected outcome.

    Transport/API failures are always unexpected. `rejected` and `failed`
    are only expected for `expect == "over"` presets with the matching
    budget signal; `done` and `cancelled` are expected.
    """
    status = rec.get("status", "")
    if status.startswith(("http_", "cancel_http_")) or status == "client_timeout":
        return True
    if status == "rejected":
        return not (
            rec.get("expect") == "over"
            and rec.get("post_status") == 422
            and rec.get("detail") == "selection_too_large"
        )
    if status == "failed":
        return not (rec.get("expect") == "over" and rec.get("error") == "too_large")
    return False


def pct(vals, p):
    vals = sorted(vals)
    return round(vals[min(len(vals) - 1, int(round(p / 100 * (len(vals) - 1))))], 2) if vals else None


async def _later(delay, coro):
    await asyncio.sleep(delay)
    return await coro


async def main(base: str, password: str, out_path: str, seed: int) -> None:
    rnd = random.Random(seed)
    out: list[dict] = []
    limits = httpx.Limits(max_connections=200, max_keepalive_connections=100)
    async with httpx.AsyncClient(timeout=30, limits=limits) as client:
        users = STUDENTS[:40] + INSTRUCTORS
        tokens = dict(zip(users, await asyncio.gather(*(login(client, base, password, u) for u in users))))
        t0 = time.monotonic()
        tasks = []
        burst = users[:30]
        trickle = users[30:45]
        for i, u in enumerate(burst):  # 30 within 30 s
            preset = PRESETS[i % len(PRESETS)]
            cancel_after = 2 if i in (5, 17) else None
            delay = rnd.uniform(0, 30)
            tasks.append(asyncio.create_task(_later(delay, run_job(client, base, tokens[u], u, preset, out, t0, cancel_after, "burst"))))
        for i, u in enumerate(trickle):  # 15 more over the next 4 minutes
            preset = PRESETS[(i * 3) % len(PRESETS)]
            delay = 30 + rnd.uniform(0, 240)
            tasks.append(asyncio.create_task(_later(delay, run_job(client, base, tokens[u], u, preset, out, t0, None, "trickle"))))
        for u in burst[:4]:  # re-runs: same users count again 60–120 s in
            preset = PRESETS[rnd.randrange(len(PRESETS) - 1)]
            tasks.append(asyncio.create_task(_later(rnd.uniform(60, 120), run_job(client, base, tokens[u], u, preset, out, t0, None, "rerun"))))
        await asyncio.gather(*tasks)
    with open(out_path, "w") as f:
        for r in sorted(out, key=lambda r: r["t_submit"]):
            f.write(json.dumps(r) + "\n")
    done = [r for r in out if r.get("status") == "done"]
    e2e = [r["e2e_s"] for r in done]
    waits = [round(r["t_first_running"] - r["t_submit"], 2) for r in done if r.get("t_first_running")]
    polls = [p for r in out for p in r.get("poll_ms", [])]
    posts = [r["post_ms"] for r in out]
    by_status: dict = {}
    for r in out:
        key = r.get("status") + (f":{r.get('error') or r.get('detail')}" if r.get("status") in ("failed", "rejected") else "")
        by_status[key] = by_status.get(key, 0) + 1
    unexpected_fail = [r for r in out if is_unexpected(r)]
    summary = {
        "jobs": len(out), "by_status": by_status,
        "e2e_s": {"p50": pct(e2e, 50), "p95": pct(e2e, 95), "max": max(e2e) if e2e else None},
        "observed_wait_s": {"p50": pct(waits, 50), "p95": pct(waits, 95), "max": max(waits) if waits else None, "n": len(waits)},
        "poll_ms": {"p50": pct(polls, 50), "p95": pct(polls, 95), "n": len(polls)},
        "post_ms": {"p50": pct(posts, 50), "p95": pct(posts, 95)},
        "unexpected_failures": len(unexpected_fail),
        "span_s": round(max(r.get("t_end", r["t_submit"]) for r in out), 1),
    }
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    BASE, PW_FILE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
    SEED = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 1662
    with open(PW_FILE) as f:
        PASSWORD = f.read().strip()
    asyncio.run(main(BASE, PASSWORD, OUT, SEED))

# Deployment proxy chain and client IP resolution

The backend derives the client IP for audit logs and the login rate limiter
from `X-Forwarded-For` (XFF). This page documents the assumed proxy chain and
how `TRUSTED_PROXY_HOPS` must be set for it.

## Why the leftmost XFF entry is never trusted

Every proxy in the chain _appends_ the address of its downstream peer to XFF
(nginx `$proxy_add_x_forwarded_for`, ingress-nginx
`compute-full-forwarded-for`). A client that sends its own
`X-Forwarded-For: 1.2.3.4` therefore arrives at the backend as
`1.2.3.4, <real client>, ...`. Taking the leftmost entry lets an attacker pick
an arbitrary "client IP" per request and mint a fresh login rate-limit bucket
each time (finding: login rate limit bypass via spoofed XFF).

`get_client_ip()` in `backend/app/middleware.py` instead takes the entry
`TRUSTED_PROXY_HOPS` positions from the **right** — the address recorded by the
outermost trusted proxy. Rules:

- `TRUSTED_PROXY_HOPS = N > 0`: return `entries[-N]`. If XFF has fewer than
  `N` entries, fall back to `X-Real-IP` (nginx `$remote_addr`), then to the
  direct TCP peer (`scope["client"]`). The header is never read from the
  left, so a short header cannot be used to inject a value.
- `TRUSTED_PROXY_HOPS = 0`: ignore forwarding headers; use the direct peer.

uvicorn runs **without** `--proxy-headers` / `--forwarded-allow-ips '*'`:
with a wildcard trust list uvicorn's `ProxyHeadersMiddleware` rewrites
`scope["client"]` from the same client-controlled leftmost entry, so it would
reintroduce the bypass. `X-Forwarded-Proto` is read directly from the request
where a scheme is needed (download cookie `secure` flag).

## Assumed chains

| Deployment                    | Chain (client → backend)                                                     | `TRUSTED_PROXY_HOPS` |
| ----------------------------- | ---------------------------------------------------------------------------- | -------------------- |
| docker-compose / local        | Vite dev proxy (`xfwd: true`, appends) or frontend nginx (appends) → uvicorn | `1` (default)        |
| `latest` / `stable` (fleet)   | HAProxy gateway (**overwrites** XFF with client IP) → ingress-nginx (appends) → frontend nginx (appends) → uvicorn | `3`                  |
| Direct `uvicorn --reload` dev | none (requests hit port 8000 directly)                                       | `0`                  |

Any path that reaches uvicorn without an appending proxy (e.g. curl straight
to `localhost:8000` in docker-compose) must run with `TRUSTED_PROXY_HOPS=0`;
with `1` the client's own `X-Forwarded-For` would be the only entry and would
be trusted.

For the fleet chain the header seen by the backend is
`<client>, <haproxy>, <ingress-nginx pod>`; `entries[-3]` is the client. The
HAProxy edge is authoritative: because it overwrites rather than appends, any
XFF the client sent is discarded before the chain begins. ingress-nginx must
run with `use-forwarded-headers: "true"` and `compute-full-forwarded-for:
"true"` (see `bcit-tlu/flux-fleet` ingress-nginx config) so it appends rather
than replaces; if it replaced, the client address would be lost entirely and
the fallback would attribute every login to the ingress address.

The value lives in the backend Helm chart's `env` map (`TRUSTED_PROXY_HOPS`,
`charts/backend/values.yaml`) and is set per environment in the `flux-fleet`
overlays (`apps/overlays/{latest,stable}/hriv/backend/values-*.yaml`).

## Verifying the setting

Log in from a known address and inspect the audit log line for
`POST /api/auth/login`: `client_ip` must equal your public address. If it
shows an internal pod/gateway address the hop count is too low or too high
(too high falls back to `X-Real-IP`, i.e. the frontend nginx's peer). Adjust
`TRUSTED_PROXY_HOPS` rather than the parsing rule.

## Login rate limiting

Two Redis sliding-window buckets guard `POST /api/auth/login`
(`backend/app/rate_limit.py`):

| Bucket                     | Key                          | Default budget              |
| -------------------------- | ---------------------------- | --------------------------- |
| per (client IP, email)     | `rate:login:{ip}:{email}`    | `RATE_LIMIT_LOGIN_MAX=5` / `RATE_LIMIT_LOGIN_WINDOW=60s`         |
| per email (IP-independent) | `rate:login:email:{email}`   | `RATE_LIMIT_LOGIN_EMAIL_MAX=20` / `RATE_LIMIT_LOGIN_EMAIL_WINDOW=900s` |

The per-IP bucket is checked first and short-circuits so a throttled source
does not consume the account-wide budget; a successful login clears both. The
account-scoped bucket bounds password guessing against one account even if the
source address cannot be trusted at all. Redis outages fail open and log
`rate_limit.redis_unavailable` / `rate_limit.redis_error` at WARNING.

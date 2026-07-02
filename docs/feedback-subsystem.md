# Feedback Subsystem

## Summary

HRIV exposes a single in-app feedback entrypoint through `POST /api/issues/report`
and the frontend "Report Issue" modal. The product goal is to keep that user
experience low-friction while allowing deployments to route submissions
differently by environment.

Issue [#757](https://github.com/bcit-tlu/hriv/issues/757) defines the redesign
goal: decouple the in-app submission flow from the downstream destination so
pre-production and production can use different triage workflows without a UI
rewrite. Issue [#713](https://github.com/bcit-tlu/hriv/issues/713) remains a
separate UX follow-up because the current modal still does not show the returned
tracking link.

## Current Architecture

Backend foundation introduced in issue `#786`:

- the router still accepts `description` and `page_url`
- rate limiting and sanitization still happen before delivery
- a feedback delivery provider is resolved at runtime
- the provider returns a generic delivery result:
  - `destination`
  - `tracking_url`
  - legacy `issue_url` alias for GitHub compatibility

This keeps the API stable enough for the current frontend while making it
possible to add non-GitHub providers behind the same endpoint.

## Delivery Policy

The intended routing policy is:

- `latest` / pre-production: route directly into the developer workflow
  (currently GitHub)
- `stable` / production: route into institutional support and triage systems
  instead of creating public GitHub issues

That production policy is what drives the follow-up provider work for MS Teams
and ServiceNow.

## Provider Configuration

The backend chart now uses a generic `feedback` block:

```yaml
feedback:
  provider: github
  github:
    repository: bcit-tlu/hriv
    token:
      existingSecret: github-report-issue-token
```

Supported providers today:

- `""` / disabled
- `github`

Planned providers tracked in follow-up issues:

- `teams` (`#787`)
- `servicenow` (`#788`)

Legacy `github-issue.*` chart values are still accepted as a fallback while
overlays move to the new config.

## Planned Issue Split

- `#786` feedback foundation: abstract delivery and config
- `#787` feedback delivery: add MS Teams provider
- `#788` feedback delivery: add ServiceNow provider
- `#789` feedback UX: show submission outcome and tracking link

## Notes For Future Providers

- Providers must accept already-sanitized text and page metadata from the router.
- Providers should return a tracking URL only when it is safe and useful to show
  to the submitting user.
- The frontend should not assume every provider behaves like GitHub.

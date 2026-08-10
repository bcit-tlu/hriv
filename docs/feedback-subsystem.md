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
- `teams`

Planned providers tracked in follow-up issues:

- `servicenow` (`#788`)

Legacy `github-issue.*` chart values are still accepted as a fallback while
overlays move to the new config.

For non-chart or transitional environments, the backend also honors legacy
`GITHUB_TOKEN` plus `GITHUB_REPO` environment variables when
`FEEDBACK_DELIVERY_PROVIDER` is unset. That implicit GitHub path exists only for
upgrade compatibility and should not be treated as the preferred long-term
configuration shape.

## Planned Issue Split

- `#786` feedback foundation: abstract delivery and config
- `#787` feedback delivery: add MS Teams provider
- `#788` feedback delivery: add ServiceNow provider
- `#789` feedback UX: show submission outcome and tracking link

## MS Teams Provider

Issue `#787` adds a production-oriented Teams provider that posts to a channel
webhook URL configured in the backend chart. The provider uses a compact
Adaptive Card payload so the channel receives triage-friendly structure instead
of an unformatted text blob.

Delivered fields:

- submission text
- role
- internal user id
- page URL
- deployed app version
- submission timestamp (UTC)

Chart configuration:

```yaml
feedback:
  provider: teams
  teams:
    webhook:
      existingSecret: hriv-feedback-teams-webhook
```

The referenced secret must expose key `url`, which becomes
`FEEDBACK_TEAMS_WEBHOOK_URL` in the backend pod.

This implementation targets a Teams channel webhook endpoint. It does not yet
create a user-visible tracking link, so the frontend still behaves the same as
before; issue `#789` remains the UI follow-up and issue `#713` is still only
fully satisfied for destinations that return a safe tracking URL.

## Notes For Future Providers

- Providers must accept already-sanitized text and page metadata from the router.
- Providers should return a tracking URL only when it is safe and useful to show
  to the submitting user.
- The frontend should not assume every provider behaves like GitHub.

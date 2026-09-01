# Feedback Subsystem

## Summary

HRIV exposes a single in-app feedback entrypoint through `POST /api/issues/report`
and the frontend "Send Feedback" modal. The product goal is to keep that user
experience low-friction while allowing deployments to route submissions
differently by environment.

Issue [#757](https://github.com/bcit-tlu/hriv/issues/757) defined the redesign
goal: decouple the in-app submission flow from the downstream destination so
pre-production and production can use different triage workflows without a UI
rewrite. Issue [#788](https://github.com/bcit-tlu/hriv/issues/788) switched the
primary destination from GitHub issues to email via the BCIT SMTP relay, while
keeping the MS Teams webhook provider available for future use.

## Current Architecture

The modal now asks the user what kind of feedback they are submitting:

- `problem_or_issue`
- `comment_or_suggestion`

That `feedback_type` is sent with `description` and `page_url` to
`POST /api/issues/report`. The backend sanitizes the text, applies per-user rate
limiting, and delegates delivery to a runtime provider.

Backend delivery is abstracted in `backend/app/feedback.py`:

- `FeedbackSubmission` carries `feedback_type`, `description`, `page_url`,
  user id/role, app version, and submission timestamp.
- `FeedbackDelivery` is a `Protocol` with `submit()` returning a
  `FeedbackDeliveryResult` (`destination`, optional `tracking_url`,
  optional `external_id`).
- `EmailFeedbackDelivery` sends a `text/plain` message through the configured
  SMTP relay using Python stdlib `smtplib`.
- `TeamsFeedbackDelivery` posts an Adaptive Card to a webhook URL.
- `get_feedback_delivery()` resolves the provider from `FEEDBACK_DELIVERY_PROVIDER`
  (`email` or `teams`); unsupported providers raise `FeedbackNotConfiguredError`.

The GitHub issue provider and all related env/chart wiring were removed.

## API Contract

`POST /api/issues/report` body:

```json
{
  "description": "string (1-2000 chars)",
  "page_url": "string (1-2000 chars)",
  "feedback_type": "problem_or_issue" | "comment_or_suggestion"
}
```

`ReportIssueResponse`:

```json
{
  "destination": "email",
  "tracking_url": null,
  "issue_url": null
}
```

`issue_url` remains part of the schema for backward compatibility but is always
`null` now that GitHub delivery is gone.

## Delivery Policy

The intended routing policy is:

- `latest` / pre-production: route to `email` (TLU TechOps inbox) for triage.
- `stable` / production: route to `email` (TLU TechOps inbox) for triage.

The MS Teams provider is retained for future routing but is not enabled by
default.

## Provider Configuration

### Email

Runtime environment variables (injected from a Kubernetes secret):

- `FEEDBACK_EMAIL_SMTP_SERVER` — e.g. `smtp.relay.bcit.ca`
- `FEEDBACK_EMAIL_SMTP_PORT` — plain integer or a JSON object like
  `{"ssl": 465, "tls": [25, 587]}`
- `FEEDBACK_EMAIL_USERNAME` — SMTP auth username
- `FEEDBACK_EMAIL_PASSWORD` — SMTP auth password
- `FEEDBACK_EMAIL_FROM` — defaults to the username
- `FEEDBACK_EMAIL_TO` — defaults to `tlu_techops@bcit.ca`
- `FEEDBACK_EMAIL_SMTP_SECURITY` — optional `starttls`, `ssl`, `none`, or `auto`

`EmailFeedbackDelivery` resolves the port and security mode automatically. Port
465 uses SSL; other ports default to STARTTLS unless overridden.

Chart configuration:

```yaml
feedback:
  provider: email
  email:
    existingSecret: hriv-feedback-smtp-relay
    to: tlu_techops@bcit.ca
    from: hriv-no-reply@bcit.ca
```

### MS Teams

```yaml
feedback:
  provider: teams
  teams:
    webhook:
      existingSecret: hriv-feedback-teams-webhook
```

The referenced secret must expose key `url`, which becomes
`FEEDBACK_TEAMS_WEBHOOK_URL` in the backend pod.

## Troubleshooting

A `503` from `POST /api/issues/report` means the backend did not attempt an
external delivery because the provider is disabled, unsupported, or missing a
required non-empty setting. A `502` means a configured provider was selected,
but SMTP or Teams delivery failed.

Inspect the rendered backend Deployment without printing secret values:

```bash
kubectl -n <namespace> get deploy <backend-deployment> \
  -o jsonpath='{range .spec.template.spec.containers[?(@.name=="backend")].env[*]}{.name}{"\t"}{.value}{"\t"}{.valueFrom.secretKeyRef.name}{"/"}{.valueFrom.secretKeyRef.key}{"\n"}{end}' \
  | grep '^FEEDBACK_'
```

Check which feedback variables are set and non-empty inside the running pod.
This prints only state, never values:

```bash
kubectl -n <namespace> exec deploy/<backend-deployment> -c backend -- python -c \
  'import os; names=sorted(n for n in os.environ if n.startswith("FEEDBACK_")); print("\n".join(n+"=<"+("set" if os.environ[n] else "empty")+">" for n in names) or "no FEEDBACK_* variables")'
```

For email delivery, confirm the referenced Secret contains the required keys
without decoding their values:

```bash
kubectl -n <namespace> get secret <feedback-secret> \
  -o go-template='{{range $key, $_ := .data}}{{$key}}{{"\n"}}{{end}}'
```

Required email keys are `smtp_server`, `smtp_port`, `username`, and `password`.
After correcting Helm values or the Secret, restart the backend Deployment and
retry the submission. Backend logs emit `feedback.delivery_not_configured` with
the safe configuration reason for a `503`, or `feedback.delivery_failed` with
the provider error for a `502`; correlate either event with the request id from
the `POST /api/issues/report` audit log.

## Submission Outcome UX

The modal title is "Send Feedback". Successful submissions display a success
snackbar with "Thanks! Your feedback has been received." and auto-close the
modal. Submission failures display an error snackbar with a status-aware message
from the backend.

`tracking_url` is not expected for email or Teams delivery, so the modal does
not show a "Track your report" link for those providers. If a future provider
returns an absolute `http(s)` URL, the modal will still surface it and keep
the modal open until the user dismisses it.

## Notes For Future Providers

- Providers must accept already-sanitized text and page metadata from the router.
- Providers should return a tracking URL only when it is safe and useful to show
  to the submitting user.
- The frontend should not assume any specific provider behavior.

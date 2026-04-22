{{- define "hriv-backend.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "hriv-backend.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "hriv-backend.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "hriv-backend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "hriv-backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "hriv-backend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Runtime display version used for /api/admin/version and log context.

Derived from the deploy-time image reference (.Values.image.tag, which
flux-fleet ImagePolicy writes for main-tracking envs; falls back to
.Chart.AppVersion for ad-hoc `helm install` / `helm template` use).

Main-build tags follow `<ver>-rc.<ts>.<short>` (e.g.
`1.1.18-rc.20260414194220.b286051`). The 14-digit UTC timestamp is
noise for a human reading the admin panel, so we strip it here to
yield `<ver>-rc.<short>` (e.g. `1.1.18-rc.b286051`). Clean release
tags (`<ver>` with no `-rc.` prerelease) pass through unchanged, so a
retag-promoted production image shows `1.1.18` — exactly the intent
of this separating-build-identity-from-display-identity split.

regexReplaceAll is sprig's full Go-regex binding; the pattern is
anchored to the literal `-rc.` prefix and 14 ASCII digits so release
tags that happen to contain 14 consecutive digits elsewhere (e.g. a
user-chosen build metadata segment) are not mis-matched.
*/}}
{{- define "hriv-backend.displayVersion" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- regexReplaceAll "-rc\\.[0-9]{14}\\." $tag "-rc." -}}
{{- end -}}

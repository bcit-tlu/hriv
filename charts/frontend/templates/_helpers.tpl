{{- define "hriv-frontend.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "hriv-frontend.fullname" -}}
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

{{- define "hriv-frontend.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "hriv-frontend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "hriv-frontend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "hriv-frontend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Runtime display version surfaced by the nginx `/version` endpoint.

See `hriv-backend.displayVersion` for the design rationale — this
mirrors that helper, using the frontend chart's own image tag so each
component reports its independently-released version.
*/}}
{{- define "hriv-frontend.displayVersion" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- regexReplaceAll "-rc\\.[0-9]{14}\\." $tag "-rc." -}}
{{- end -}}

{{/*
Expand the name of the chart.
*/}}
{{- define "corgi.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "corgi.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "corgi.labels" -}}
helm.sh/chart: {{ include "corgi.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Chart label
*/}}
{{- define "corgi.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Selector labels for the frontend
*/}}
{{- define "corgi.frontend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "corgi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
Selector labels for the backend
*/}}
{{- define "corgi.backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "corgi.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: backend
{{- end }}

{{/*
Backend internal service URL (used by the frontend nginx proxy)
*/}}
{{- define "corgi.backend.url" -}}
{{- if .Values.frontend.backendUrl }}
{{- .Values.frontend.backendUrl }}
{{- else }}
{{- printf "http://%s-backend:%d" (include "corgi.fullname" .) (.Values.backend.service.port | int) }}
{{- end }}
{{- end }}

{{/*
Database connection string for the backend.
CloudNative-PG creates a secret named <cluster>-app with key "uri".
*/}}
{{- define "corgi.database.secretName" -}}
{{- printf "%s-db-app" (include "corgi.fullname" .) }}
{{- end }}

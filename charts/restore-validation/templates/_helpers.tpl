{{- define "hriv-restore-validation.name" -}}hriv-restore-validation{{- end -}}
{{- define "hriv-restore-validation.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "hriv-restore-validation.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "hriv-restore-validation.digestImage" -}}
{{- if not (regexMatch "^[^[:space:]@]+@sha256:[0-9a-f]{64}$" .value) -}}{{- fail (printf "%s must be digest-pinned" .name) -}}{{- end -}}{{ .value }}
{{- end -}}
{{- define "hriv-restore-validation.validate" -}}
{{- $_ := include "hriv-restore-validation.digestImage" (dict "name" "images.orchestrator" "value" .Values.images.orchestrator) -}}
{{- $_ := include "hriv-restore-validation.digestImage" (dict "name" "images.backupChild" "value" .Values.images.backupChild) -}}
{{- $_ := include "hriv-restore-validation.digestImage" (dict "name" "images.postgresql" "value" .Values.images.postgresql) -}}
{{- if .Values.objectStore.enabled -}}{{- $_ := required "objectStore.destinationPath is required when enabled" .Values.objectStore.destinationPath -}}{{- if ne .Release.Namespace "hriv-restore-validation" -}}{{- fail "enabled ObjectStore requires namespace hriv-restore-validation" -}}{{- end -}}{{- end -}}
{{- if .Values.invocation.enabled -}}
{{- if ne .Release.Namespace "hriv-restore-validation" -}}{{- fail "enabled invocation requires namespace hriv-restore-validation" -}}{{- end -}}
{{- if or (contains "example.invalid" .Values.images.orchestrator) (contains "example.invalid" .Values.images.backupChild) (contains "example.invalid" .Values.images.postgresql) -}}{{- fail "enabled invocation requires reviewed non-placeholder images" -}}{{- end -}}
{{- if not .Values.objectStore.enabled -}}{{- fail "enabled invocation requires objectStore.enabled=true" -}}{{- end -}}
{{- fail "invocation remains non-runnable until #1253 adds fixed reviewed Azure, Kubernetes API, DNS, and CNPG egress resources" -}}
{{- end -}}
{{- end -}}
{{- define "hriv-restore-validation.childPodSecurityContext" -}}
runAsNonRoot: true
runAsUser: 65532
runAsGroup: 65532
fsGroup: 65532
fsGroupChangePolicy: OnRootMismatch
seccompProfile: {type: RuntimeDefault}
{{- end -}}
{{- define "hriv-restore-validation.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities: {drop: ["ALL"]}
{{- end -}}

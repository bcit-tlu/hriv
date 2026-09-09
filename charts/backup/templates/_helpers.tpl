{{- define "hriv-backup.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "hriv-backup.fullname" -}}
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

{{- define "hriv-backup.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "hriv-backup.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "hriv-backup.selectorLabels" -}}
app.kubernetes.io/name: {{ include "hriv-backup.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "hriv-backup.onDemandName" -}}
{{- $fullname := include "hriv-backup.fullname" . -}}
{{- if le (len $fullname) 42 -}}
{{- printf "%s-on-demand" $fullname -}}
{{- else -}}
{{- $prefix := $fullname | trunc 31 | trimSuffix "-" -}}
{{- $hash := sha256sum $fullname | trunc 10 -}}
{{- printf "%s-%s-on-demand" $prefix $hash -}}
{{- end -}}
{{- end -}}

{{/*
Runtime display version published via version-configmap and mounted by
the backend for /api/admin/version.

See `hriv-backend.displayVersion` for the rationale. Using the image
tag rather than .Chart.AppVersion means the backup version reported
in the admin panel tracks the deployed image (which flux-fleet's
ImagePolicy rewrites per main build) instead of the statically
committed Chart.yaml `appVersion: "0.1.0"`.
*/}}
{{- define "hriv-backup.displayVersion" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- regexReplaceAll "-rc\\.[0-9]{14}\\." $tag "-rc." -}}
{{- end -}}

{{/*
Disable the tiles PVC when the backup chart is in production mode, or when it
is still pointed at the legacy shared data claim and no explicit split-PVC
tiles claim was provided.
*/}}
{{- define "hriv-backup.tilesEnabled" -}}
{{- $legacyData := .Values.persistence.data | default dict -}}
{{- $sourceImagesExistingClaim := .Values.persistence.sourceImages.existingClaim -}}
{{- if and (hasKey $legacyData "existingClaim") (not $sourceImagesExistingClaim) -}}
  {{- $sourceImagesExistingClaim = $legacyData.existingClaim -}}
{{- end -}}
{{- $tilesEnabled := .Values.persistence.tiles.enabled -}}
{{- $backupMode := lower (.Values.env.BACKUP_MODE | default "development") -}}
{{- if eq $backupMode "production" -}}
  {{- $tilesEnabled = false -}}
{{- end -}}
{{- if and $sourceImagesExistingClaim (not .Values.persistence.tiles.existingClaim) (hasKey $legacyData "existingClaim") $legacyData.existingClaim $tilesEnabled -}}
  {{- $tilesEnabled = false -}}
{{- end -}}
{{- $tilesEnabled -}}
{{- end -}}

{{/* Shared pod fields for the scheduler Deployment and on-demand Job template. */}}
{{- define "hriv-backup.podSpec" -}}
{{- $root := .root -}}
{{- $azureEnabled := ne (trim $root.Values.env.AZURE_STORAGE_CONTAINER) "" -}}
{{- $legacyData := $root.Values.persistence.data | default dict -}}
{{- $sourceImagesEnabled := $root.Values.persistence.sourceImages.enabled -}}
{{- if and (hasKey $legacyData "enabled") $legacyData.enabled -}}
  {{- $sourceImagesEnabled = $legacyData.enabled -}}
{{- end -}}
{{- $sourceImagesExistingClaim := $root.Values.persistence.sourceImages.existingClaim -}}
{{- if and (hasKey $legacyData "existingClaim") (not $sourceImagesExistingClaim) -}}
  {{- $sourceImagesExistingClaim = $legacyData.existingClaim -}}
{{- end -}}
{{- $tilesEnabled := eq (include "hriv-backup.tilesEnabled" $root) "true" -}}
{{- $backupsEnabled := $root.Values.persistence.backups.enabled -}}
{{- $restoreTargetClaim := $root.Values.restoreTarget.existingClaim -}}
automountServiceAccountToken: {{ $root.Values.automountServiceAccountToken }}
{{- with $root.Values.podSecurityContext }}
securityContext:
  {{- toYaml . | nindent 2 }}
{{- end }}
containers:
  - name: backup
    image: "{{ $root.Values.image.repository }}:{{ $root.Values.image.tag | default $root.Chart.AppVersion }}"
    imagePullPolicy: {{ $root.Values.image.pullPolicy }}
    args: {{ toJson .args }}
    {{- with $root.Values.containerSecurityContext }}
    securityContext:
      {{- toYaml . | nindent 6 }}
    {{- end }}
    env:
      - name: HOME
        value: /tmp
      - name: TMPDIR
        value: /tmp
      - name: PYTHONDONTWRITEBYTECODE
        value: "1"
      - name: DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: {{ $root.Values.postgresSecretName }}
            key: uri
      # Parity with the backend/frontend containers: expose the
      # deploy-time display version so ``docker inspect`` /
      # ``kubectl describe pod`` surfaces the same
      # ``<ver>-rc.<short>`` (main) or clean ``<ver>`` (retag-
      # promoted) string reported by the admin UI.  ``backup.py``
      # itself does not consume this env var; the version
      # reported under ``/api/admin/version`` is published by the
      # `version-configmap` template and mounted into the
      # backend's pod.
      - name: APP_VERSION
        value: {{ include "hriv-backup.displayVersion" $root | quote }}
      - name: DATA_DIR
        value: {{ $root.Values.env.DATA_DIR | quote }}
      - name: BACKUP_CRON_SCHEDULE
        value: {{ $root.Values.env.BACKUP_CRON_SCHEDULE | quote }}
      - name: BACKUP_TIMEZONE
        value: {{ $root.Values.env.BACKUP_TIMEZONE | quote }}
      - name: BACKUP_MUTATION_DRAIN_SECONDS
        value: {{ $root.Values.env.BACKUP_MUTATION_DRAIN_SECONDS | quote }}
      - name: BACKUP_INVENTORY_TIMEOUT_SECONDS
        value: {{ $root.Values.env.BACKUP_INVENTORY_TIMEOUT_SECONDS | quote }}
      - name: BACKUP_WAL_FENCE_TIMEOUT_SECONDS
        value: {{ $root.Values.env.BACKUP_WAL_FENCE_TIMEOUT_SECONDS | quote }}
      - name: BACKUP_WAL_FENCE_POLL_SECONDS
        value: {{ $root.Values.env.BACKUP_WAL_FENCE_POLL_SECONDS | quote }}
      - name: CNPG_CLUSTER_NAME
        value: {{ $root.Values.env.CNPG_CLUSTER_NAME | quote }}
      - name: BACKUP_RETENTION_COUNT
        value: {{ $root.Values.env.BACKUP_RETENTION_COUNT | quote }}
      - name: BACKUP_STALE_HOURS
        value: {{ $root.Values.env.BACKUP_STALE_HOURS | quote }}
      - name: BACKUP_MODE
        value: {{ $root.Values.env.BACKUP_MODE | quote }}
      {{- with $root.Values.env.BACKUP_STAGING_DIR }}
      - name: BACKUP_STAGING_DIR
        value: {{ . | quote }}
      {{- end }}
      {{- if $azureEnabled }}
      - name: AZURE_STORAGE_CONNECTION_STRING
        valueFrom:
          secretKeyRef:
            name: {{ $root.Values.azureSecretName }}
            key: AZURE_STORAGE_CONNECTION_STRING
      {{- end }}
      - name: AZURE_STORAGE_CONTAINER
        value: {{ $root.Values.env.AZURE_STORAGE_CONTAINER | quote }}
      - name: AZURE_BLOB_PREFIX
        value: {{ $root.Values.env.AZURE_BLOB_PREFIX | quote }}
      {{- if $root.Values.observability.openTelemetry.enabled }}
      - name: OTEL_SERVICE_NAME
        value: {{ $root.Values.observability.openTelemetry.serviceName | quote }}
      - name: OTEL_TRACES_EXPORTER
        value: {{ $root.Values.observability.openTelemetry.exporter.traces | quote }}
      - name: OTEL_METRICS_EXPORTER
        value: {{ $root.Values.observability.openTelemetry.exporter.metrics | quote }}
      - name: OTEL_LOGS_EXPORTER
        value: {{ $root.Values.observability.openTelemetry.exporter.logs | quote }}
      - name: OTEL_EXPORTER_OTLP_ENDPOINT
        value: {{ $root.Values.observability.openTelemetry.exporter.endpoint | quote }}
      - name: OTEL_EXPORTER_OTLP_PROTOCOL
        value: {{ $root.Values.observability.openTelemetry.exporter.protocol | quote }}
      {{- end }}
    {{- with $root.Values.resources }}
    resources:
      {{- toYaml . | nindent 6 }}
    {{- end }}
    volumeMounts:
      - name: tmp
        mountPath: /tmp
      {{- if $sourceImagesEnabled }}
      - name: source-images
        mountPath: /data
      {{- end }}
      {{- if $tilesEnabled }}
      - name: tiles
        mountPath: /data/tiles
      {{- end }}
      {{- if $backupsEnabled }}
      - name: backups
        mountPath: /backups
      {{- end }}
      {{- if $restoreTargetClaim }}
      - name: restore-target
        mountPath: {{ $root.Values.restoreTarget.mountPath }}
      {{- end }}
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: {{ $root.Values.tmp.sizeLimit }}
  {{- if $sourceImagesEnabled }}
  - name: source-images
    persistentVolumeClaim:
      claimName: {{ $sourceImagesExistingClaim | default (printf "%s-source-images" (include "hriv-backup.fullname" $root)) }}
  {{- end }}
  {{- if $tilesEnabled }}
  - name: tiles
    persistentVolumeClaim:
      claimName: {{ $root.Values.persistence.tiles.existingClaim | default (printf "%s-tiles" (include "hriv-backup.fullname" $root)) }}
  {{- end }}
  {{- if $backupsEnabled }}
  - name: backups
    persistentVolumeClaim:
      claimName: {{ include "hriv-backup.fullname" $root }}-backups
  {{- end }}
  {{- if $restoreTargetClaim }}
  - name: restore-target
    persistentVolumeClaim:
      claimName: {{ $restoreTargetClaim }}
  {{- end }}
{{- with $root.Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $root.Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/* Preserve configured affinity while adding any shared source-PVC colocation. */}}
{{- define "hriv-backup.deploymentAffinity" -}}
{{- $legacyData := .Values.persistence.data | default dict -}}
{{- $sourceImagesExistingClaim := .Values.persistence.sourceImages.existingClaim -}}
{{- if and (hasKey $legacyData "existingClaim") (not $sourceImagesExistingClaim) -}}
  {{- $sourceImagesExistingClaim = $legacyData.existingClaim -}}
{{- end -}}
{{- $tilesEnabled := eq (include "hriv-backup.tilesEnabled" .) "true" -}}
{{- $colocateWithSourcePod := and .Values.colocateWithSourcePod $sourceImagesExistingClaim -}}
{{- $affinity := .Values.affinity | default dict -}}
{{- $podAffinity := get $affinity "podAffinity" | default dict -}}
{{- $configuredRequired := get $podAffinity "requiredDuringSchedulingIgnoredDuringExecution" | default list -}}
{{- with omit $affinity "podAffinity" }}
{{ toYaml . }}
{{- end }}
{{- if or $podAffinity $colocateWithSourcePod (and $tilesEnabled .Values.persistence.tiles.existingClaim) }}
podAffinity:
  {{- with omit $podAffinity "requiredDuringSchedulingIgnoredDuringExecution" }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
  {{- if or $configuredRequired $colocateWithSourcePod (and $tilesEnabled .Values.persistence.tiles.existingClaim) }}
  requiredDuringSchedulingIgnoredDuringExecution:
    {{- with $configuredRequired }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
    {{- if or $colocateWithSourcePod (and $tilesEnabled .Values.persistence.tiles.existingClaim) }}
    - labelSelector:
        matchLabels:
          app.kubernetes.io/name: {{ .Values.colocateWithPodLabel }}
      topologyKey: kubernetes.io/hostname
    {{- end }}
  {{- end }}
{{- end }}
{{- end -}}

{{/* Preserve configured affinity while requiring on-demand pods on the Deployment's node. */}}
{{- define "hriv-backup.onDemandAffinity" -}}
{{- $affinity := .Values.affinity | default dict -}}
{{- $podAffinity := get $affinity "podAffinity" | default dict -}}
{{- $configuredRequired := get $podAffinity "requiredDuringSchedulingIgnoredDuringExecution" | default list -}}
{{- with omit $affinity "podAffinity" }}
{{ toYaml . }}
{{- end }}
podAffinity:
  {{- with omit $podAffinity "requiredDuringSchedulingIgnoredDuringExecution" }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
  requiredDuringSchedulingIgnoredDuringExecution:
    {{- with $configuredRequired }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
    - labelSelector:
        matchLabels:
          {{- include "hriv-backup.selectorLabels" . | nindent 10 }}
      topologyKey: kubernetes.io/hostname
{{- end -}}

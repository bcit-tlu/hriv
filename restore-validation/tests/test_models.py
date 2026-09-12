from __future__ import annotations

import copy
import hashlib
import json
import unittest

import yaml

from hriv_restore_validation.models import Config, SourcePolicy, SourceProfile, Templates, canonical_source_state
from hriv_restore_validation.strict import ValidationError, canonical_json, parse_json
from fixtures import BACKUP_IMAGE, POSTGRES_IMAGE, config, policy_document, profile, profile_document, template_document


class ParsingTests(unittest.TestCase):
    def test_duplicate_json(self):
        with self.assertRaises(ValidationError): parse_json('{"a":1,"a":2}')

    def test_nonfinite_json(self):
        with self.assertRaises(ValidationError): parse_json('{"a":NaN}')

    def test_oversized_json(self):
        with self.assertRaises(ValidationError): parse_json('"' + 'x' * 20 + '"', max_bytes=4)

    def test_config_round_trip(self):
        value = config(); self.assertEqual(value, Config.parse(json.dumps(value.__dict__ | {"schema_version": 1})))

    def test_config_unknown_field(self):
        value = config().__dict__ | {"schema_version": 1, "unknown": 1}
        with self.assertRaises(ValidationError): Config.parse(json.dumps(value))

    def test_config_retained_bound(self):
        value = config().__dict__ | {"schema_version": 1, "max_retained_runs": 3}
        with self.assertRaises(ValidationError): Config.parse(json.dumps(value))

    def test_config_requires_ten_child_capacity(self):
        value = config().__dict__ | {"schema_version": 1, "max_child_resources": 9}
        with self.assertRaises(ValidationError): Config.parse(json.dumps(value))

    def test_profile_round_trip(self):
        self.assertEqual("pg-core-source", profile().external_cluster)

    def test_profile_wrong_source(self):
        with self.assertRaises(ValidationError): SourceProfile.parse(json.dumps(profile_document(source_cluster="other")))

    def test_profile_system_id_separate(self):
        value = profile(); self.assertEqual("pg-core", value.server_name); self.assertEqual("777777", value.expected_system_identifier)

    def test_profile_postgresql_17(self):
        with self.assertRaises(ValidationError): SourceProfile.parse(json.dumps(profile_document(postgresql_major=16)))

    def test_profile_unpinned_image(self):
        with self.assertRaises(ValidationError): SourceProfile.parse(json.dumps(profile_document(controller_image="image:latest")))

    def test_profile_postgresql_requires_tagged_digest(self):
        digest = "c" * 64
        invalid = [
            f"registry/postgres@sha256:{digest}",
            f"registry/postgres::@sha256:{digest}",
            f"registry/postgres:-17@sha256:{digest}",
            f"registry/postgres:{'a' * 129}@sha256:{digest}",
        ]
        for image in invalid:
            with self.subTest(image=image), self.assertRaises(ValidationError):
                SourceProfile.parse(json.dumps(profile_document(postgresql_image=image)))
        valid = f"registry/postgres:{'a' * 128}@sha256:{digest}"
        self.assertEqual(valid, SourceProfile.parse(json.dumps(profile_document(postgresql_image=valid))).postgresql_image)

    def test_profile_storage_minimum_syntax(self):
        with self.assertRaises(ValidationError): SourceProfile.parse(json.dumps(profile_document(postgresql_storage_size="40GB")))

    def test_profile_role_attributes_exact(self):
        value = profile_document(); del value["required_static_role_inventory"][0]["attributes"]["bypassrls"]
        with self.assertRaises(ValidationError): SourceProfile.parse(json.dumps(value))

    def test_profile_rejects_plain_email_and_duplicate_required_names(self):
        plain = profile_document()
        plain["synthetic_row"] = {"id": "1", "email": "synthetic@example.invalid"}
        with self.assertRaises(ValidationError):
            SourceProfile.parse(json.dumps(plain))
        for field in ("required_database_inventory", "required_static_role_inventory"):
            with self.subTest(field=field):
                duplicate = profile_document()
                duplicate[field].append(copy.deepcopy(duplicate[field][0]))
                with self.assertRaises(ValidationError):
                    SourceProfile.parse(json.dumps(duplicate))

    def test_profile_accepts_pg_core_hyphenated_names(self):
        value = profile_document()
        value["required_database_inventory"].append(
            {"name": "course-intelligence", "owner": "postgres", "allow_connections": True}
        )
        value["required_static_role_inventory"].append(
            {
                "name": "qcon-api",
                "attributes": copy.deepcopy(value["required_static_role_inventory"][0]["attributes"]),
                "memberships": ["course-intelligence"],
            }
        )
        parsed = SourceProfile.parse(json.dumps(value))
        self.assertIn("course-intelligence", {item["name"] for item in parsed.required_database_inventory})
        self.assertIn("qcon-api", {item["name"] for item in parsed.required_static_role_inventory})

    def test_policy_round_trip_and_identity(self):
        parsed = SourcePolicy.parse(json.dumps(policy_document(39, 3, "958b1dc2dca298c56fd96dd80b6c694144905e22c00c4b3ca9d2c59c3b666083")))
        self.assertEqual((1, 39, 3), (parsed.policy_version, parsed.missing_count, parsed.orphan_count))
        self.assertRegex(parsed.identity_sha256, r"^[0-9a-f]{64}$")

    def test_source_state_canonical_numeric_and_orphan_order(self):
        missing = [{"row_id": "10", "status": "z", "stored_path": "source_images/z.jpg", "reason": "missing_source"}, {"row_id": "2", "status": "a", "stored_path": "/data/source_images/a.jpg", "reason": "missing_source"}]
        orphans = [{"path": "source_images/z.jpg", "reason": "no_database_row", "policy": "quarantined_by_policy"}, {"path": "data/source_images/a.jpg", "reason": "no_database_row", "policy": "quarantined_by_policy"}]
        canonical, digest = canonical_source_state({"missing_sources": missing, "orphan_sources": orphans})
        self.assertEqual(["2", "10"], [item["row_id"] for item in canonical["missing_sources"]])
        self.assertEqual(["data/source_images/a.jpg", "data/source_images/z.jpg"], [item["path"] for item in canonical["orphan_sources"]])
        self.assertEqual(digest, hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest())

    def test_source_state_matches_backup_empty_status(self):
        state = {"missing_sources": [{"row_id": "2", "status": "", "stored_path": "x.jpg", "reason": "unsafe_or_out_of_root"}], "orphan_sources": []}
        canonical, _ = canonical_source_state(state)
        self.assertEqual("", canonical["missing_sources"][0]["status"])

    def test_source_state_rejects_utf8_path_over_byte_bound(self):
        state = {"missing_sources": [{"row_id": "1", "status": "ready", "stored_path": "é" * 300, "reason": "missing_source"}], "orphan_sources": []}
        with self.assertRaises(ValidationError): canonical_source_state(state)

    def test_policy_bad_digest_and_count_bounds(self):
        for value in (policy_document(sha256="A" * 64), policy_document(257, 0), policy_document(0, 257)):
            with self.subTest(value=value):
                with self.assertRaises(ValidationError): SourcePolicy.parse(json.dumps(value))

    def test_policy_unknown_field(self):
        value = policy_document() | {"extra": 1}
        with self.assertRaises(ValidationError): SourcePolicy.parse(json.dumps(value))

    def test_templates_round_trip(self):
        value = Templates.parse(yaml.safe_dump(template_document()), profile()); self.assertEqual("40Gi", value.source_pvc["spec"]["resources"]["requests"]["storage"])

    def test_templates_full_service_account(self):
        value = template_document(); value["selection_job"]["spec"]["template"]["spec"]["serviceAccountName"] = "no-permission"
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_missing_nonroot(self):
        value = template_document(); value["selection_job"]["spec"]["template"]["spec"]["securityContext"] = {}
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_missing_runtime_default_seccomp(self):
        value = template_document(); del value["selection_job"]["spec"]["template"]["spec"]["securityContext"]["seccompProfile"]
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_command_override(self):
        value = template_document(); value["selection_job"]["spec"]["template"]["spec"]["containers"][0]["command"] = ["sh"]
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_extra_secret_reference(self):
        value = template_document(); value["selection_job"]["spec"]["template"]["spec"]["volumes"].append({"name": "other", "secret": {"secretName": "other"}})
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_writable_root(self):
        value = template_document(); value["selection_job"]["spec"]["template"]["spec"]["containers"][0]["securityContext"]["readOnlyRootFilesystem"] = False
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_capabilities(self):
        value = template_document(); value["selection_job"]["spec"]["template"]["spec"]["containers"][0]["securityContext"]["capabilities"] = {"drop": []}
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_missing_tmp_mount(self):
        value = template_document(); value["selection_job"]["spec"]["template"]["spec"]["containers"][0]["volumeMounts"] = []
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_ttl(self):
        value = template_document(); value["selection_job"]["spec"]["ttlSecondsAfterFinished"] = 1
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_metadata(self):
        value = template_document(); value["source_pvc"]["metadata"] = {"name": "attacker"}
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_allowlist_drift(self):
        value = template_document(); value["image_allowlist"].remove(BACKUP_IMAGE)
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_allow_long_digest_pinned_controller_image(self):
        long_controller = "ghcr.io/bcit-tlu/hriv/hriv-restore-validation:0.1.2-rc.20260912040709.g42e22ad@sha256:" + "d" * 64
        assert len(long_controller) > 128
        long_profile = SourceProfile.parse(json.dumps(profile_document(controller_image=long_controller)))
        value = template_document()
        value["image_allowlist"] = [long_controller, BACKUP_IMAGE, POSTGRES_IMAGE]
        for key in ("db_validation_job", "consistency_job"):
            value[key]["spec"]["template"]["spec"]["containers"][0]["image"] = long_controller
        Templates.parse(yaml.safe_dump(value), long_profile)

    def test_templates_reject_unpinned_allowlist_reference(self):
        value = template_document(); value["image_allowlist"][0] = "registry/controller:latest"
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_small_pvc(self):
        value = template_document(); value["source_pvc"]["spec"]["resources"]["requests"]["storage"] = "20Gi"
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_require_profile_postgresql_image(self):
        value = template_document(); value["cnpg_cluster"]["spec"]["imageName"] = BACKUP_IMAGE
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_require_longhorn_storage_targets(self):
        for mutate in (
            lambda value: value["source_pvc"]["spec"].update(storageClassName="other"),
            lambda value: value["cnpg_cluster"]["spec"]["storage"].update(storageClass="other"),
            lambda value: value["cnpg_cluster"]["spec"].update(affinity={}),
        ):
            value = template_document()
            mutate(value)
            with self.subTest(value=value), self.assertRaises(ValidationError):
                Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_db_sql(self):
        value = template_document(); value["selection_job"]["spec"]["template"]["spec"]["containers"][0]["args"] = ["db.sql"]
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_latest_target(self):
        value = template_document(); value["cnpg_cluster"]["spec"]["bootstrap"] = {"recovery": {"recoveryTarget": {"targetLSN": "latest"}}}
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_allow_bounded_tmp_size_limit(self):
        value = template_document()
        value["selection_job"]["spec"]["template"]["spec"]["volumes"][0]["emptyDir"] = {"sizeLimit": "512Mi"}
        Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_unsafe_tmp_volumes(self):
        unsafe = [
            {"name": "tmp", "emptyDir": {"medium": "Memory"}},
            {"name": "tmp", "emptyDir": {"sizeLimit": "512Mi", "extra": True}},
            {"name": "tmp", "emptyDir": {"sizeLimit": "invalid"}},
            {"name": "tmp", "emptyDir": {"sizeLimit": "2Gi"}},
            {"name": "tmp", "hostPath": {"path": "/tmp"}},
        ]
        for tmp_volume in unsafe:
            with self.subTest(tmp_volume=tmp_volume):
                value = template_document()
                value["selection_job"]["spec"]["template"]["spec"]["volumes"][0] = tmp_volume
                with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_missing_tmp_volume(self):
        value = template_document(); value["selection_job"]["spec"]["template"]["spec"]["volumes"] = []
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_profile_env_drift(self):
        names = ["CNPG_CLUSTER_NAME", "AZURE_STORAGE_CONTAINER", "AZURE_BLOB_PREFIX"]
        for name in names:
            with self.subTest(name=name):
                value = template_document()
                entry = next(item for item in value["selection_job"]["spec"]["template"]["spec"]["containers"][0]["env"] if item["name"] == name)
                entry["value"] = "drifted"
                with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_env_that_does_not_match_profile(self):
        changed_profile = SourceProfile.parse(json.dumps(profile_document(source_container="other-recovery")))
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(template_document()), changed_profile)

    def test_templates_reject_runtime_env_drift_and_extras(self):
        for mutation in ("home", "extra", "envFrom"):
            with self.subTest(mutation=mutation):
                value = template_document()
                container = value["source_restore_job"]["spec"]["template"]["spec"]["containers"][0]
                if mutation == "home":
                    next(item for item in container["env"] if item["name"] == "HOME")["value"] = "/root"
                elif mutation == "extra":
                    container["env"].append({"name": "AZURE_STORAGE_CONNECTION_STRING", "value": "write-credential"})
                else:
                    container["envFrom"] = [{"secretRef": {"name": "write-credentials"}}]
                with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_child_env_on_database_jobs(self):
        value = template_document()
        value["db_validation_job"]["spec"]["template"]["spec"]["containers"][0]["env"] = [{"name": "HOME", "value": "/tmp"}]
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_templates_reject_source_mount_at_data_child(self):
        value = template_document()
        mount = next(item for item in value["source_restore_job"]["spec"]["template"]["spec"]["containers"][0]["volumeMounts"] if item["name"] == "source")
        mount["mountPath"] = "/restore/data"
        with self.assertRaises(ValidationError): Templates.parse(yaml.safe_dump(value), profile())

    def test_canonical_state_size(self):
        with self.assertRaises(ValidationError): canonical_json({"x": "a" * (512 * 1024)})


if __name__ == "__main__": unittest.main()

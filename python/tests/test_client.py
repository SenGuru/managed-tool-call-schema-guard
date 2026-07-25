import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from schema_guard import SchemaGuardClient, SchemaGuardServiceError


class JsonResponse(io.BytesIO):
    def __init__(self, payload):
        super().__init__(json.dumps(payload).encode("utf-8"))

    def __enter__(self):
        return self

    def __exit__(self, _type, _value, _traceback):
        self.close()


class SchemaGuardClientTest(unittest.TestCase):
    def test_local_engine_conformance(self):
        decision = SchemaGuardClient().validate(
            {
                "tool_name": "counter",
                "tool_schema": {
                    "type": "object",
                    "required": ["count"],
                    "properties": {"count": {"type": "integer"}},
                },
                "raw_arguments": {"count": "3"},
            }
        )
        self.assertEqual(decision["decision"], "valid_with_repair")
        self.assertEqual(decision["valid_arguments"]["count"], 3)

    def test_remote_authentication_timeout_and_decision_validation(self):
        observed = {}

        def remote(request, timeout):
            observed["authorization"] = request.get_header("Authorization")
            observed["timeout"] = timeout
            observed["url"] = request.full_url
            return JsonResponse({"decision": "valid", "valid_arguments": {}})

        client = SchemaGuardClient(
            "https://api.example.test", api_key="test-key", timeout_seconds=2.5
        )
        with patch("urllib.request.urlopen", side_effect=remote):
            decision = client.validate(
                {
                    "tool_name": "counter",
                    "tool_schema": {"type": "object"},
                    "raw_arguments": {},
                }
            )
        self.assertEqual(decision["decision"], "valid")
        self.assertEqual(observed["authorization"], "Bearer test-key")
        self.assertEqual(observed["timeout"], 2.5)
        self.assertEqual(observed["url"], "https://api.example.test/v1/validate")

    def test_managed_read_workflow_uses_scoped_routes(self):
        paths = []

        def remote(request, timeout):
            self.assertEqual(timeout, 5.0)
            self.assertEqual(request.get_header("Authorization"), "Bearer read-key")
            paths.append(request.full_url)
            if request.full_url.endswith("/v1/usage"):
                return JsonResponse({"plan": "team"})
            if request.full_url.endswith("/v1/plans"):
                return JsonResponse({"plans": [{"id": "team"}]})
            if request.full_url.endswith("/v1/admin/api-keys"):
                return JsonResponse(
                    {
                        "api_keys": [
                            {
                                "key_id": "key_1",
                                "prefix": "sg_live_1234",
                                "current": False,
                            }
                        ]
                    }
                )
            if request.full_url.endswith("/v1/admin/policy"):
                return JsonResponse({"policy": {"allowed_repairs": []}})
            if request.full_url.endswith("/v1/schemas"):
                return JsonResponse({"schemas": [{"adapter": "mcp", "version": "1"}]})
            if request.full_url.endswith("/v1/admin/actions/descriptors"):
                return JsonResponse(
                    {
                        "descriptors": [
                            {"environment": "production", "risk_level": "high"}
                        ]
                    }
                )
            if request.full_url.endswith("/v1/admin/actions/control"):
                if request.method == "PUT":
                    self.assertEqual(
                        json.loads(request.data),
                        {
                            "hold": False,
                            "reason_code": None,
                            "enforced_policy": {"max_auto_execute_risk": "low"},
                            "shadow_policy": {"max_auto_execute_risk": "read"},
                        },
                    )
                return JsonResponse(
                    {
                        "hold": False,
                        "reason_code": None,
                        "enforced_policy": {"max_auto_execute_risk": "low"},
                        "shadow_policy": {"max_auto_execute_risk": "read"},
                        "updated_at": "2026-07-25T00:00:00.000Z",
                        "updated_by_hash": "hmac-sha256:" + "a" * 64,
                    }
                )
            if "/v1/actions/challenges?" in request.full_url:
                return JsonResponse(
                    {
                        "challenges": [
                            {"challenge_id": "challenge_1", "status": "pending"}
                        ]
                    }
                )
            if "/v1/audits?" in request.full_url:
                return JsonResponse({"audits": []})
            if request.full_url.endswith("/v1/audits/verify"):
                return JsonResponse({"valid": True, "checked": 0})
            if request.full_url.endswith("/v1/alerts"):
                return JsonResponse([])
            if request.full_url.endswith("/v1/alerts/7/acknowledge"):
                self.assertEqual(request.method, "POST")
                return JsonResponse({"acknowledged": True, "alert_id": 7})
            if request.full_url.endswith("/v1/environments"):
                return JsonResponse([])
            if request.full_url.endswith("/v1/intelligence"):
                return JsonResponse({"failure_clusters": []})
            if "/v1/schema-releases?" in request.full_url:
                return JsonResponse({"releases": []})
            if request.full_url.endswith("/v1/schema-releases/verify"):
                return JsonResponse({"valid": True, "checked": 0})
            if request.full_url.endswith("/v1/admin/tenant/lifecycle"):
                return JsonResponse(
                    {
                        "lifecycle": {
                            "status": "active",
                            "reason_code": None,
                            "deletion_requested_at": None,
                            "updated_at": "2026-07-23T00:00:00.000Z",
                        }
                    }
                )
            if request.full_url.endswith("/v1/admin/tenant/export"):
                return JsonResponse(
                    {
                        "export_version": 1,
                        "generated_at": "2026-07-23T00:00:00.000Z",
                        "tenant_id": "tenant-a",
                        "content_sha256": "sha256:" + "a" * 64,
                        "tenant": {},
                        "tables": {},
                    }
                )
            if request.full_url.endswith("/v1/admin/tenant/deletion-request"):
                self.assertEqual(request.method, "POST")
                self.assertEqual(
                    json.loads(request.data),
                    {"confirm_tenant_id": "tenant-a"},
                )
                return JsonResponse(
                    {
                        "lifecycle": {
                            "status": "deletion_pending",
                            "reason_code": "customer_requested",
                            "deletion_requested_at": "2026-07-23T00:00:00.000Z",
                            "updated_at": "2026-07-23T00:00:00.000Z",
                        }
                    }
                )
            self.fail("unexpected request " + request.full_url)

        client = SchemaGuardClient(
            "https://api.example.test/", api_key="read-key"
        )
        with patch("urllib.request.urlopen", side_effect=remote):
            self.assertEqual(client.usage()["plan"], "team")
            self.assertEqual(client.plans()["plans"][0]["id"], "team")
            self.assertEqual(client.api_keys()["api_keys"][0]["key_id"], "key_1")
            self.assertEqual(client.policy()["allowed_repairs"], [])
            self.assertEqual(client.schemas()["schemas"][0]["adapter"], "mcp")
            self.assertEqual(
                client.action_descriptors()["descriptors"][0]["risk_level"], "high"
            )
            self.assertFalse(client.action_control()["hold"])
            self.assertEqual(
                client.update_action_control(
                    False,
                    None,
                    {"max_auto_execute_risk": "low"},
                    {"max_auto_execute_risk": "read"},
                )["shadow_policy"]["max_auto_execute_risk"],
                "read",
            )
            self.assertEqual(
                client.action_challenges("pending", 25)["challenges"][0]["status"],
                "pending",
            )
            self.assertEqual(client.audits(25)["audits"], [])
            self.assertTrue(client.verify_audits()["valid"])
            self.assertEqual(client.alerts(), [])
            self.assertTrue(client.acknowledge_alert(7)["acknowledged"])
            self.assertEqual(client.environments(), [])
            self.assertEqual(client.intelligence()["failure_clusters"], [])
            self.assertEqual(
                client.schema_releases("production", 20)["releases"], []
            )
            self.assertTrue(client.verify_schema_releases()["valid"])
            self.assertEqual(client.tenant_lifecycle()["status"], "active")
            self.assertEqual(client.export_tenant_data()["tenant_id"], "tenant-a")
            self.assertEqual(
                client.request_tenant_deletion("tenant-a")["status"],
                "deletion_pending",
            )
        self.assertEqual(len(paths), 20)
        self.assertIn(
            "environment=production",
            next(path for path in paths if "/v1/schema-releases?" in path),
        )

    def test_alert_acknowledgement_rejects_invalid_identifiers(self):
        client = SchemaGuardClient(
            "https://api.example.test", api_key="read-key"
        )
        for value in (0, -1, True, 9007199254740992):
            with self.assertRaises(ValueError):
                client.acknowledge_alert(value)

    def test_remote_errors_fail_closed(self):
        payload = JsonResponse(
            {"error": "invalid_api_key", "message": "invalid or revoked"}
        )
        error = urllib.error.HTTPError(
            "https://api.example.test/v1/usage",
            401,
            "Unauthorized",
            {},
            payload,
        )
        client = SchemaGuardClient(
            "https://api.example.test", api_key="invalid"
        )
        with patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(SchemaGuardServiceError) as caught:
                client.usage()
        self.assertEqual(caught.exception.status, 401)
        self.assertEqual(caught.exception.code, "invalid_api_key")


if __name__ == "__main__":
    unittest.main()

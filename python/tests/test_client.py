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
            if "/v1/audits?" in request.full_url:
                return JsonResponse({"audits": []})
            if request.full_url.endswith("/v1/audits/verify"):
                return JsonResponse({"valid": True, "checked": 0})
            if request.full_url.endswith("/v1/alerts"):
                return JsonResponse([])
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
            self.assertEqual(client.audits(25)["audits"], [])
            self.assertTrue(client.verify_audits()["valid"])
            self.assertEqual(client.alerts(), [])
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
        self.assertEqual(len(paths), 11)
        self.assertIn(
            "environment=production",
            next(path for path in paths if "/v1/schema-releases?" in path),
        )

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

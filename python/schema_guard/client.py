import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional


class SchemaGuardServiceError(RuntimeError):
    """A remote Schema Guard endpoint rejected or malformed a request."""

    def __init__(
        self,
        message: str,
        status: Optional[int] = None,
        code: Optional[str] = None,
    ):
        super().__init__(message)
        self.status = status
        self.code = code


class SchemaGuardClient:
    """Use the local canonical engine or a compatible HTTP endpoint."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        repository: Optional[Path] = None,
        timeout_seconds: float = 5.0,
    ):
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self.base_url = base_url.rstrip("/") if base_url else None
        self.api_key = api_key
        self.repository = repository or Path(__file__).resolve().parents[2]
        self.timeout_seconds = timeout_seconds

    def _request(
        self,
        path: str,
        method: str = "GET",
        body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        if not self.base_url:
            raise ValueError("base_url is required for a managed request")
        headers = {"accept": "application/json"}
        if self.api_key:
            headers["authorization"] = "Bearer " + self.api_key
        data = None
        if body is not None:
            headers["content-type"] = "application/json"
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(
                request, timeout=self.timeout_seconds
            ) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                payload = json.load(error)
            except (json.JSONDecodeError, UnicodeDecodeError):
                payload = {}
            if error.code == 422 and path == "/v1/validate":
                return payload
            code = payload.get("error") if isinstance(payload, dict) else None
            message = (
                payload.get("message")
                if isinstance(payload, dict)
                else None
            ) or "Schema Guard service failed with status " + str(error.code)
            raise SchemaGuardServiceError(message, error.code, code) from error

    def validate(self, request: Dict[str, Any]) -> Dict[str, Any]:
        if self.base_url:
            payload = self._request("/v1/validate", "POST", request)
            if not isinstance(payload, dict) or payload.get("decision") not in (
                "valid",
                "valid_with_repair",
                "rejected",
            ):
                raise SchemaGuardServiceError(
                    "Schema Guard service returned an invalid decision envelope",
                    code="invalid_service_response",
                )
            return payload
        script = "import {validateToolCall} from './packages/core/dist/index.js'; const chunks=[]; for await (const c of process.stdin) chunks.push(c); console.log(JSON.stringify(validateToolCall(JSON.parse(Buffer.concat(chunks)))));"
        completed = subprocess.run(
            ["node", "--input-type=module", "--eval", script],
            input=json.dumps(request),
            text=True,
            cwd=self.repository,
            check=True,
            capture_output=True,
        )
        return json.loads(completed.stdout)

    def usage(self) -> Dict[str, Any]:
        return self._request("/v1/usage")

    def tenant_lifecycle(self) -> Dict[str, Any]:
        payload = self._request("/v1/admin/tenant/lifecycle")
        lifecycle = payload.get("lifecycle") if isinstance(payload, dict) else None
        if not isinstance(lifecycle, dict) or lifecycle.get("status") not in (
            "active",
            "suspended",
            "canceled",
            "deletion_pending",
        ):
            raise SchemaGuardServiceError(
                "Schema Guard service returned an invalid tenant lifecycle",
                code="invalid_service_response",
            )
        return lifecycle

    def export_tenant_data(self) -> Dict[str, Any]:
        payload = self._request("/v1/admin/tenant/export")
        if (
            not isinstance(payload, dict)
            or payload.get("export_version") != 1
            or not isinstance(payload.get("tenant_id"), str)
            or not isinstance(payload.get("content_sha256"), str)
            or not isinstance(payload.get("tenant"), dict)
            or not isinstance(payload.get("tables"), dict)
        ):
            raise SchemaGuardServiceError(
                "Schema Guard service returned an invalid tenant export",
                code="invalid_service_response",
            )
        return payload

    def request_tenant_deletion(self, confirm_tenant_id: str) -> Dict[str, Any]:
        payload = self._request(
            "/v1/admin/tenant/deletion-request",
            "POST",
            {"confirm_tenant_id": confirm_tenant_id},
        )
        lifecycle = payload.get("lifecycle") if isinstance(payload, dict) else None
        if not isinstance(lifecycle, dict) or lifecycle.get("status") != "deletion_pending":
            raise SchemaGuardServiceError(
                "Schema Guard service returned an invalid deletion request result",
                code="invalid_service_response",
            )
        return lifecycle

    def audits(self, limit: int = 100) -> Dict[str, Any]:
        if limit < 1 or limit > 1000:
            raise ValueError("limit must be between 1 and 1000")
        return self._request("/v1/audits?limit=" + str(limit))

    def verify_audits(self) -> Dict[str, Any]:
        return self._request("/v1/audits/verify")

    def alerts(self) -> Any:
        return self._request("/v1/alerts")

    def environments(self) -> Any:
        return self._request("/v1/environments")

    def intelligence(self) -> Dict[str, Any]:
        return self._request("/v1/intelligence")

    def schema_releases(
        self, environment: Optional[str] = None, limit: int = 100
    ) -> Any:
        if limit < 1 or limit > 1000:
            raise ValueError("limit must be between 1 and 1000")
        query = {"limit": str(limit)}
        if environment:
            query["environment"] = environment
        return self._request(
            "/v1/schema-releases?" + urllib.parse.urlencode(query)
        )

    def verify_schema_releases(self) -> Dict[str, Any]:
        return self._request("/v1/schema-releases/verify")

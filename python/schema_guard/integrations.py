"""Optional runtime integrations for Python agent frameworks.

Framework imports happen only when a factory is called, so the core client
does not require PydanticAI or Google ADK.
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Any, Callable, Dict, Optional

from .client import SchemaGuardClient


class SchemaGuardRejectedError(RuntimeError):
    """Raised when a guarded framework call must not reach its tool."""

    def __init__(self, decision: Dict[str, Any]):
        self.decision = decision
        super().__init__(f"Schema Guard rejected tool execution: {decision.get('reason', 'rejected')}")


async def _notify(callback: Optional[Callable[[Dict[str, Any]], Any]], decision: Dict[str, Any]) -> None:
    if callback is None:
        return
    result = callback(decision)
    if inspect.isawaitable(result):
        await result


async def _validate(client: SchemaGuardClient, request: Dict[str, Any]) -> Dict[str, Any]:
    return await asyncio.to_thread(client.validate, request)


def pydantic_ai_capability(
    *,
    client: Optional[SchemaGuardClient] = None,
    policy: Optional[Dict[str, Any]] = None,
    on_decision: Optional[Callable[[Dict[str, Any]], Any]] = None,
) -> Any:
    """Create a PydanticAI capability that guards raw args before validation.

    Accepted repairs are returned to PydanticAI for its native validation and
    execution. Rejections raise before the tool function can run.
    """

    try:
        from pydantic_ai.capabilities import AbstractCapability
    except ImportError as error:  # pragma: no cover - depends on optional package
        raise RuntimeError("install pydantic-ai-slim to use this integration") from error

    guard_client = client or SchemaGuardClient()

    class SchemaGuardCapability(AbstractCapability[Any]):
        async def before_tool_validate(
            self,
            ctx: Any,
            *,
            call: Any,
            tool_def: Any,
            args: Any,
        ) -> Any:
            request: Dict[str, Any] = {
                "tool_name": tool_def.name,
                "tool_schema": tool_def.parameters_json_schema,
                "raw_arguments": args,
                "context": {"adapter": "pydantic_ai", "framework": "pydantic-ai"},
            }
            if policy is not None:
                request["policy"] = policy
            decision = await _validate(guard_client, request)
            await _notify(on_decision, decision)
            if decision["decision"] == "rejected":
                raise SchemaGuardRejectedError(decision)
            return decision["valid_arguments"]

    return SchemaGuardCapability()


def _normalize_google_schema(value: Any) -> Any:
    if isinstance(value, list):
        return [_normalize_google_schema(item) for item in value]
    if not isinstance(value, dict):
        return value
    normalized: Dict[str, Any] = {}
    for key, child in value.items():
        if key == "type" and isinstance(child, str):
            normalized[key] = child.lower()
        elif key == "type" and isinstance(child, list):
            normalized[key] = [item.lower() if isinstance(item, str) else item for item in child]
        else:
            normalized[key] = _normalize_google_schema(child)
    return normalized


def google_adk_plugin(
    *,
    client: Optional[SchemaGuardClient] = None,
    policy: Optional[Dict[str, Any]] = None,
    on_decision: Optional[Callable[[Dict[str, Any]], Any]] = None,
) -> Any:
    """Create a Google ADK plugin that guards every local tool callback."""

    try:
        from google.adk.plugins import BasePlugin
    except ImportError as error:  # pragma: no cover - depends on optional package
        raise RuntimeError("install google-adk to use this integration") from error

    guard_client = client or SchemaGuardClient()

    class SchemaGuardPlugin(BasePlugin):
        def __init__(self) -> None:
            super().__init__(name="schema_guard")

        async def before_tool_callback(
            self,
            *,
            tool: Any,
            tool_args: Dict[str, Any],
            tool_context: Any,
        ) -> Optional[Dict[str, Any]]:
            declaration = tool._get_declaration()
            if declaration is None:
                return {
                    "error": "Schema Guard denied a tool with no machine-readable declaration",
                    "schema_guard": {"decision": "rejected", "reason_code": "SCHEMA_INVALID"},
                }
            source = declaration.model_dump(exclude_none=True, by_alias=True)
            schema = (
                source.get("parametersJsonSchema")
                or source.get("parameters_json_schema")
                or source.get("parameters")
            )
            request: Dict[str, Any] = {
                "tool_name": source.get("name", tool.name),
                "tool_schema": _normalize_google_schema(schema),
                "raw_arguments": tool_args,
                "context": {"adapter": "google_adk", "framework": "google-adk"},
            }
            if policy is not None:
                request["policy"] = policy
            decision = await _validate(guard_client, request)
            await _notify(on_decision, decision)
            if decision["decision"] == "rejected":
                return {
                    "error": decision.get("reason", "Schema Guard rejected tool execution"),
                    "schema_guard": {
                        "decision": "rejected",
                        "reason_code": decision.get("reason_code"),
                        "audit_id": decision.get("audit_id"),
                    },
                }
            tool_args.clear()
            tool_args.update(decision["valid_arguments"])
            return None

    return SchemaGuardPlugin()

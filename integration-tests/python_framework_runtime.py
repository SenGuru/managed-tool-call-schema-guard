#!/usr/bin/env python3
"""Controlled end-to-end runs through real PydanticAI and Google ADK runtimes."""

from __future__ import annotations

import asyncio
import importlib.metadata
import json
from typing import AsyncGenerator

from google.adk.agents.llm_agent import Agent as GoogleAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import InMemoryRunner
from google.genai import types
from pydantic_ai import Agent as PydanticAgent
from pydantic_ai import ModelMessage, ModelResponse, TextPart, ToolCallPart, models
from pydantic_ai.models.function import AgentInfo, FunctionModel

from schema_guard.integrations import (
    SchemaGuardRejectedError,
    google_adk_plugin,
    pydantic_ai_capability,
)


models.ALLOW_MODEL_REQUESTS = False


async def run_pydantic_ai() -> dict[str, object]:
    decisions: list[str] = []
    executions: list[int] = []
    model_turn = 0

    def scripted_model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal model_turn
        model_turn += 1
        if model_turn == 1:
            return ModelResponse(parts=[ToolCallPart("increment", {"count": "2"})])
        return ModelResponse(parts=[TextPart("done")])

    agent = PydanticAgent(
        FunctionModel(scripted_model),
        capabilities=[pydantic_ai_capability(on_decision=lambda d: decisions.append(d["decision"]))],
    )

    @agent.tool_plain
    async def increment(count: int) -> int:
        executions.append(count)
        return count + 1

    result = await agent.run("increment")
    assert result.output == "done"
    assert executions == [2]
    assert decisions == ["valid_with_repair"]

    rejected_executions: list[int] = []
    rejected_decisions: list[str] = []

    def rejected_model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart("dangerous_increment", {"count": "02"})])

    rejected_agent = PydanticAgent(
        FunctionModel(rejected_model),
        capabilities=[
            pydantic_ai_capability(
                on_decision=lambda d: rejected_decisions.append(d["decision"])
            )
        ],
    )

    @rejected_agent.tool_plain
    async def dangerous_increment(count: int) -> int:
        rejected_executions.append(count)
        return count + 1

    try:
        await rejected_agent.run("increment")
    except SchemaGuardRejectedError:
        pass
    else:  # pragma: no cover - assertion path
        raise AssertionError("PydanticAI rejection did not stop the run")
    assert rejected_executions == []
    assert rejected_decisions == ["rejected"]
    return {
        "framework": "pydantic-ai",
        "repair_decision": decisions[0],
        "repaired_execution_argument": executions[0],
        "rejection_decision": rejected_decisions[0],
        "rejected_tool_executions": len(rejected_executions),
    }


class ScriptedGoogleModel(BaseLlm):
    model: str = "schema-guard-scripted-model"
    responses: list[LlmResponse]
    response_index: int = 0

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        response = self.responses[self.response_index]
        self.response_index += 1
        yield response


def google_response(part: types.Part) -> LlmResponse:
    return LlmResponse(content=types.Content(role="model", parts=[part]))


async def run_google_adk_case(raw_count: str) -> tuple[list[int], list[str], list[object]]:
    executions: list[int] = []
    decisions: list[str] = []

    def increment(count: int) -> dict[str, int]:
        executions.append(count)
        return {"result": count + 1}

    model = ScriptedGoogleModel(
        responses=[
            google_response(types.Part.from_function_call(name="increment", args={"count": raw_count})),
            google_response(types.Part.from_text(text="done")),
        ]
    )
    agent = GoogleAgent(name="schema_guard_agent", model=model, tools=[increment])
    runner = InMemoryRunner(
        agent=agent,
        plugins=[google_adk_plugin(on_decision=lambda d: decisions.append(d["decision"]))],
    )
    await runner.session_service.create_session(
        app_name=runner.app_name, user_id="integration-user", session_id=f"case-{raw_count}"
    )
    events = [
        event
        async for event in runner.run_async(
            user_id="integration-user",
            session_id=f"case-{raw_count}",
            new_message=types.Content(role="user", parts=[types.Part.from_text(text="increment")]),
        )
    ]
    await runner.close()
    return executions, decisions, events


async def run_google_adk() -> dict[str, object]:
    repaired_executions, repaired_decisions, repaired_events = await run_google_adk_case("2")
    assert repaired_executions == [2], {
        "executions": repaired_executions,
        "decisions": repaired_decisions,
    }
    assert repaired_decisions == ["valid_with_repair"]
    assert repaired_events

    rejected_executions, rejected_decisions, rejected_events = await run_google_adk_case("02")
    assert rejected_executions == []
    assert rejected_decisions == ["rejected"]
    assert rejected_events
    return {
        "framework": "google-adk",
        "repair_decision": repaired_decisions[0],
        "repaired_execution_argument": repaired_executions[0],
        "rejection_decision": rejected_decisions[0],
        "rejected_tool_executions": len(rejected_executions),
    }


async def main() -> None:
    results = [await run_pydantic_ai(), await run_google_adk()]
    print(
        json.dumps(
            {
                "passed": True,
                "versions": {
                    "pydantic-ai-slim": importlib.metadata.version("pydantic-ai-slim"),
                    "google-adk": importlib.metadata.version("google-adk"),
                },
                "results": results,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())

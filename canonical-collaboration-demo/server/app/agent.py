import json
import time
from typing import Any

from openai import AsyncOpenAI
from superdoc import create_agent_toolkit

from .config import settings


MAX_TURNS = 12


class DocumentAgent:
    def __init__(self) -> None:
        self._toolkit = create_agent_toolkit({"provider": "openai", "preset": "core"})

    async def run(
        self,
        document: Any,
        prompt: str,
        history: list[dict[str, Any]],
        is_suggesting: bool,
    ) -> str:
        openai = AsyncOpenAI()
        change_mode = "tracked" if is_suggesting else "direct"
        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": (
                    f'{self._toolkit["system_prompt"]}\n\n'
                    f"For this request, every document mutation must use changeMode={change_mode}. "
                    "Choose actions that support this change mode."
                ),
            },
            *history,
            {"role": "user", "content": prompt},
        ]
        full_output = ""

        for turn in range(MAX_TURNS):
            response = await openai.chat.completions.create(
                model=settings.openai_model,
                messages=messages,
                tools=self._toolkit["tools"],
            )
            choice = response.choices[0].message
            if choice.content:
                full_output += choice.content
            if not choice.tool_calls:
                answer = full_output or "Document updated."
                history.extend(
                    [
                        {"role": "user", "content": prompt},
                        {"role": "assistant", "content": answer},
                    ]
                )
                return answer

            messages.append(choice.model_dump(exclude_none=True))
            for call in choice.tool_calls:
                started = time.monotonic()
                arguments: dict[str, Any] = {}
                try:
                    arguments = json.loads(call.function.arguments or "{}")
                    if call.function.name == "superdoc_perform_action":
                        arguments["changeMode"] = change_mode
                    result = await self._toolkit["dispatch_async"](
                        document,
                        call.function.name,
                        arguments,
                    )
                except Exception as error:
                    result = {"ok": False, "error": str(error)}
                print(
                    json.dumps(
                        {
                            "event": "agent.tool",
                            "tool": call.function.name,
                            "changeMode": change_mode,
                            "arguments": arguments,
                            "durationMs": round((time.monotonic() - started) * 1000),
                            "result": result,
                        },
                        default=str,
                    ),
                    flush=True,
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": result if isinstance(result, str) else json.dumps(result, default=str),
                    }
                )

        answer = full_output or "The agent reached its turn limit."
        history.extend(
            [
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": answer},
            ]
        )
        return answer

    async def dispatch(self, document: Any, tool: str, arguments: dict[str, Any]) -> Any:
        return await self._toolkit["dispatch_async"](document, tool, arguments)

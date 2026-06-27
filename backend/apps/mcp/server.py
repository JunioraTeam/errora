"""
Minimal MCP (Model Context Protocol) server core — JSON-RPC 2.0 dispatch.

Stateless: supports ``initialize``, ``tools/list``, ``tools/call`` and ``ping``.
No session/SSE streaming is required for a tool server, so the HTTP transport
returns a single JSON response per request (the "Streamable HTTP" JSON path).
"""

from __future__ import annotations

import json
import logging

from .tools import TOOLS, TOOLS_BY_NAME, Tool, ToolError

logger = logging.getLogger(__name__)

DEFAULT_PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "errora-mcp", "version": "1.0.0"}


def _result(mid, result) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _error(mid, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def _tool_schema(t: Tool) -> dict:
    return {"name": t.name, "description": t.description, "inputSchema": t.input_schema}


def handle_message(user, message: dict) -> dict | None:
    """Dispatch a single JSON-RPC message. Returns a response dict, or ``None``
    for notifications (no ``id``)."""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _error(
            message.get("id") if isinstance(message, dict) else None, -32600, "Invalid Request"
        )

    method = message.get("method")
    mid = message.get("id")
    params = message.get("params") or {}
    is_notification = "id" not in message

    if method == "initialize":
        return _result(
            mid,
            {
                "protocolVersion": params.get("protocolVersion") or DEFAULT_PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
            },
        )

    if method and method.startswith("notifications/"):
        return None  # fire-and-forget

    if method == "ping":
        return _result(mid, {})

    if method == "tools/list":
        return _result(mid, {"tools": [_tool_schema(t) for t in TOOLS]})

    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        tool = TOOLS_BY_NAME.get(name)
        if tool is None:
            return _error(mid, -32602, f"Unknown tool: {name}")
        try:
            data = tool.handler(user, args)
            text = json.dumps(data, default=str, ensure_ascii=False, indent=2)
            return _result(mid, {"content": [{"type": "text", "text": text}], "isError": False})
        except ToolError as exc:
            # ToolError messages are intentionally user-facing.
            return _result(mid, {"content": [{"type": "text", "text": str(exc)}], "isError": True})
        except Exception:  # noqa: BLE001 - surface as a tool error, not a 500
            # Log server-side; don't leak internals (SQL/paths/reprs) to the agent.
            logger.exception("MCP tool %r failed", name)
            return _result(
                mid,
                {
                    "content": [{"type": "text", "text": "Internal error running tool."}],
                    "isError": True,
                },
            )

    if is_notification:
        return None
    return _error(mid, -32601, f"Method not found: {method}")

import pytest
from services.llm.tool_trace import tool_trace, record_tool_event, record_tool_context


def test_disabled_trace_is_noop():
    token = tool_trace.set(None)
    try:
        record_tool_context("openai", {"tools": [{"type": "function"}]})
        record_tool_event({"phase": "end", "result": "private"})
        assert tool_trace.get() is None
    finally:
        tool_trace.reset(token)


@pytest.mark.parametrize("provider,body", [
    ("openai", {"messages": [{"role": "tool", "tool_call_id": "x", "content": "model-visible result"}]}),
    ("gemini", {"contents": [{"role": "user", "parts": [{"functionResponse": {"name": "search", "response": {"result": "model-visible result"}}}]}]}),
    ("claude", {"messages": [{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "x", "content": "model-visible result"}]}]}),
])
def test_outgoing_context_snapshot_is_exact_and_not_mutated(provider, body):
    trace = {"executions": [], "model_requests": []}
    token = tool_trace.set(trace)
    try:
        record_tool_context(provider, body)
        assert "model-visible result" in str(trace)
        assert trace["model_requests"][0]["provider"] == provider
        body.clear()
        assert "model-visible result" in str(trace)
    finally:
        tool_trace.reset(token)


def test_outgoing_tool_definitions_are_logged_without_tool_calls():
    trace = {"executions": [], "model_requests": []}
    token = tool_trace.set(trace)
    try:
        function = {"name": "search", "description": "Search the web with Bearer private-token",
                    "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}
        record_tool_context("openai", {
            "messages": [{"role": "user", "content": "Hi"}],
            "tools": [{"type": "function", "function": function}],
        })
        function["parameters"]["properties"].clear()
        assert trace["model_requests"] == [{
            "provider": "openai",
            "tools": [{"type": "function", "function": {
                "name": "search", "description": "Search the web with Bearer [REDACTED]",
                "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
            }}],
        }]
    finally:
        tool_trace.reset(token)


def test_arguments_results_and_auth_redaction():
    trace = {"executions": [], "model_requests": []}
    token = tool_trace.set(trace)
    try:
        record_tool_event({"phase": "end", "name": "web_search",
                           "args": {"query": "latest CEO", "api_key": "hidden-key"},
                           "result": '{"text":"CEO evidence","access_token":"hidden-token"}'})
        entry = trace["executions"][0]
        assert entry["status"] == "success"
        assert entry["args"]["query"] == "latest CEO"
        assert "CEO evidence" in entry["result"]
        assert "hidden-key" not in str(trace)
        assert "hidden-token" not in str(trace)
        record_tool_context("openai", {"messages": [{"role": "tool", "content": "Authorization: Bearer abc123"}]})
        assert "abc123" not in str(trace)
    finally:
        tool_trace.reset(token)


def test_failed_and_rejected_results_keep_their_status():
    trace = {"executions": [], "model_requests": []}
    token = tool_trace.set(trace)
    try:
        record_tool_event({"phase": "end", "name": "search", "result": "[오류] unavailable"})
        record_tool_event({"phase": "approval_rejected", "name": "write", "result": "not approved"})
        assert [entry["status"] for entry in trace["executions"]] == ["error", "rejected"]
    finally:
        tool_trace.reset(token)

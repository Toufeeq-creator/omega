# omega-protect

> Reliability and invariant-bounded autonomous recovery for Python AI agents.

Stop your LangGraph, CrewAI, or AutoGen agents from crashing on tool-calls, rate limits (429), or malformed JSON outputs.

## Install

```bash
pip install omega-protect
```

## Quick Start (2 Lines)

```python
from omega_protect import omega_protect

@omega_protect(
    name="settle_account",
    invariants=["debits == credits", "confidence >= 0.8"]
)
def my_agent_tool_call(batch):
    # Your existing agent or tool-calling code
    return {"debits": 500.0, "credits": 500.0, "confidence": 0.95}
```

## License

Apache-2.0

# ModusFlow Omega

> **Stop your AI agents from silently breaking and double-charging APIs.**  
> Invariant-bounded autonomous reliability substrate for Python & TypeScript AI workflows.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/chaos%20tests-passing-brightgreen)](tests/chaos)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)](packages/typescript)
[![Python](https://img.shields.io/badge/Python-3.9+-blue)](packages/python)

---

## Why Omega? (The 30-Second Problem)

In production, autonomous AI agents (LangGraph, CrewAI, OpenAI tool-calls) break constantly:
1. **Upstream rate limits (HTTP 429)** or token rotation halt execution.
2. **Third-party APIs silently change JSON schemas** or drop expected fields.
3. **LLMs return malformed JSON** or trigger content safety refusals.
4. **Worst of all:** When a workflow crashes after initiating an external mutation (e.g. charging Stripe, sending an email, writing to a DB), **naive retries double-charge the card or corrupt downstream state**.

---

## Before vs. After

### ❌ Without Omega (Brittle & Dangerous)
```python
try:
    res = agent_tool_call(batch)
except RateLimitError:
    # Hope you didn't charge the customer yet...
    time.sleep(2)
    # Naive retry: Will this charge Stripe a second time? Who knows.
    res = agent_tool_call(batch)
# Hope the LLM output actually balanced the financial books...
```

### ✅ With Omega (2 Lines of Code)
```python
from omega_protect import omega_protect

@omega_protect(invariants=["debits == credits", "confidence >= 0.8"])
def agent_tool_call(batch):
    return process_settlement(batch)
```

**What Omega does automatically behind the scenes:**
- **Evaluates Invariants:** Proves mathematical constraints (`debits == credits`) before returning output.
- **Side-Effect Virtualization:** Records external API mutations during live execution and **virtualizes them during replay** so candidate repairs never double-charge remote APIs.
- **Dynamic Schema Lenses:** Automatically inspects and adapts unannounced third-party JSON schema mutations.
- **Durable Checkpointing:** Transactional write-ahead journaling backed by SQLite in high-speed WAL mode.

---

## Quick Start

### Python (LangGraph, CrewAI, AutoGen)
```bash
pip install omega-protect
```
```python
from omega_protect import omega_protect

@omega_protect(
    name="settlement_step",
    invariants=["debits == credits"]
)
def settle_records(batch_id):
    return my_langgraph_pipeline(batch_id)
```

### TypeScript / Node.js
```bash
npm install @modusflow/omega
```

#### Zero-Proxy Transparent Mode (Recommended)
Write standard `fetch()` calls with **zero proxy parameters** — Omega transparently intercepts and virtualizes calls during sandbox replays:
```typescript
import { omega } from "@modusflow/omega";

export const protectedStep = omega.protect(
  "settle_step",
  async (batch) => {
    // Ordinary fetch() — zero proxy parameters needed!
    // Outgoing calls are recorded in live mode, virtualized in sandbox replays.
    const res = await fetch("https://api.stripe.com/v1/charges", {
      method: "POST",
      body: JSON.stringify(batch),
    });
    return await res.json();
  },
  {
    invariants: ["debits == credits"],
    sideEffect: "Compensatable",
  }
);
```

#### CEGIS AST Self-Healing Engine
When APIs silently change schema, Omega uses Counterexample-Guided Inductive Synthesis (CEGIS) to surgically isolate failing AST nodes, synthesize candidate repairs, fuzz invariants in an isolated sandbox, and output verified Git diffs with SHA-256 cryptographic attestation.

---

## Real-World Battle & Chaos Benchmark

Omega includes real-world distributed chaos test suites testing over actual TCP sockets, real disk files, and live internet HTTPS connections:

```bash
# Run the complete test suite (all 23 chaos & reliability scenarios)
npm run test:all

# Or run individual specialized suites:
npm run test:transparent   # Zero-proxy interception & sandbox replay virtualization
npm run test:cegis         # AST counterexample synthesis & SHA-256 attestation
npm run test:chaos         # Live TCP socket drops & double-charging prevention
npm run test:extreme       # Ambiguous two-phase commit timeouts & 50-worker WAL stress
```

### Scorecard (23 / 23 Scenarios Passing)
```text
════════════════════════════════════════════════════════════════════════════
MASTER TEST SCORECARD: 23 / 23 PASSED (100%)
- Live Network Double-Charging Prevention: VERIFIED (0 Duplicate Charges)
- Transparent Network Interception:        VERIFIED (0 Real Hits in Sandbox)
- CEGIS AST Code Synthesis & Repair:       VERIFIED (SHA-256 Attestation)
- Live Upstream Schema Drift Adaptation:   VERIFIED (Dynamic Lens)
- Hard TCP Socket Drop Recovery:          VERIFIED (ECONNRESET handled)
- Post-Crash Disk SQLite Replay:          VERIFIED (0 State Drift)
- High-Stress 50-Worker SQLite WAL Mode:  VERIFIED (308.6 runs/sec)
- Ambiguous Two-Phase Commit Recovery:    VERIFIED (Reconciled with 0 Duplicates)
════════════════════════════════════════════════════════════════════════════
```

---

## Architecture & Manifesto

Read the complete technical design in [RELIABILITY_SUBSTRATE.md](RELIABILITY_SUBSTRATE.md).

## License

[Apache-2.0](LICENSE)

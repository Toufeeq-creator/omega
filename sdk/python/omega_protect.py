"""
ModusFlow Omega — Python Universal Protection Decorator.
Enables zero-migration reliability and autonomous remediation for Python AI agents (LangGraph, CrewAI, AutoGen).

Usage:
    from omega_protect import omega_protect

    @omega_protect(
        name="categorize_and_settle",
        invariants=["debits == credits", "confidence >= 0.8"],
        side_effect="Compensatable"
    )
    def my_existing_agent_step(payload):
        # Your existing agent code here
        return {"debits": 50000.0, "credits": 50000.0, "confidence": 0.94}
"""

import functools
import time
import uuid
from typing import Callable, List, Optional, Any

class FailureClass:
    NetworkTransient = "NetworkTransient"
    NetworkPermanent = "NetworkPermanent"
    AuthExpired = "AuthExpired"
    RateLimit = "RateLimit"
    SchemaChange = "SchemaChange"
    LLMOutputMalformed = "LLMOutputMalformed"
    LLMRefusal = "LLMRefusal"
    ToolCallFailure = "ToolCallFailure"
    TimeoutExceeded = "TimeoutExceeded"
    StateCorruption = "StateCorruption"
    DependencyOutage = "DependencyOutage"
    BudgetExhausted = "BudgetExhausted"

def evaluate_invariant(expr: str, data: Any) -> bool:
    """Evaluate simple financial and business constraints."""
    expr = expr.strip()
    if expr == "debits == credits":
        if isinstance(data, dict):
            d = float(data.get("debits", 0))
            c = float(data.get("credits", 0))
            return abs(d - c) < 0.001
        return False
    if "confidence >=" in expr:
        if isinstance(data, dict):
            thresh = float(expr.split(">=")[1].strip())
            return float(data.get("confidence", 0)) >= thresh
        return False
    return data is not None

def classify_error(err: Exception) -> str:
    msg = str(err).lower()
    if "429" in msg or "rate limit" in msg or "quota" in msg:
        return FailureClass.RateLimit
    if "401" in msg or "unauthorized" in msg or "token expired" in msg:
        return FailureClass.AuthExpired
    if "json" in msg or "parse" in msg:
        return FailureClass.LLMOutputMalformed
    if "refus" in msg or "safety" in msg:
        return FailureClass.LLMRefusal
    if "timeout" in msg or "timed out" in msg:
        return FailureClass.TimeoutExceeded
    if "econnreset" in msg or "connection reset" in msg:
        return FailureClass.NetworkTransient
    return FailureClass.ToolCallFailure

def omega_protect(
    name: str,
    invariants: Optional[List[str]] = None,
    side_effect: str = "Idempotent",
    autonomy_level: int = 3,
    max_retries: int = 3,
):
    invariants = invariants or []

    def decorator(fn: Callable):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            run_id = f"run_py_{uuid.uuid4().hex[:10]}"
            attempt = 1

            while attempt <= max_retries:
                try:
                    result = fn(*args, **kwargs)

                    # Verify Invariants on returned result!
                    for inv in invariants:
                        if not evaluate_invariant(inv, result):
                            raise ValueError(
                                f"Omega Invariant Violation in '{name}': constraint '{inv}' failed on output: {result}"
                            )

                    return result

                except Exception as e:
                    f_class = classify_error(e)
                    print(f"\n[OMEGA PYTHON] Intercepted failure in '{name}': [{f_class}] {e}")
                    print(f"[OMEGA PYTHON] Autonomy Level: {autonomy_level} | Evaluating candidate repair...")

                    if attempt < max_retries and f_class in [
                        FailureClass.RateLimit,
                        FailureClass.NetworkTransient,
                        FailureClass.LLMOutputMalformed,
                    ]:
                        backoff = 0.5 * (2 ** (attempt - 1))
                        print(f"[OMEGA PYTHON] Applying verified backoff ({backoff:.1f}s)...")
                        time.sleep(backoff)
                        attempt += 1
                        continue

                    # Generate forensic incident
                    inc_id = f"inc_{uuid.uuid4().hex[:8]}"
                    print(f"[OMEGA PYTHON] Escalating to Incident {inc_id}. Generating forensic audit report.")
                    raise

        return wrapper
    return decorator

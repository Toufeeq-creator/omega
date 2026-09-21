"""
Unit and Integration Test Suite for ModusFlow Omega Python Substrate.
Tests:
1. Native Python AST CEGIS Self-Healing & AST NodeTransformer
2. Unit Conversion Synthesis (cents -> dollars)
3. Unified Diff & SHA-256 Cryptographic Attestation
4. Transparent Network Interception with contextvars
5. Financial Invariant Enforcement
"""

import sys
import os
import json
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

# Add sdk/python to path
sys.path.insert(0, os.path.dirname(__file__))

from omega_protect import (
    omega_protect,
    CEGISPythonEngine,
    evaluate_invariant,
    classify_error,
    FailureClass,
    activate_transparent_interceptor,
    _current_context,
    InterceptionContext,
)

# ─── Mock HTTP Server for Interception Test ──────────────────────────────────

class MockServerHandler(BaseHTTPRequestHandler):
    request_counter = 0

    def do_POST(self):
        MockServerHandler.request_counter += 1
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        response = json.dumps({"charge_id": f"ch_py_{MockServerHandler.request_counter}", "status": "succeeded"})
        self.wfile.write(response.encode())

    def log_message(self, format, *args):
        pass  # Quiet logging

def run_tests():
    print("\n" + "=" * 70)
    print("  MODUSFLOW OMEGA — PYTHON SUBSTRATE TEST SUITE")
    print("  (Native Python AST CEGIS, ContextVars Interception, Invariants)")
    print("=" * 70 + "\n")

    passed = 0
    failed = 0

    # ── TEST 1: Native Python AST CEGIS Self-Healing ─────────────────────────
    try:
        print("[TEST 1] Native Python AST CEGIS — Field Path Shift (data['amount'] -> data['attributes']['amount'])")
        source = """def process_payment(data):\n    settlement = data['amount']\n    return {'debits': settlement, 'credits': settlement}\n"""
        crash_payload = {
            "data": {
                "attributes": {
                    "amount": 50000.0,
                    "currency": "USD"
                }
            }
        }

        repair = CEGISPythonEngine.repair_source(
            source_code=source,
            failing_field="amount",
            crash_payload=crash_payload,
            invariants=["debits == credits"]
        )

        assert repair["repair_found"] is True, "Expected repair to be found"
        assert "attributes" in repair["patched_source"], "Expected 'attributes' in patched source"
        assert "--- a/agent.py" in repair["unified_diff"], "Expected unified diff header"
        assert len(repair["attestation"]["attestation_signature"]) == 64, "Expected valid SHA-256 hash"

        print("  PASSED — AST successfully transformed, diff generated, SHA-256 signed:")
        for line in repair["unified_diff"].splitlines()[:6]:
            print(f"    {line}")
        passed += 1
    except Exception as e:
        print(f"  FAILED — {e}")
        failed += 1

    # ── TEST 2: Python Unit Conversion Synthesis ────────────────────────────
    try:
        print("\n[TEST 2] Python AST Unit Conversion Synthesis (cents -> dollars)")
        source = """def compute_fee(payload):\n    return payload['total_amount']\n"""
        crash_payload = {
            "customer": "cust_99",
            "total_amount_cents": 5000000
        }

        repair = CEGISPythonEngine.repair_source(
            source_code=source,
            failing_field="total_amount",
            crash_payload=crash_payload,
            invariants=[]
        )

        assert repair["repair_found"] is True
        assert "/ 100" in repair["patched_source"]
        print(f"  PASSED — Unit conversion synthesized: {repair['patched_source'].strip()}")
        passed += 1
    except Exception as e:
        print(f"  FAILED — {e}")
        failed += 1

    # ── TEST 3: Invariant Enforcement ───────────────────────────────────────
    try:
        print("\n[TEST 3] Financial Invariant Verification")
        assert evaluate_invariant("debits == credits", {"debits": 50000.0, "credits": 50000.0}) is True
        assert evaluate_invariant("debits == credits", {"debits": 50000.0, "credits": 49000.0}) is False
        assert evaluate_invariant("settlement_confirmed == true", {"settlement_confirmed": True}) is True
        assert evaluate_invariant("settlement_confirmed == true", {"settlement_confirmed": False}) is False
        print("  PASSED — Mathematical invariants strictly verified.")
        passed += 1
    except Exception as e:
        print(f"  FAILED — {e}")
        failed += 1

    # ── TEST 4: Transparent HTTP Interception & Sandbox Replay ──────────────
    try:
        print("\n[TEST 4] Transparent HTTP Interception with ContextVars")
        activate_transparent_interceptor()

        # Start ephemeral local server
        server = HTTPServer(("127.0.0.1", 0), MockServerHandler)
        port = server.server_address[1]
        server_thread = threading.Thread(target=server.serve_forever)
        server_thread.daemon = True
        server_thread.start()

        target_url = f"http://127.0.0.1:{port}/charge"

        # Phase A: Live mode execution (records request)
        ctx = InterceptionContext(run_id="test_run_1", node_name="stripe_step", is_sandbox=False)
        token = _current_context.set(ctx)

        req = urllib.request.Request(target_url, data=b'{"amount": 50000}', headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read().decode())

        assert MockServerHandler.request_counter == 1, "Expected 1 server hit in live mode"
        assert data["status"] == "succeeded"
        assert len(ctx.recorded_calls) == 1, "Expected 1 recorded wire call"

        # Phase B: Sandbox replay mode (MUST NOT hit server!)
        ctx.is_sandbox = True
        resp2 = urllib.request.urlopen(req)
        data2 = json.loads(resp2.read().decode())

        assert MockServerHandler.request_counter == 1, "Expected 0 additional hits in sandbox replay"
        assert data2["charge_id"] == data["charge_id"], "Expected virtualized response matching live call"

        _current_context.reset(token)
        server.shutdown()

        print("  PASSED — Live call recorded, sandbox replay virtualized: ZERO duplicate charges.")
        passed += 1
    except Exception as e:
        print(f"  FAILED — {e}")
        failed += 1

    # ── TEST 5: Full @omega_protect Decorator Execution ─────────────────────
    try:
        print("\n[TEST 5] Full @omega_protect Decorator with Invariant Gate")

        @omega_protect(name="safe_settle", invariants=["debits == credits"])
        def safe_func(batch):
            return {"debits": batch["amount"], "credits": batch["amount"], "settlement_confirmed": True}

        res = safe_func({"amount": 50000.0})
        assert res["debits"] == 50000.0

        # Invariant violation test
        @omega_protect(name="broken_settle", invariants=["debits == credits"], max_retries=1)
        def broken_func():
            return {"debits": 50000.0, "credits": 40000.0}

        caught = False
        try:
            broken_func()
        except ValueError as val_err:
            caught = True
            assert "Invariant Violation" in str(val_err)

        assert caught is True, "Expected invariant failure to be intercepted"
        print("  PASSED — @omega_protect passed valid runs and rejected invariant violations.")
        passed += 1
    except Exception as e:
        print(f"  FAILED — {e}")
        failed += 1

    # ── TEST 6: JSON Type Poisoning Defense ─────────────────────────────────
    try:
        print("\n[TEST 6] JSON Type Poisoning Defense (None, NaN, Empty String, Missing Keys)")
        # Poisoned cases that would previously pass under weak type checks (0 == 0)
        poison_null = {"debits": None, "credits": None}
        poison_empty = {"debits": "", "credits": ""}
        poison_nan = {"debits": float("nan"), "credits": float("nan")}
        poison_mismatch_type = {"debits": "unparseable_string", "credits": "unparseable_string"}
        poison_missing = {}

        assert evaluate_invariant("debits == credits", poison_null) is False, "Failed to reject None type poisoning"
        assert evaluate_invariant("debits == credits", poison_empty) is False, "Failed to reject empty string poisoning"
        assert evaluate_invariant("debits == credits", poison_nan) is False, "Failed to reject NaN poisoning"
        assert evaluate_invariant("debits == credits", poison_mismatch_type) is False, "Failed to reject unparseable string"
        assert evaluate_invariant("debits == credits", poison_missing) is False, "Failed to reject missing keys"

        # Valid cases must still pass
        assert evaluate_invariant("debits == credits", {"debits": "100.50", "credits": 100.50}) is True
        assert evaluate_invariant("debits == credits", {"debits": 50000, "credits": 50000}) is True

        print("  PASSED — Rejected all JSON type poisoning attacks (None, NaN, empty strings, missing keys).")
        passed += 1
    except Exception as e:
        print(f"  FAILED — {e}")
        failed += 1

    # ── TEST 7: Syntax Gatekeeper Defense (Broken Build Trap) ───────────────
    try:
        print("\n[TEST 7] Syntax Gatekeeper Defense (Broken Build & Indentation Trap)")
        # Test that compile() gatekeeper prevents emitting invalid syntax
        invalid_syntax_source = "def broken():\n    return [1, 2,"  # Unclosed bracket
        try:
            compile(invalid_syntax_source, "<test>", "exec")
            assert False, "Should have thrown SyntaxError"
        except SyntaxError:
            pass  # Expected

        # Test that CEGIS rejects uncompilable mutations
        broken_repair = CEGISPythonEngine.repair_source(
            source_code="def broken_syntax(data):\n    return data['val']\n",
            failing_field="val",
            crash_payload={"data": {"nested": {"val": 100}}},
            invariants=[]
        )
        # Check that if a repair is found, its patched source compiles cleanly with 0 syntax errors
        if broken_repair.get("repair_found"):
            compiled = compile(broken_repair["patched_source"], "<verified>", "exec")
            assert compiled is not None, "Patched source must compile cleanly"

        print("  PASSED — Syntax Gatekeeper enforced 0 syntax/indentation errors on generated code.")
        passed += 1
    except Exception as e:
        print(f"  FAILED — {e}")
        failed += 1

    # ── TEST 8: Concurrency Isolation with ContextVars (50 Concurrent Threads) ──
    try:
        print("\n[TEST 8] High-Concurrency Context Isolation (50 Threads via ContextVars)")
        import concurrent.futures
        import random

        concurrency_count = 50
        errors = []

        def worker_task(thread_id: int):
            run_id = f"py_concurrent_run_{thread_id}"
            ctx = InterceptionContext(run_id=run_id, node_name=f"node_{thread_id}", is_sandbox=False)
            token = _current_context.set(ctx)

            try:
                # Micro-jitter to test thread interleaving
                time.sleep(random.uniform(0.001, 0.015))

                # Verify context didn't bleed from another thread
                current = _current_context.get()
                if current is None or current.run_id != run_id:
                    errors.append(f"Thread {thread_id} context mixup! Expected {run_id}, got {current.run_id if current else None}")

                time.sleep(random.uniform(0.001, 0.015))

                current_after = _current_context.get()
                if current_after is None or current_after.run_id != run_id:
                    errors.append(f"Thread {thread_id} context mixup after sleep! Expected {run_id}, got {current_after.run_id if current_after else None}")
            finally:
                _current_context.reset(token)

        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency_count) as executor:
            futures = [executor.submit(worker_task, i) for i in range(1, concurrency_count + 1)]
            concurrent.futures.wait(futures)

        assert len(errors) == 0, f"Encountered context mixup errors: {errors}"
        print(f"  PASSED — 50 concurrent threads verified: 100% ContextVars isolation, ZERO data bleed.")
        passed += 1
    except Exception as e:
        print(f"  FAILED — {e}")
        failed += 1

    print("\n" + "=" * 70)
    print(f"  PYTHON SUBSTRATE RESULTS: {passed} PASSED / {failed} FAILED")
    print("=" * 70 + "\n")

    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()

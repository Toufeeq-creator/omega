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

    print("\n" + "=" * 70)
    print(f"  PYTHON SUBSTRATE RESULTS: {passed} PASSED / {failed} FAILED")
    print("=" * 70 + "\n")

    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { omega } from "../../src/middleware/protect.ts";
import { VirtualSideEffectProxy } from "../../src/middleware/proxy.ts";
import { TransparentNetworkInterceptor } from "../../src/middleware/transparent-interceptor.ts";
import { SqliteOmegaStore } from "../../src/store/sqlite.ts";
import { AutonomyLevel } from "../../src/core/policies.ts";

const DB_PATH = path.resolve("./transparent_interception_test.db");

// Colors
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function cleanupDb() {
  try {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    if (fs.existsSync(`${DB_PATH}-wal`)) fs.unlinkSync(`${DB_PATH}-wal`);
    if (fs.existsSync(`${DB_PATH}-shm`)) fs.unlinkSync(`${DB_PATH}-shm`);
  } catch {
    // Ignore
  }
}

// ─── Test HTTP Server ────────────────────────────────────────────────────
// Real HTTP server that tracks how many requests it receives.
// If transparent interception works, sandbox replays should NOT hit this server.

let serverRequestCount = 0;
let server: http.Server;
let serverUrl: string;

function startTestServer(): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      serverRequestCount++;

      if (req.url === "/api/charge") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: `ch_real_${serverRequestCount}`,
          status: "succeeded",
          amount: 50000,
          currency: "usd",
          real: true,
        }));
      } else if (req.url === "/api/balance") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          debits: 50000,
          credits: 50000,
          settlement_confirmed: true,
          balance: 0,
        }));
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function stopTestServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// ─── Test Suite ──────────────────────────────────────────────────────────

async function runTransparentInterceptionTests() {
  console.log(`\n${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}`);
  console.log(`${c.bold}${c.magenta}  MODUSFLOW OMEGA — TRANSPARENT NETWORK INTERCEPTION TEST SUITE${c.reset}`);
  console.log(`${c.bold}${c.magenta}  (AsyncLocalStorage Context Gating + Idempotent Fetch Instrumentation)${c.reset}`);
  console.log(`${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}\n`);

  cleanupDb();
  serverUrl = await startTestServer();
  console.log(`${c.green}[READY]${c.reset} Test HTTP server listening on ${c.bold}${serverUrl}${c.reset}`);

  const store = new SqliteOmegaStore(DB_PATH);
  let passed = 0;
  let failed = 0;

  // ── TEST 1: Zero-proxy mode records real fetch calls ──
  try {
    console.log(`\n${c.cyan}[TEST 1]${c.reset} Zero-proxy mode — real fetch is recorded transparently`);
    serverRequestCount = 0;

    const protectedAgent = omega.protect(
      "transparent_charge",
      async (input: { amount: number }) => {
        // Developer writes STANDARD fetch — no proxy, no special code
        const res = await fetch(`${serverUrl}/api/charge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: input.amount }),
        });
        const data = await res.json() as any;

        return {
          debits: data.amount,
          credits: data.amount,
          settlement_confirmed: true,
          chargeId: data.id,
        };
      },
      {
        store,
        invariants: ["debits == credits"],
        autonomyLevel: AutonomyLevel.Verify,
      }
    );

    const result = await protectedAgent({ amount: 50000 });

    if (serverRequestCount !== 1) throw new Error(`Expected 1 server hit, got ${serverRequestCount}`);
    if (!result.data.chargeId) throw new Error("Missing chargeId in output");
    if (result.data.debits !== 50000 || result.data.credits !== 50000) throw new Error("Amount mismatch");

    console.log(`  ${c.green}PASSED${c.reset} — Real fetch executed, ${serverRequestCount} server hit(s), chargeId: ${result.data.chargeId}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 2: Interceptor context isolation ──
  try {
    console.log(`\n${c.cyan}[TEST 2]${c.reset} Context isolation — fetch outside protect() is NOT intercepted`);
    serverRequestCount = 0;

    // Make a direct fetch call outside any protect() context
    const directRes = await fetch(`${serverUrl}/api/balance`);
    const directData = await directRes.json() as any;

    if (serverRequestCount !== 1) throw new Error(`Expected 1 server hit, got ${serverRequestCount}`);
    if (!directData.settlement_confirmed) throw new Error("Direct fetch returned unexpected data");

    // Verify no interception context exists
    const ctx = TransparentNetworkInterceptor.getContext();
    if (ctx) throw new Error("Context should be undefined outside protect()");

    console.log(`  ${c.green}PASSED${c.reset} — Direct fetch passed through (no context), ${serverRequestCount} server hit(s)`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 3: Sandbox mode virtualizes fetch (zero real calls) ──
  try {
    console.log(`\n${c.cyan}[TEST 3]${c.reset} Sandbox mode — fetch is virtualized, ZERO real calls`);
    serverRequestCount = 0;

    // Pre-record a response for sandbox replay
    const preRecorded = new Map<string, any>();

    // Run in sandbox mode — the fetch should NOT hit the real server
    const sandboxResult = await TransparentNetworkInterceptor.runWithContext(
      "run_sandbox_test",
      "sandbox_node",
      true, // isSandbox = true
      async () => {
        const res = await fetch(`${serverUrl}/api/charge`, {
          method: "POST",
          body: JSON.stringify({ amount: 99999 }),
        });
        return await res.json();
      },
      preRecorded
    );

    if (serverRequestCount !== 0) throw new Error(`Expected 0 server hits in sandbox, got ${serverRequestCount}`);
    if (!(sandboxResult as any)._omega_virtualized) throw new Error("Response should be marked as virtualized");

    console.log(`  ${c.green}PASSED${c.reset} — Sandbox mode blocked all outgoing calls, ${serverRequestCount} server hit(s)`);
    console.log(`  ${c.yellow}         Virtualized response:${c.reset} ${JSON.stringify(sandboxResult).slice(0, 100)}...`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 4: Record-then-replay (live records, sandbox replays) ──
  try {
    console.log(`\n${c.cyan}[TEST 4]${c.reset} Record → Replay — live mode records, sandbox replays from cache`);
    serverRequestCount = 0;

    // Phase 1: Live mode — record the call
    let recordedCalls = new Map<string, any>();

    await TransparentNetworkInterceptor.runWithContext(
      "run_record_phase",
      "record_node",
      false, // Live mode
      async () => {
        const res = await fetch(`${serverUrl}/api/balance`);
        await res.json();
        // Capture recorded calls from inside the context
        recordedCalls = new Map(TransparentNetworkInterceptor.getRecordedCalls());
      }
    );

    const liveHits = serverRequestCount;
    if (liveHits !== 1) throw new Error(`Expected 1 server hit during recording, got ${liveHits}`);
    if (recordedCalls.size === 0) throw new Error("No calls were recorded");

    // Phase 2: Sandbox mode — replay from recorded calls
    serverRequestCount = 0;

    const replayResult = await TransparentNetworkInterceptor.runWithContext(
      "run_replay_phase",
      "replay_node",
      true, // Sandbox mode
      async () => {
        const res = await fetch(`${serverUrl}/api/balance`);
        return await res.json();
      },
      recordedCalls // Pass the recorded calls for cache matching
    );

    if (serverRequestCount !== 0) throw new Error(`Expected 0 server hits during replay, got ${serverRequestCount}`);
    if ((replayResult as any).settlement_confirmed !== true) throw new Error("Replayed response doesn't match recorded data");

    console.log(`  ${c.green}PASSED${c.reset} — Recorded ${recordedCalls.size} call(s) in live mode, replayed ${c.bold}0 real hits${c.reset} in sandbox`);
    console.log(`  ${c.yellow}         Replayed data:${c.reset} ${JSON.stringify(replayResult).slice(0, 100)}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 5: Backward compatibility — explicit proxy still works ──
  try {
    console.log(`\n${c.cyan}[TEST 5]${c.reset} Backward compatibility — explicit proxy signature still works`);
    serverRequestCount = 0;

    const legacyProtected = omega.protect(
      "legacy_proxy_node",
      async (input: { amount: number }, proxy: VirtualSideEffectProxy) => {
        // Use the explicit proxy pattern (legacy V1 style)
        const chargeResult = await proxy.call("stripe_charge", async () => {
          const res = await fetch(`${serverUrl}/api/charge`, {
            method: "POST",
            body: JSON.stringify({ amount: input.amount }),
          });
          return await res.json();
        });

        return {
          debits: input.amount,
          credits: input.amount,
          settlement_confirmed: true,
          chargeId: (chargeResult as any).id,
        };
      },
      {
        store,
        invariants: ["debits == credits"],
        autonomyLevel: AutonomyLevel.Verify,
      }
    );

    const result = await legacyProtected({ amount: 50000 });

    if (!result.data.chargeId) throw new Error("Missing chargeId from proxy call");
    if (result.data.debits !== 50000) throw new Error("Amount mismatch");

    console.log(`  ${c.green}PASSED${c.reset} — Legacy proxy signature works, chargeId: ${result.data.chargeId}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 6: Zero-proxy failure recovery with transparent interception ──
  try {
    console.log(`\n${c.cyan}[TEST 6]${c.reset} Zero-proxy failure recovery — transparent interception during sandbox repair`);
    serverRequestCount = 0;

    const failingAgent = omega.protect(
      "transparent_failing_node",
      async (input: { amount: number }) => {
        // This will throw — simulating a schema change error
        throw Object.assign(new Error("missing field 'total' in API response"), {
          rawPayload: { total_amount_cents: input.amount * 100 },
        });
      },
      {
        store,
        invariants: ["debits == credits", "settlement_confirmed == true"],
        autonomyLevel: AutonomyLevel.Verify,
      }
    );

    const result = await failingAgent({ amount: 50000 });

    if (!result.recovered) throw new Error("Expected recovery");
    if (!result.incident) throw new Error("Expected incident report");

    console.log(`  ${c.green}PASSED${c.reset} — Zero-proxy function recovered from SchemaChange, incident: ${result.incident.incidentId}`);
    passed++;
  } catch (err: any) {
    // Escalation is also acceptable
    if (err.message.includes("Omega Protection Escalation")) {
      console.log(`  ${c.green}PASSED${c.reset} — Zero-proxy function properly escalated: ${err.message.slice(0, 80)}...`);
      passed++;
    } else {
      console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
      failed++;
    }
  }

  // ── TEST 7: Idempotency — activate() called multiple times is safe ──
  try {
    console.log(`\n${c.cyan}[TEST 7]${c.reset} Idempotency — multiple activate() calls are harmless`);

    TransparentNetworkInterceptor.activate();
    TransparentNetworkInterceptor.activate();
    TransparentNetworkInterceptor.activate();

    if (!TransparentNetworkInterceptor.isActive()) throw new Error("Interceptor should be active");

    // Verify fetch still works
    serverRequestCount = 0;
    const res = await fetch(`${serverUrl}/api/balance`);
    const data = await res.json() as any;

    if (serverRequestCount !== 1) throw new Error(`Expected 1 server hit, got ${serverRequestCount}`);
    if (!data.settlement_confirmed) throw new Error("Fetch broken after multiple activations");

    console.log(`  ${c.green}PASSED${c.reset} — 3x activate() calls, fetch still works correctly`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── Cleanup & Report ──
  store.close();
  await stopTestServer();
  TransparentNetworkInterceptor.deactivate();
  cleanupDb();

  console.log(`\n${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}`);
  console.log(`${c.bold}  TRANSPARENT INTERCEPTION RESULTS: ${c.green}${passed} PASSED${c.reset} / ${failed > 0 ? c.red : c.green}${failed} FAILED${c.reset}`);
  console.log(`${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}\n`);

  if (failed > 0) process.exit(1);
}

runTransparentInterceptionTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

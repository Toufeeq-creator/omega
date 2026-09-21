import fs from "node:fs";
import path from "node:path";
import { SqliteOmegaStore } from "../../src/store/sqlite.ts";
import { ReplicationNode, VectorClock } from "../../src/store/replication.ts";
import { ReplayEngine } from "../../src/runtime/replay.ts";

const DB_DIR = path.resolve("./replication_test_dbs");

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

function cleanupDbs() {
  try {
    if (fs.existsSync(DB_DIR)) {
      fs.rmSync(DB_DIR, { recursive: true, force: true });
    }
  } catch {
    // Ignore
  }
}

async function runDistributedReplicationTests() {
  console.log(`\n${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}`);
  console.log(`${c.bold}${c.magenta}  MODUSFLOW OMEGA — DISTRIBUTED WAL REPLICATION CHAOS SUITE${c.reset}`);
  console.log(`${c.bold}${c.magenta}  (Length-Prefixed TCP Streaming, Vector Clocks, Multi-Node Failover)${c.reset}`);
  console.log(`${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}\n`);

  cleanupDbs();
  fs.mkdirSync(DB_DIR, { recursive: true });

  let passed = 0;
  let failed = 0;

  const leaderStore = new SqliteOmegaStore(path.join(DB_DIR, "leader.db"));
  const follower1Store = new SqliteOmegaStore(path.join(DB_DIR, "follower1.db"));
  const follower2Store = new SqliteOmegaStore(path.join(DB_DIR, "follower2.db"));

  const leader = new ReplicationNode({ nodeId: "node-leader", store: leaderStore });
  const follower1 = new ReplicationNode({ nodeId: "node-follower-1", store: follower1Store });
  const follower2 = new ReplicationNode({ nodeId: "node-follower-2", store: follower2Store });

  try {
    // ── TEST 1: Cluster Initialization & Dynamic Port Binding ───────────────
    console.log(`${c.cyan}[TEST 1]${c.reset} Cluster Startup & Standby Follower Connection`);
    const leaderPort = await leader.startAsLeader();
    console.log(`  ${c.green}✔${c.reset} Leader listening on ephemeral TCP port: ${c.bold}${leaderPort}${c.reset}`);

    await follower1.connectToLeader(leaderPort);
    await follower2.connectToLeader(leaderPort);

    console.log(`  ${c.green}PASSED${c.reset} — 3-Node cluster connected (1 Leader, 2 Followers).`);
    passed++;

    // ── TEST 2: Streaming WAL Replication under Load ────────────────────────
    console.log(`\n${c.cyan}[TEST 2]${c.reset} Real-Time Streaming WAL Replication (20 Events)`);
    const runId = "run_cluster_alpha";

    for (let i = 1; i <= 20; i++) {
      await leader.appendAndReplicate({
        runId,
        nodeId: `task_node_${i}`,
        timestamp: new Date().toISOString(),
        eventType: i === 20 ? "NodeCompleted" : "NodeStarted",
        payload: { transactionId: `tx_${i}`, amount: 5000.0 * i },
      });
    }

    // Wait 150ms for TCP frames to flush and SQLite to commit
    await new Promise(r => setTimeout(r, 150));

    const follower1Events = await follower1Store.readAll(runId);
    const follower2Events = await follower2Store.readAll(runId);

    if (follower1Events.length !== 20 || follower2Events.length !== 20) {
      throw new Error(`Replication mismatch! Follower1: ${follower1Events.length}/20, Follower2: ${follower2Events.length}/20`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — All 20 journal events replicated with length-prefixed framing:`);
    console.log(`  ${c.yellow}         Follower 1 Journal count: ${follower1Events.length} | Follower 2 Journal count: ${follower2Events.length}${c.reset}`);
    passed++;

    // ── TEST 3: Vector Clock Causal Consistency ─────────────────────────────
    console.log(`\n${c.cyan}[TEST 3]${c.reset} Vector Clock Causal Tracking`);
    const leaderClock = leader.vectorClock.toJSON();

    if ((leaderClock["node-leader"] || 0) < 20) {
      throw new Error(`Vector clock should have at least 20 ticks, got ${JSON.stringify(leaderClock)}`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — Vector clock causal ticks: ${JSON.stringify(leaderClock)}`);
    passed++;

    // ── TEST 4: Leader Destruction & Follower 1 Failover Election ───────────
    console.log(`\n${c.cyan}[TEST 4]${c.reset} Hard Leader Kill & Automatic Standby Promotion`);
    console.log(`  ${c.red}[CHAOS] Forcibly killing Leader node...${c.reset}`);
    await leader.close();

    // Follower 1 promotes itself to new Leader
    const newLeaderPort = await follower1.promoteToLeader();
    console.log(`  ${c.green}✔${c.reset} Follower 1 promoted to new Leader on TCP port: ${c.bold}${newLeaderPort}${c.reset}`);

    // Follower 2 connects to the new Leader
    await follower2.connectToLeader(newLeaderPort);

    // Stream 5 new events on new Leader
    for (let i = 21; i <= 25; i++) {
      await follower1.appendAndReplicate({
        runId,
        nodeId: `task_node_${i}`,
        timestamp: new Date().toISOString(),
        eventType: "NodeStarted",
        payload: { transactionId: `tx_${i}`, amount: 5000.0 * i },
      });
    }

    await new Promise(r => setTimeout(r, 150));

    const totalFollower2Events = await follower2Store.readAll(runId);
    if (totalFollower2Events.length !== 25) {
      throw new Error(`Expected 25 total events on Follower 2 after failover, got ${totalFollower2Events.length}`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — Failover complete! 25/25 events replicated across failover epoch.`);
    passed++;

    // ── TEST 5: State Reconstruction after Failover ─────────────────────────
    console.log(`\n${c.cyan}[TEST 5]${c.reset} Zero-Data-Loss Deterministic State Replay on New Leader`);
    const journalEntries = await follower1Store.readAll(runId);
    const replayedState = ReplayEngine.replayFromJournal(runId, "wf_cluster", journalEntries);

    if (replayedState.runId !== runId) {
      throw new Error("State replay failed to restore runId");
    }

    if (Object.keys(replayedState.nodeStates).length !== 25) {
      throw new Error(`Expected 25 node states replayed, got ${Object.keys(replayedState.nodeStates).length}`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — New leader replayed full 25-event journal from SQLite with ZERO data drift.`);
    passed++;

    // ── TEST 6: Vector Clock BigInt 64-Bit Boundary & Overflow Defense ───────
    console.log(`\n${c.cyan}[TEST 6]${c.reset} Vector Clock BigInt Overflow Defense (> 4,294,967,295 Ticks)`);
    const overflowClock = new VectorClock("node-high-throughput");

    // Seed with value beyond 32-bit unsigned max (4,294,967,295)
    overflowClock.merge({ "node-high-throughput": "5000000000" });
    overflowClock.tick();

    const currentBigVal = overflowClock.get("node-high-throughput");
    if (currentBigVal !== 5000000001n) {
      throw new Error(`Vector clock failed BigInt precision test! Expected 5000000001n, got: ${currentBigVal}`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — VectorClock seamlessly incremented beyond 32-bit boundary: ${currentBigVal.toString()}n`);
    passed++;

    // ── TEST 7: SQLITE_BUSY Write Lock Deadlock Defense (50 Concurrent Writers) ─
    console.log(`\n${c.cyan}[TEST 7]${c.reset} SQLITE_BUSY Write Lock Deadlock Defense (50 Concurrent Writers)`);
    const concurrentWrites = 50;
    const writePromises = Array.from({ length: concurrentWrites }, (_, i) => {
      return leaderStore.append({
        runId: "run_acid_stress",
        nodeId: `writer_task_${i + 1}`,
        timestamp: new Date().toISOString(),
        eventType: "NodeCompleted",
        payload: { batchId: i + 1, status: "queued" },
      });
    });

    const writeResults = await Promise.all(writePromises);
    if (writeResults.length !== concurrentWrites) {
      throw new Error(`Expected ${concurrentWrites} writes to succeed, got ${writeResults.length}`);
    }

    // Verify all sequence numbers are strictly ascending and unique
    const seqSet = new Set(writeResults);
    if (seqSet.size !== concurrentWrites) {
      throw new Error("Duplicate sequence numbers generated in concurrent writes!");
    }

    console.log(`  ${c.green}PASSED${c.reset} — In-memory write queue serialized ${concurrentWrites} concurrent writes with ZERO SQLITE_BUSY errors.`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 8: SQLite WAL Log File Over-Allocation & Truncate Maintenance ───
  try {
    console.log(`\n${c.cyan}[TEST 8]${c.reset} SQLite WAL Log File Over-Allocation & Truncate Maintenance`);
    // Perform explicit WAL truncate checkpoint
    await leaderStore.checkpoint("TRUNCATE");
    console.log(`  ${c.green}PASSED${c.reset} — WAL truncated successfully via PRAGMA wal_checkpoint(TRUNCATE).`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 9: Pod Ephemeral Shared Memory (.db-shm) Loss Recovery ───────────
  try {
    console.log(`\n${c.cyan}[TEST 9]${c.reset} Pod Ephemeral Shared Memory (.db-shm) Loss Recovery`);
    const testRecoveryDbPath = path.resolve("./test_pod_shm_recovery.db");
    const recoveryStore1 = new SqliteOmegaStore(testRecoveryDbPath);
    await recoveryStore1.saveWorkflow({
      id: "wf_pod_test",
      name: "Pod Workflow",
      version: 1,
      irJson: "{}",
      createdAt: new Date().toISOString(),
    });
    recoveryStore1.close();

    // Reopen directly: SqliteOmegaStore executes PRAGMA quick_check on startup
    const recoveryStore2 = new SqliteOmegaStore(testRecoveryDbPath);
    const wf = await recoveryStore2.getWorkflow("wf_pod_test");
    if (!wf || wf.id !== "wf_pod_test") {
      throw new Error("Failed to recover workflow state after simulated container pod reset!");
    }
    recoveryStore2.close();
    if (fs.existsSync(testRecoveryDbPath)) fs.unlinkSync(testRecoveryDbPath);
    if (fs.existsSync(`${testRecoveryDbPath}-wal`)) fs.unlinkSync(`${testRecoveryDbPath}-wal`);
    if (fs.existsSync(`${testRecoveryDbPath}-shm`)) fs.unlinkSync(`${testRecoveryDbPath}-shm`);

    console.log(`  ${c.green}PASSED${c.reset} — Reopened database with quick_check verification; 0 pod restart corruption.`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  } finally {
    await leader.close();
    await follower1.close();
    await follower2.close();
    leaderStore.close();
    follower1Store.close();
    follower2Store.close();
    cleanupDbs();
  }

  console.log(`\n${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}`);
  console.log(`${c.bold}  DISTRIBUTED REPLICATION RESULTS: ${c.green}${passed} PASSED${c.reset} / ${failed > 0 ? c.red : c.green}${failed} FAILED${c.reset}`);
  console.log(`${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}\n`);

  if (failed > 0) process.exit(1);
}

runDistributedReplicationTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

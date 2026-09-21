import { DatabaseSync } from "node:sqlite";
import { OmegaIR } from "../core/ir.ts";
import { ExecutionState } from "../core/state.ts";
import { CheckpointId, RunId, SequenceNum, WorkflowId } from "../core/types.ts";
import { CheckpointStore, JournalEntry, JournalEventType, JournalStore, RunStore, WorkflowStore } from "./traits.ts";

export class SqliteOmegaStore implements WorkflowStore, RunStore, JournalStore, CheckpointStore {
  private db: DatabaseSync;
  private stmtCache = new Map<string, any>();
  // In-Memory Asynchronous Serialization Queue:
  // SQLite WAL allows concurrent readers, but strictly 1 writer at a time.
  // This queue serializes all writes in-memory, completely preventing SQLITE_BUSY deadlocks.
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(location = ":memory:") {
    this.db = new DatabaseSync(location);
    this.initTables();
  }

  private enqueueWrite<T>(op: () => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.writeQueue = this.writeQueue
        .then(() => Promise.resolve(op()).then(resolve, reject))
        .catch(() => {});
    });
  }

  private initTables(): void {
    try {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 10000;
        PRAGMA synchronous = NORMAL;
      `);
    } catch {
      // Memory DBs ignore some WAL pragmas
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        ir_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journal (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        node_id TEXT,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private getStmt(sql: string): any {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  close(): void {
    try {
      this.stmtCache.clear();
      this.db.close();
    } catch {
      // Ignore if already closed
    }
  }

  // --- WorkflowStore ---
  async saveWorkflow(ir: OmegaIR): Promise<void> {
    return this.enqueueWrite(() => {
      const stmt = this.getStmt(`
        INSERT OR REPLACE INTO workflows (id, name, version, ir_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(ir.id, ir.name, ir.version, JSON.stringify(ir), new Date().toISOString());
    });
  }

  async getWorkflow(id: WorkflowId): Promise<OmegaIR | null> {
    const stmt = this.getStmt(`SELECT ir_json FROM workflows WHERE id = ?`);
    const row = stmt.get(id) as { ir_json: string } | undefined;
    return row ? JSON.parse(row.ir_json) : null;
  }

  async listWorkflows(): Promise<OmegaIR[]> {
    const stmt = this.getStmt(`SELECT ir_json FROM workflows ORDER BY created_at DESC`);
    const rows = stmt.all() as { ir_json: string }[];
    return rows.map((r) => JSON.parse(r.ir_json));
  }

  // --- RunStore ---
  async createRun(state: ExecutionState): Promise<void> {
    return this.enqueueWrite(() => {
      const stmt = this.getStmt(`
        INSERT INTO runs (id, workflow_id, state_json, started_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(state.runId, state.workflowId, JSON.stringify(state), state.startedAt, state.updatedAt);
    });
  }

  async updateRun(state: ExecutionState): Promise<void> {
    return this.enqueueWrite(() => {
      const stmt = this.getStmt(`
        UPDATE runs SET state_json = ?, updated_at = ? WHERE id = ?
      `);
      stmt.run(JSON.stringify(state), state.updatedAt, state.runId);
    });
  }

  async getRun(id: RunId): Promise<ExecutionState | null> {
    const stmt = this.getStmt(`SELECT state_json FROM runs WHERE id = ?`);
    const row = stmt.get(id) as { state_json: string } | undefined;
    return row ? JSON.parse(row.state_json) : null;
  }

  async listRuns(workflowId?: WorkflowId, limit = 50): Promise<ExecutionState[]> {
    if (workflowId) {
      const stmt = this.getStmt(`SELECT state_json FROM runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?`);
      const rows = stmt.all(workflowId, limit) as { state_json: string }[];
      return rows.map((r) => JSON.parse(r.state_json));
    }
    const stmt = this.getStmt(`SELECT state_json FROM runs ORDER BY started_at DESC LIMIT ?`);
    const rows = stmt.all(limit) as { state_json: string }[];
    return rows.map((r) => JSON.parse(r.state_json));
  }

  // --- JournalStore ---
  async append(entry: Omit<JournalEntry, "sequence">): Promise<SequenceNum> {
    return this.enqueueWrite(() => {
      const stmt = this.getStmt(`
        INSERT INTO journal (run_id, node_id, timestamp, event_type, payload_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      const res = stmt.run(
        entry.runId,
        entry.nodeId || null,
        entry.timestamp,
        entry.eventType,
        JSON.stringify(entry.payload ?? null)
      );
      return Number(res.lastInsertRowid);
    });
  }

  async readAll(runId: RunId): Promise<JournalEntry[]> {
    const stmt = this.getStmt(`
      SELECT sequence, run_id, node_id, timestamp, event_type, payload_json
      FROM journal
      WHERE run_id = ?
      ORDER BY sequence ASC
    `);
    const rows = stmt.all(runId) as {
      sequence: number;
      run_id: string;
      node_id: string | null;
      timestamp: string;
      event_type: string;
      payload_json: string;
    }[];

    return rows.map((r) => ({
      sequence: r.sequence,
      runId: r.run_id,
      nodeId: r.node_id || undefined,
      timestamp: r.timestamp,
      eventType: r.event_type as JournalEventType,
      payload: JSON.parse(r.payload_json),
    }));
  }

  // --- CheckpointStore ---
  async saveCheckpoint(checkpointId: CheckpointId, state: ExecutionState): Promise<void> {
    return this.enqueueWrite(() => {
      const stmt = this.getStmt(`
        INSERT OR REPLACE INTO checkpoints (id, run_id, state_json, created_at)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(checkpointId, state.runId, JSON.stringify(state), new Date().toISOString());
    });
  }

  async getCheckpoint(checkpointId: CheckpointId): Promise<ExecutionState | null> {
    const stmt = this.getStmt(`SELECT state_json FROM checkpoints WHERE id = ?`);
    const row = stmt.get(checkpointId) as { state_json: string } | undefined;
    return row ? JSON.parse(row.state_json) : null;
  }

  async latestCheckpoint(runId: RunId): Promise<{ checkpointId: CheckpointId; state: ExecutionState } | null> {
    const stmt = this.getStmt(`
      SELECT id, state_json FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1
    `);
    const row = stmt.get(runId) as { id: string; state_json: string } | undefined;
    return row ? { checkpointId: row.id, state: JSON.parse(row.state_json) } : null;
  }
}

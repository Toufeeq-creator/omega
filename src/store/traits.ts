import { OmegaIR } from "../core/ir.ts";
import { ExecutionState } from "../core/state.ts";
import { CheckpointId, NodeId, RunId, SequenceNum, WorkflowId } from "../core/types.ts";

export type JournalEventType =
  | "RunStarted"
  | "RunCompleted"
  | "RunFailed"
  | "NodeScheduled"
  | "NodeStarted"
  | "NodeCompleted"
  | "NodeFailed"
  | "NodeRetrying"
  | "CheckpointCreated"
  | "CheckpointRestored"
  | "CompensationStarted"
  | "CompensationCompleted"
  | "RecoveryStarted"
  | "RecoveryCompleted"
  | "InvariantChecked"
  | "Custom";

export interface JournalEntry {
  sequence: SequenceNum;
  runId: RunId;
  nodeId?: NodeId;
  timestamp: string;
  eventType: JournalEventType;
  payload: unknown;
}

export interface WorkflowStore {
  saveWorkflow(ir: OmegaIR): Promise<void>;
  getWorkflow(id: WorkflowId): Promise<OmegaIR | null>;
  listWorkflows(): Promise<OmegaIR[]>;
}

export interface RunStore {
  createRun(state: ExecutionState): Promise<void>;
  updateRun(state: ExecutionState): Promise<void>;
  getRun(id: RunId): Promise<ExecutionState | null>;
  listRuns(workflowId?: WorkflowId, limit?: number): Promise<ExecutionState[]>;
}

export interface JournalStore {
  append(entry: Omit<JournalEntry, "sequence">): Promise<SequenceNum>;
  readAll(runId: RunId): Promise<JournalEntry[]>;
}

export interface CheckpointStore {
  saveCheckpoint(checkpointId: CheckpointId, state: ExecutionState): Promise<void>;
  getCheckpoint(checkpointId: CheckpointId): Promise<ExecutionState | null>;
  latestCheckpoint(runId: RunId): Promise<{ checkpointId: CheckpointId; state: ExecutionState } | null>;
}
